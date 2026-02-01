/**
 * PAI-OpenCode Path Utilities
 *
 * Canonical path construction for MEMORY, WORK, LEARNING directories.
 * Mirrors PAI v2.4 hooks/lib/paths.ts
 *
 * @module paths
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { getPaiDir } from "./pai-runtime";

/**
 * Get the PAI runtime directory path.
 *
 * For global installs this is usually: ~/.config/opencode
 */
export function getOpenCodeDir(): string {
  return getPaiDir();
}

/**
 * Get MEMORY directory path
 */
export function getMemoryDir(): string {
  return path.join(getOpenCodeDir(), "MEMORY");
}

/**
 * Get WORK directory path (for session tracking)
 */
export function getWorkDir(): string {
  return path.join(getMemoryDir(), "WORK");
}

/**
 * Get LEARNING directory path
 */
export function getLearningDir(): string {
  return path.join(getMemoryDir(), "LEARNING");
}

/**
 * Get RESEARCH directory path (for agent outputs)
 */
export function getResearchDir(): string {
  return path.join(getMemoryDir(), "RESEARCH");
}

/**
 * Get RAW directory path (event log)
 */
export function getRawDir(): string {
  return path.join(getMemoryDir(), "RAW");
}

/**
 * Get SECURITY directory path
 */
export function getSecurityDir(): string {
  return path.join(getMemoryDir(), "SECURITY");
}

/**
 * Get STATE directory path
 */
export function getStateDir(): string {
  return path.join(getMemoryDir(), "STATE");
}

/**
 * Get current year-month string (YYYY-MM)
 */
export function getYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get ISO timestamp for filenames
 */
export function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Get date string (YYYY-MM-DD)
 */
export function getDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate session ID from timestamp
 */
export function generateSessionId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const random = Math.random().toString(36).substring(2, 6);
  return `${timestamp}_${random}`;
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Get current work session path from state file
 */
export async function getCurrentWorkPath(): Promise<string | null> {
  throw new Error(
    "getCurrentWorkPath() now requires a sessionID. Use getCurrentWorkPathForSession(sessionID)."
  );
}

/**
 * Set current work session path in state file
 */
export type CurrentWorkStateV2 = {
  v: "0.2";
  updated_at: string;
  sessions: Record<string, { work_dir: string; started_at?: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function sanitizeSessionId(sessionId: string): string {
  // Allow only safe path characters.
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function readCurrentWorkState(stateFile: string): Promise<CurrentWorkStateV2> {
  try {
    const content = await fs.promises.readFile(stateFile, "utf-8");
    const parsed = JSON.parse(content);
    if (isRecord(parsed) && parsed.v === "0.2" && isRecord(parsed.sessions)) {
      const sessions: Record<string, { work_dir: string; started_at?: string }> = {};
      for (const [k, v] of Object.entries(parsed.sessions)) {
        if (!isRecord(v)) continue;
        const workDir = readString(v, "work_dir");
        if (!workDir) continue;
        const startedAt = readString(v, "started_at");
        sessions[String(k)] = { work_dir: workDir, ...(startedAt ? { started_at: startedAt } : {}) };
      }
      return {
        v: "0.2",
        updated_at: readString(parsed, "updated_at") ?? new Date().toISOString(),
        sessions,
      };
    }
  } catch {
    // fall through
  }

  return {
    v: "0.2",
    updated_at: new Date().toISOString(),
    sessions: {},
  };
}

async function writeCurrentWorkState(stateFile: string, state: CurrentWorkStateV2): Promise<void> {
  await ensureDir(getStateDir());
  await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2));
}

export async function getCurrentWorkPathForSession(sessionIdRaw: string): Promise<string | null> {
  const stateFile = path.join(getStateDir(), "current-work.json");
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return null;

  const state = await readCurrentWorkState(stateFile);
  const entry = state.sessions[sessionId];
  if (entry?.work_dir) return entry.work_dir;

  return null;
}

export async function setCurrentWorkPathForSession(sessionIdRaw: string, workPath: string): Promise<void> {
  const stateFile = path.join(getStateDir(), "current-work.json");
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return;

  const state = await readCurrentWorkState(stateFile);
  state.sessions[sessionId] = { work_dir: workPath, started_at: new Date().toISOString() };
  state.updated_at = new Date().toISOString();
  await writeCurrentWorkState(stateFile, state);
}

/**
 * Clear current work session
 */
export async function clearCurrentWorkForSession(sessionIdRaw: string): Promise<void> {
  const stateFile = path.join(getStateDir(), "current-work.json");
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return;

  try {
    const state = await readCurrentWorkState(stateFile);
    delete state.sessions[sessionId];
    state.updated_at = new Date().toISOString();
    await writeCurrentWorkState(stateFile, state);
  } catch {
    // Best effort
  }
}

/**
 * Slugify text for filenames
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
