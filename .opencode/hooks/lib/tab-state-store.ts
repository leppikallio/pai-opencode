import fs from "node:fs";
import path from "node:path";

import { paiPath } from "./paths";

export type TabState = "idle" | "thinking" | "working" | "question" | "completed";

export type AlgorithmTabPhase =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "BUILD"
  | "EXECUTE"
  | "VERIFY"
  | "LEARN"
  | "COMPLETE"
  | "IDLE";

export interface TabSnapshot {
  title: string;
  state: TabState;
  previousTitle?: string;
  phase?: AlgorithmTabPhase;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SESSION_ID_LENGTH = 120;

const VALID_TAB_STATES = new Set<TabState>(["idle", "thinking", "working", "question", "completed"]);
const VALID_PHASES = new Set<AlgorithmTabPhase>([
  "OBSERVE",
  "THINK",
  "PLAN",
  "BUILD",
  "EXECUTE",
  "VERIFY",
  "LEARN",
  "COMPLETE",
  "IDLE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTabSessionId(sessionId?: string): string | null {
  if (!sessionId) {
    return null;
  }

  const trimmed = sessionId.trim();
  if (!trimmed || trimmed.length > MAX_SESSION_ID_LENGTH) {
    return null;
  }

  return SESSION_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function isTabSnapshot(value: unknown): value is TabSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.title !== "string" || !VALID_TAB_STATES.has(value.state as TabState)) {
    return false;
  }

  if (value.previousTitle !== undefined && typeof value.previousTitle !== "string") {
    return false;
  }

  if (value.phase !== undefined && !VALID_PHASES.has(value.phase as AlgorithmTabPhase)) {
    return false;
  }

  return true;
}

function statePathForSession(sessionId: string): string {
  return paiPath("MEMORY", "STATE", `tab-state-${sessionId}.json`);
}

export function readTabSnapshot(sessionId?: string): TabSnapshot | null {
  const normalizedSessionId = normalizeTabSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const statePath = statePathForSession(normalizedSessionId);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return isTabSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeTabSnapshotAtomic(sessionId: string | undefined, snapshot: TabSnapshot): Promise<void> {
  const normalizedSessionId = normalizeTabSessionId(sessionId);
  if (!normalizedSessionId || !isTabSnapshot(snapshot)) {
    return;
  }

  const statePath = statePathForSession(normalizedSessionId);
  const directory = path.dirname(statePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
    await fs.promises.rename(tempPath, statePath);
  } catch {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // No-op by design.
    }
  }
}
