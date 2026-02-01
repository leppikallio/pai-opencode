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

function normalizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
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

/**
 * Create a new work session
 *
 * Called on first user prompt if no active session exists.
 * Creates MEMORY/WORK/{timestamp}_{title}/ structure.
 */
export async function createWorkSession(
  sessionIdRaw: string,
  seed: string
): Promise<CreateWorkResult> {
  try {
    const sessionId = normalizeSessionId(sessionIdRaw);
    if (!sessionId) {
      return { success: false, error: "Invalid session id" };
    }

    // Check if session already exists
    const existingPath = await getCurrentWorkPathForSession(sessionId);
    const cached = currentSessions.get(sessionId);
    if (existingPath && cached) {
      fileLog("Work session already exists, reusing", "debug");
      return { success: true, session: cached };
    }

    if (existingPath && !cached) {
      const loaded = await getOrLoadCurrentSession(sessionId);
      if (loaded) return { success: true, session: loaded };
    }

    // Create session directory
    const workDir = getWorkDir();
    const yearMonth = getYearMonth();
    const timestamp = getTimestamp();
    const title = inferTitle(seed);
    const slug = slugify(title);
    const workId = `${timestamp}_${slug}`;

    const sessionPath = path.join(workDir, yearMonth, sessionId);
    await ensureDir(sessionPath);

    // Create subdirectories
    await ensureDir(path.join(sessionPath, "tasks"));
    await ensureDir(path.join(sessionPath, "scratch"));

    // Create META.yaml
    const meta = {
      status: "ACTIVE",
      started_at: new Date().toISOString(),
      title: title,
      opencode_session_id: sessionId,
      work_id: workId,
    };

    await fs.promises.writeFile(
      path.join(sessionPath, "META.yaml"),
      `status: ${meta.status}\nstarted_at: ${meta.started_at}\ntitle: "${meta.title}"\nopencode_session_id: ${meta.opencode_session_id}\nwork_id: ${meta.work_id}\n`
    );

    // Create empty ISC.json (v0.1)
    await fs.promises.writeFile(
      path.join(sessionPath, "ISC.json"),
      JSON.stringify(createEmptyIscState(), null, 2)
    );

    // Create THREAD.md
    await fs.promises.writeFile(
      path.join(sessionPath, "THREAD.md"),
      `# ${title}\n\n**Started:** ${meta.started_at}\n**Status:** ACTIVE\n\n---\n\n`
    );

    // Update state
    await setCurrentWorkPathForSession(sessionId, sessionPath);

    const session: WorkSession = {
      id: sessionId,
      path: sessionPath,
      title: title,
      started_at: meta.started_at,
      status: "ACTIVE",
    };

    currentSessions.set(sessionId, session);

    fileLog(`Work session created: ${sessionId}`, "info");

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

  const metaPath = path.join(sessionPath, "META.yaml");
  try {
    const metaContent = await fs.promises.readFile(metaPath, "utf-8");
    const title = (metaContent.match(/title:\s*"?(.+?)"?\s*$/m) || [])[1];
    const status =
      (metaContent.match(/status:\s*(\w+)/) || [])[1] || "ACTIVE";
    const started_at =
      (metaContent.match(/started_at:\s*(.+)/) || [])[1] || new Date().toISOString();

    const session: WorkSession = {
      id: sessionId,
      path: sessionPath,
      title: title || "work-session",
      started_at,
      status: status as WorkSession["status"],
    };
    currentSessions.set(sessionId, session);
    return session;
  } catch (error) {
    fileLogError("Failed to load current session", error);
    return null;
  }
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

    // Update status
    metaContent = metaContent
      .replace(/status: (ACTIVE|PAUSED)/, "status: COMPLETED")
      .trim();
    metaContent += `\ncompleted_at: ${completed_at}\n`;

    await fs.promises.writeFile(metaPath, metaContent);

    // Clear state
    await clearCurrentWorkForSession(sessionId);
    currentSessions.delete(sessionId);

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
export async function appendToThread(content: string): Promise<void> {
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
export async function updateISC(state: IscState): Promise<void> {
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
  state: IscState,
  sourceEventId: string
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
