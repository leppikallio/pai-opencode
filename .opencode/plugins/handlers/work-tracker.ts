/**
 * Work Tracker Handler
 *
 * Equivalent to PAI v2.4 AutoWorkCreation + SessionSummary hooks.
 * Creates and manages work sessions in MEMORY/WORK/
 *
 * @module work-tracker
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import {
  getWorkDir,
  getStateDir,
  getYearMonth,
  getTimestamp,
  ensureDir,
  getCurrentWorkPathForSession,
  setCurrentWorkPathForSession,
  clearCurrentWorkForSession,
  slugify,
} from "../lib/paths";

/**
 * Work session metadata
 */
export interface WorkSession {
  id: string;
  path: string;
  title: string;
  started_at: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
}

/**
 * Create work session result
 */
export interface CreateWorkResult {
  success: boolean;
  session?: WorkSession;
  error?: string;
}

export interface CreateWorkOptions {
  createIfMissing?: boolean;
}

/**
 * Complete work session result
 */
export interface CompleteWorkResult {
  success: boolean;
  completed_at?: string;
  error?: string;
}

// In-memory cache for work sessions (keyed by OpenCode sessionID)
const currentSessions = new Map<string, WorkSession>();
const derivedContinuityBySession = new Map<string, DerivedContinuityState>();

export interface DerivedContinuityState {
  v: "0.1";
  updatedAt: string;
  workPath?: string;
  activeWorkSlug?: string;
  prdProgress?: string;
  prdPhase?: string;
  nextUnfinishedIscIds: string[];
  nextUnfinishedIscTexts: string[];
  activeBackgroundTaskIds: string[];
  continuationHints: string[];
}

export interface DerivedContinuityStateInput {
  updatedAt?: string;
  workPath?: string;
  activeWorkSlug?: string;
  prdProgress?: string;
  prdPhase?: string;
  nextUnfinishedIscIds?: string[];
  nextUnfinishedIscTexts?: string[];
  activeBackgroundTaskIds?: string[];
  continuationHints?: string[];
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    out.push(trimmed);
    seen.add(trimmed);
    if (out.length >= maxItems) {
      break;
    }
  }

  return out;
}

function normalizeDerivedContinuityState(input: DerivedContinuityStateInput): DerivedContinuityState {
  const updatedAt =
    typeof input.updatedAt === "string" && input.updatedAt.trim().length > 0
      ? input.updatedAt
      : new Date().toISOString();

  const pickOptional = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    v: "0.1",
    updatedAt,
    workPath: pickOptional(input.workPath),
    activeWorkSlug: pickOptional(input.activeWorkSlug),
    prdProgress: pickOptional(input.prdProgress),
    prdPhase: pickOptional(input.prdPhase),
    nextUnfinishedIscIds: normalizeStringList(input.nextUnfinishedIscIds, 24),
    nextUnfinishedIscTexts: normalizeStringList(input.nextUnfinishedIscTexts, 24),
    activeBackgroundTaskIds: normalizeStringList(input.activeBackgroundTaskIds, 24),
    continuationHints: normalizeStringList(input.continuationHints, 16),
  };
}

export function setDerivedContinuityStateForSession(
  sessionIdRaw: string,
  input: DerivedContinuityStateInput
): void {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) {
    return;
  }

  derivedContinuityBySession.set(sessionId, normalizeDerivedContinuityState(input));
}

export function getDerivedContinuityStateForSession(sessionIdRaw: string): DerivedContinuityState | null {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) {
    return null;
  }

  const state = derivedContinuityBySession.get(sessionId);
  if (!state) {
    return null;
  }

  return {
    ...state,
    nextUnfinishedIscIds: [...state.nextUnfinishedIscIds],
    nextUnfinishedIscTexts: [...state.nextUnfinishedIscTexts],
    activeBackgroundTaskIds: [...state.activeBackgroundTaskIds],
    continuationHints: [...state.continuationHints],
  };
}

export function clearDerivedContinuityStateForSession(sessionIdRaw: string): void {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) {
    return;
  }

  derivedContinuityBySession.delete(sessionId);
}

function normalizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) return "";
  if (trimmed.length > 128) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "";
  return trimmed;
}

export interface IscCriterion {
  id: string;
  text: string;
  status: string;
  evidenceRefs?: string[];
  sourceEventIds?: string[];
}

export interface IscState {
  v: "0.1";
  ideal: string;
  criteria: IscCriterion[];
  antiCriteria: { id: string; text: string }[];
  updatedAt: string;
}

export interface IscSnapshot {
  v: "0.1";
  ts: string;
  delta: "add" | "adjust" | "verify" | "fail" | "remove";
  criterionId: string;
  from?: string;
  to?: string;
  sourceEventId: string;
}

function createEmptyIscState(): IscState {
  return {
    v: "0.1",
    ideal: "",
    criteria: [],
    antiCriteria: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStatus(status: string): string {
  const upper = status.trim().toUpperCase();
  if (upper.includes("VERIFIED") || upper.includes("DONE")) return "VERIFIED";
  if (upper.includes("FAILED")) return "FAILED";
  if (upper.includes("IN_PROGRESS") || upper.includes("IN-PROGRESS")) return "IN_PROGRESS";
  if (upper.includes("PENDING")) return "PENDING";
  if (upper.includes("ADJUSTED")) return "ADJUSTED";
  if (upper.includes("REMOVED")) return "REMOVED";
  return upper || "PENDING";
}

/**
 * Infer title from user prompt
 * Simple heuristic - first 6 words, cleaned
 */
function inferTitle(prompt: string): string {
  const words = prompt
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 6);

  if (words.length === 0) {
    return "work-session";
  }

  return words.join(" ");
}

type SessionCandidate = {
  sessionPath: string;
  yearMonth: string;
  startedAtMs: number | null;
};

function parseMetaValue(metaContent: string, key: string): string | null {
  const match = metaContent.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

function parseStartedAtMs(metaContent: string): number | null {
  const raw = parseMetaValue(metaContent, "started_at");
  if (!raw) return null;
  const ms = Date.parse(raw.replace(/^"|"$/g, ""));
  return Number.isFinite(ms) ? ms : null;
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.promises.writeFile(filePath, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

async function readSessionFromPath(sessionId: string, sessionPath: string): Promise<WorkSession | null> {
  const metaPath = path.join(sessionPath, "META.yaml");
  try {
    const metaContent = await fs.promises.readFile(metaPath, "utf-8");
    const title = (parseMetaValue(metaContent, "title") || "work-session").replace(/^"|"$/g, "");
    const status = (parseMetaValue(metaContent, "status") || "ACTIVE").replace(/^"|"$/g, "");
    const started_at =
      (parseMetaValue(metaContent, "started_at") || new Date().toISOString()).replace(/^"|"$/g, "");

    return {
      id: sessionId,
      path: sessionPath,
      title,
      started_at,
      status: status as WorkSession["status"],
    };
  } catch {
    return null;
  }
}

async function scanSessionCandidates(sessionId: string): Promise<SessionCandidate[]> {
  const workDir = getWorkDir();
  let monthEntries: Array<{ isDirectory: () => boolean; name: string }> = [];
  try {
    monthEntries = await fs.promises.readdir(workDir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }

  const candidates: SessionCandidate[] = [];
  for (const monthEntry of monthEntries) {
    if (!monthEntry.isDirectory()) continue;
    const yearMonth = monthEntry.name;
    const sessionPath = path.join(workDir, yearMonth, sessionId);
    if (!(await pathIsDirectory(sessionPath))) continue;

    let startedAtMs: number | null = null;
    try {
      const metaContent = await fs.promises.readFile(path.join(sessionPath, "META.yaml"), "utf-8");
      startedAtMs = parseStartedAtMs(metaContent);
    } catch {
      startedAtMs = null;
    }

    candidates.push({ sessionPath, yearMonth, startedAtMs });
  }

  return candidates;
}

function pickBestSessionCandidate(candidates: SessionCandidate[]): SessionCandidate | null {
  if (candidates.length === 0) return null;

  const startedAtCandidates = candidates.filter((candidate) => candidate.startedAtMs !== null);
  if (startedAtCandidates.length > 0) {
    return startedAtCandidates.sort((a, b) => {
      const aMs = a.startedAtMs ?? Number.NEGATIVE_INFINITY;
      const bMs = b.startedAtMs ?? Number.NEGATIVE_INFINITY;
      if (bMs !== aMs) return bMs - aMs;
      return b.yearMonth.localeCompare(a.yearMonth);
    })[0] ?? null;
  }

  return candidates.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0] ?? null;
}

async function hasOutOfRootStateMapping(sessionId: string): Promise<boolean> {
  const statePath = path.join(getStateDir(), "current-work.json");
  try {
    const raw = await fs.promises.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      sessions?: Record<string, { work_dir?: string }>;
    };
    const mappedPath = parsed.sessions?.[sessionId]?.work_dir;
    if (typeof mappedPath !== "string" || mappedPath.length === 0) return false;

    const workRoot = path.resolve(getWorkDir());
    const candidate = path.resolve(mappedPath);
    const rel = path.relative(workRoot, candidate);
    return !(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)));
  } catch {
    return false;
  }
}

/**
 * Create a new work session
 *
 * Called on first user prompt if no active session exists.
 * Creates MEMORY/WORK/{timestamp}_{title}/ structure.
 */
export async function createWorkSession(
  sessionIdRaw: string,
  seed: string,
  options: CreateWorkOptions = {}
): Promise<CreateWorkResult> {
  try {
    const sessionId = normalizeSessionId(sessionIdRaw);
    if (!sessionId) {
      return { success: false, error: "Invalid session id" };
    }

    // Resolve existing/recoverable session directory first.
    const workDir = getWorkDir();
    const timestamp = getTimestamp();
    const title = inferTitle(seed);
    const slug = slugify(title);
    const workId = `${timestamp}_${slug}`;
    const nowIso = new Date().toISOString();

    let sessionPath: string | null = null;
    const mappedPath = await getCurrentWorkPathForSession(sessionId);
    if (mappedPath && (await pathIsDirectory(mappedPath))) {
      sessionPath = mappedPath;
    }

    if (!mappedPath && (await hasOutOfRootStateMapping(sessionId))) {
      process.stderr.write("PAI_STATE_CURRENT_WORK_MAPPING_OUT_OF_ROOT\n");
    }

    if (!sessionPath) {
      const candidates = await scanSessionCandidates(sessionId);
      const best = pickBestSessionCandidate(candidates);
      if (best) {
        sessionPath = best.sessionPath;
      }
    }

    if (!sessionPath) {
      if (options.createIfMissing === false) {
        return { success: false, error: "No recoverable work session found" };
      }
      sessionPath = path.join(workDir, getYearMonth(), sessionId);
    }

    await ensureDir(sessionPath);

    // Create subdirectories
    await ensureDir(path.join(sessionPath, "tasks"));
    await ensureDir(path.join(sessionPath, "scratch"));

    // Create META.yaml
    const meta = {
      status: "ACTIVE",
      started_at: nowIso,
      title: title,
      opencode_session_id: sessionId,
      work_id: workId,
    };

    await writeFileIfMissing(
      path.join(sessionPath, "META.yaml"),
      `status: ${meta.status}\nstarted_at: ${meta.started_at}\ntitle: "${meta.title}"\nopencode_session_id: ${meta.opencode_session_id}\nwork_id: ${meta.work_id}\n`
    );

    // Create empty ISC.json (v0.1)
    await writeFileIfMissing(
      path.join(sessionPath, "ISC.json"),
      JSON.stringify(createEmptyIscState(), null, 2)
    );

    // Create THREAD.md
    await writeFileIfMissing(
      path.join(sessionPath, "THREAD.md"),
      `# ${title}\n\n**Started:** ${meta.started_at}\n**Status:** ACTIVE\n\n---\n\n`
    );

    // Update state
    await setCurrentWorkPathForSession(sessionId, sessionPath);

    const cached = currentSessions.get(sessionId);
    const loaded = await readSessionFromPath(sessionId, sessionPath);

    const session: WorkSession =
      cached && cached.path === sessionPath
        ? cached
        : (loaded ?? {
            id: sessionId,
            path: sessionPath,
            title: title,
            started_at: meta.started_at,
            status: "ACTIVE",
          });

    currentSessions.set(sessionId, session);

    fileLog(`Work session ready: ${sessionId}`, "info");

    return { success: true, session };
  } catch (error) {
    fileLogError("Failed to create work session", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get current work session
 */
export function getCurrentSession(sessionIdRaw: string): WorkSession | null {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return null;
  return currentSessions.get(sessionId) ?? null;
}

/**
 * Load current session from disk if cache is empty
 */
export async function getOrLoadCurrentSession(sessionIdRaw: string): Promise<WorkSession | null> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return null;
  const cached = currentSessions.get(sessionId);
  if (cached) return cached;

  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return null;

  if (!(await pathIsDirectory(sessionPath))) return null;

  const session = await readSessionFromPath(sessionId, sessionPath);
  if (!session) {
    fileLogError("Failed to load current session", `Missing or unreadable META.yaml for ${sessionId}`);
    return null;
  }

  currentSessions.set(sessionId, session);
  return session;
}

/**
 * Complete the current work session
 *
 * Called at session end. Updates META.yaml with completion timestamp.
 */
export async function completeWorkSession(sessionIdRaw: string): Promise<CompleteWorkResult> {
  try {
    const sessionId = normalizeSessionId(sessionIdRaw);
    if (!sessionId) return { success: true };

    const sessionPath = await getCurrentWorkPathForSession(sessionId);
    if (!sessionPath) {
      fileLog("No active work session to complete", "debug");
      return { success: true };
    }

    const metaPath = path.join(sessionPath, "META.yaml");
    const completed_at = new Date().toISOString();

    // Read existing meta
    let metaContent = "";
    try {
      metaContent = await fs.promises.readFile(metaPath, "utf-8");
    } catch {
      metaContent = "";
    }

    if (metaContent.includes("status: COMPLETED") && metaContent.includes("completed_at:")) {
      return { success: true };
    }

    // Update status
    metaContent = metaContent.replace(/status: (ACTIVE|PAUSED|COMPLETED)/, "status: COMPLETED").trim();
    if (!metaContent.includes("completed_at:")) {
      metaContent += `\ncompleted_at: ${completed_at}\n`;
    }

    await fs.promises.writeFile(metaPath, metaContent);

    // Clear state
    await clearCurrentWorkForSession(sessionId);
    currentSessions.delete(sessionId);
    derivedContinuityBySession.delete(sessionId);

    fileLog(`Work session completed: ${sessionPath}`, "info");

    return { success: true, completed_at };
  } catch (error) {
    fileLogError("Failed to complete work session", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Pause the current work session (soft finalize)
 */
export async function pauseWorkSession(): Promise<void> {
  throw new Error("pauseWorkSession() now requires a sessionID");
}

export async function pauseWorkSessionForSession(sessionIdRaw: string): Promise<void> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return;
  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return;

  const metaPath = path.join(sessionPath, "META.yaml");
  const paused_at = new Date().toISOString();
  try {
    let metaContent = await fs.promises.readFile(metaPath, "utf-8");
    metaContent = metaContent.replace(/status: (ACTIVE|PAUSED)/, "status: PAUSED").trim();
    metaContent += `\npaused_at: ${paused_at}\n`;
    await fs.promises.writeFile(metaPath, metaContent);
    const cached = currentSessions.get(sessionId);
    if (cached) cached.status = "PAUSED";
  } catch (error) {
    fileLogError("Failed to pause work session", error);
  }
}

/**
 * Resume a paused work session
 */
export async function resumeWorkSession(): Promise<void> {
  throw new Error("resumeWorkSession() now requires a sessionID");
}

export async function resumeWorkSessionForSession(sessionIdRaw: string): Promise<void> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return;
  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return;

  const metaPath = path.join(sessionPath, "META.yaml");
  const resumed_at = new Date().toISOString();
  try {
    let metaContent = await fs.promises.readFile(metaPath, "utf-8");
    metaContent = metaContent.replace(/status: (PAUSED|ACTIVE)/, "status: ACTIVE").trim();
    metaContent += `\nresumed_at: ${resumed_at}\n`;
    await fs.promises.writeFile(metaPath, metaContent);
    const cached = currentSessions.get(sessionId);
    if (cached) cached.status = "ACTIVE";
  } catch (error) {
    fileLogError("Failed to resume work session", error);
  }
}

/**
 * Append to THREAD.md
 */
export async function appendToThread(_content: string): Promise<void> {
  throw new Error("appendToThread() now requires a sessionID");
}

export async function appendToThreadForSession(sessionIdRaw: string, content: string): Promise<void> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return;
  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return;

  const threadPath = path.join(sessionPath, "THREAD.md");

  try {
    await fs.promises.appendFile(threadPath, `\n${content}\n`);
  } catch (error) {
    fileLogError("Failed to append to THREAD.md", error);
  }
}

/**
 * Update ISC.json
 */
export async function updateISC(_state: IscState): Promise<void> {
  throw new Error("updateISC() now requires a sessionID");
}

export async function updateISCForSession(sessionIdRaw: string, state: IscState): Promise<void> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return;
  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return;

  const iscPath = path.join(sessionPath, "ISC.json");

  try {
    await fs.promises.writeFile(iscPath, JSON.stringify(state, null, 2));
  } catch (error) {
    fileLogError("Failed to update ISC.json", error);
  }
}

/**
 * Apply ISC update with snapshots
 */
export async function applyIscUpdate(
  _state: IscState,
  _sourceEventId: string
): Promise<void> {
  throw new Error("applyIscUpdate() now requires a sessionID");
}

export async function applyIscUpdateForSession(
  sessionIdRaw: string,
  state: IscState,
  sourceEventId: string
): Promise<void> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) return;
  const sessionPath = await getCurrentWorkPathForSession(sessionId);
  if (!sessionPath) return;

  const iscPath = path.join(sessionPath, "ISC.json");
  const snapshotsPath = path.join(sessionPath, "isc.snapshots.jsonl");

  let previous = createEmptyIscState();
  try {
    const prevContent = await fs.promises.readFile(iscPath, "utf-8");
    previous = JSON.parse(prevContent) as IscState;
  } catch {
    // ignore
  }

  if (!state.ideal) state.ideal = previous.ideal;
  if (state.antiCriteria.length === 0) state.antiCriteria = previous.antiCriteria;

  const normalizedCriteria = state.criteria.map((c) => ({
    ...c,
    status: normalizeStatus(c.status),
  }));
  state.criteria = normalizedCriteria;

  const prevById = new Map(previous.criteria.map((c) => [c.id, c]));
  const nextById = new Map(state.criteria.map((c) => [c.id, c]));
  const snapshots: IscSnapshot[] = [];

  for (const next of state.criteria) {
    const prev = prevById.get(next.id);
    if (!prev) {
      snapshots.push({
        v: "0.1",
        ts: new Date().toISOString(),
        delta: "add",
        criterionId: next.id,
        to: next.status,
        sourceEventId,
      });
      continue;
    }
    const prevStatus = normalizeStatus(prev.status);
    const nextStatus = normalizeStatus(next.status);
    if (prevStatus !== nextStatus) {
      const delta: IscSnapshot["delta"] =
        nextStatus === "VERIFIED"
          ? "verify"
          : nextStatus === "FAILED"
            ? "fail"
            : "adjust";
      snapshots.push({
        v: "0.1",
        ts: new Date().toISOString(),
        delta,
        criterionId: next.id,
        from: prevStatus,
        to: nextStatus,
        sourceEventId,
      });
    }
  }

  for (const prev of previous.criteria) {
    if (!nextById.has(prev.id)) {
      snapshots.push({
        v: "0.1",
        ts: new Date().toISOString(),
        delta: "remove",
        criterionId: prev.id,
        from: prev.status,
        sourceEventId,
      });
    }
  }

  state.updatedAt = new Date().toISOString();
  await updateISCForSession(sessionId, state);

  if (snapshots.length > 0) {
    const lines = `${snapshots.map((s) => JSON.stringify(s)).join("\n")}\n`;
    try {
      await fs.promises.appendFile(snapshotsPath, lines);
    } catch (error) {
      fileLogError("Failed to append ISC snapshots", error);
    }
  }
}
