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
  getCurrentWorkPath,
  setCurrentWorkPath,
  clearCurrentWork,
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

// In-memory cache for current session
let currentSession: WorkSession | null = null;

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
  prompt: string
): Promise<CreateWorkResult> {
  try {
    // Check if session already exists
    const existingPath = await getCurrentWorkPath();
    if (existingPath && currentSession) {
      fileLog("Work session already exists, reusing", "debug");
      return { success: true, session: currentSession };
    }

    // Create session directory
    const workDir = getWorkDir();
    const yearMonth = getYearMonth();
    const timestamp = getTimestamp();
    const title = inferTitle(prompt);
    const slug = slugify(title);
    const sessionId = `${timestamp}_${slug}`;

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
      session_id: sessionId,
    };

    await fs.promises.writeFile(
      path.join(sessionPath, "META.yaml"),
      `status: ${meta.status}\nstarted_at: ${meta.started_at}\ntitle: "${meta.title}"\nsession_id: ${meta.session_id}\n`
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
    await setCurrentWorkPath(sessionPath);

    currentSession = {
      id: sessionId,
      path: sessionPath,
      title: title,
      started_at: meta.started_at,
      status: "ACTIVE",
    };

    fileLog(`Work session created: ${sessionId}`, "info");

    return { success: true, session: currentSession };
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
export function getCurrentSession(): WorkSession | null {
  return currentSession;
}

/**
 * Load current session from disk if cache is empty
 */
export async function getOrLoadCurrentSession(): Promise<WorkSession | null> {
  if (currentSession) return currentSession;
  const sessionPath = await getCurrentWorkPath();
  if (!sessionPath) return null;

  const metaPath = path.join(sessionPath, "META.yaml");
  try {
    const metaContent = await fs.promises.readFile(metaPath, "utf-8");
    const title = (metaContent.match(/title:\s*"?(.+?)"?\s*$/m) || [])[1];
    const status =
      (metaContent.match(/status:\s*(\w+)/) || [])[1] || "ACTIVE";
    const started_at =
      (metaContent.match(/started_at:\s*(.+)/) || [])[1] || new Date().toISOString();

    currentSession = {
      id: path.basename(sessionPath),
      path: sessionPath,
      title: title || "work-session",
      started_at,
      status: status as WorkSession["status"],
    };
    return currentSession;
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
export async function completeWorkSession(): Promise<CompleteWorkResult> {
  try {
    const sessionPath = await getCurrentWorkPath();
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
    await clearCurrentWork();
    currentSession = null;

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
  const sessionPath = await getCurrentWorkPath();
  if (!sessionPath) return;

  const metaPath = path.join(sessionPath, "META.yaml");
  const paused_at = new Date().toISOString();
  try {
    let metaContent = await fs.promises.readFile(metaPath, "utf-8");
    metaContent = metaContent.replace(/status: (ACTIVE|PAUSED)/, "status: PAUSED").trim();
    metaContent += `\npaused_at: ${paused_at}\n`;
    await fs.promises.writeFile(metaPath, metaContent);
    if (currentSession) currentSession.status = "PAUSED";
  } catch (error) {
    fileLogError("Failed to pause work session", error);
  }
}

/**
 * Resume a paused work session
 */
export async function resumeWorkSession(): Promise<void> {
  const sessionPath = await getCurrentWorkPath();
  if (!sessionPath) return;

  const metaPath = path.join(sessionPath, "META.yaml");
  const resumed_at = new Date().toISOString();
  try {
    let metaContent = await fs.promises.readFile(metaPath, "utf-8");
    metaContent = metaContent.replace(/status: (PAUSED|ACTIVE)/, "status: ACTIVE").trim();
    metaContent += `\nresumed_at: ${resumed_at}\n`;
    await fs.promises.writeFile(metaPath, metaContent);
    if (currentSession) currentSession.status = "ACTIVE";
  } catch (error) {
    fileLogError("Failed to resume work session", error);
  }
}

/**
 * Append to THREAD.md
 */
export async function appendToThread(content: string): Promise<void> {
  const sessionPath = await getCurrentWorkPath();
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
  const sessionPath = await getCurrentWorkPath();
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
  const sessionPath = await getCurrentWorkPath();
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
  await updateISC(state);

  if (snapshots.length > 0) {
    const lines = `${snapshots.map((s) => JSON.stringify(s)).join("\n")}\n`;
    try {
      await fs.promises.appendFile(snapshotsPath, lines);
    } catch (error) {
      fileLogError("Failed to append ISC snapshots", error);
    }
  }
}
