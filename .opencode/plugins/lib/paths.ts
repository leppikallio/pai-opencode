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

type CurrentWorkLockRecordV1 = {
  created_at: string;
  token: string;
};

type CurrentWorkLockHandle = {
  lockDir: string;
  token: string;
};

const CURRENT_WORK_STATE_FILE = "current-work.json";
const CURRENT_WORK_LOCK_DIR = "current-work.lock";
const CURRENT_WORK_LOCK_INFO_FILE = "lock.json";
const CURRENT_WORK_LOCK_STALE_TTL_MS = 10_000;
const CURRENT_WORK_LOCK_MAX_WAIT_MS = 2_000;
const CURRENT_WORK_LOCK_BASE_DELAY_MS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function sanitizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) return "";
  if (trimmed.length > 128) return "";
  // Allow only safe path characters.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "";
  return trimmed;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function createCurrentWorkLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCurrentWorkLockInfoPath(lockDir: string): string {
  return path.join(lockDir, CURRENT_WORK_LOCK_INFO_FILE);
}

function getCurrentWorkLockRetryDelay(attempt: number): number {
  const base = Math.min(100, CURRENT_WORK_LOCK_BASE_DELAY_MS * (attempt + 1));
  const jitter = Math.floor(Math.random() * 7);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isCurrentWorkLockRecordV1(value: unknown): value is CurrentWorkLockRecordV1 {
  if (!isRecord(value)) return false;
  return typeof value.created_at === "string" && typeof value.token === "string";
}

async function readCurrentWorkLockRecord(lockDir: string): Promise<CurrentWorkLockRecordV1 | null> {
  const lockInfoPath = getCurrentWorkLockInfoPath(lockDir);
  try {
    const raw = await fs.promises.readFile(lockInfoPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isCurrentWorkLockRecordV1(parsed)) return null;
    return parsed;
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    return null;
  }
}

async function writeCurrentWorkLockRecord(
  lockDir: string,
  lockRecord: CurrentWorkLockRecordV1,
): Promise<void> {
  const lockInfoPath = getCurrentWorkLockInfoPath(lockDir);
  await fs.promises.writeFile(lockInfoPath, `${JSON.stringify(lockRecord)}\n`, "utf-8");
}

function isCurrentWorkLockStale(lockRecord: CurrentWorkLockRecordV1): boolean {
  const createdAtMs = Date.parse(lockRecord.created_at);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return Date.now() - createdAtMs > CURRENT_WORK_LOCK_STALE_TTL_MS;
}

async function breakCurrentWorkLockIfStale(lockDir: string, contenderToken: string): Promise<boolean> {
  const current = await readCurrentWorkLockRecord(lockDir);
  if (!current || !isCurrentWorkLockStale(current)) {
    return false;
  }

  const quarantinePath = `${lockDir}.quarantine.${Date.now()}.${contenderToken}`;
  try {
    await fs.promises.rename(lockDir, quarantinePath);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return false;
    }
    throw error;
  }

  await fs.promises.rm(quarantinePath, { recursive: true, force: true });
  process.stderr.write("PAI_STATE_CURRENT_WORK_LOCK_BROKEN_STALE\n");
  return true;
}

async function acquireCurrentWorkLock(stateDir: string): Promise<CurrentWorkLockHandle | null> {
  await ensureDir(stateDir);

  const lockDir = path.join(stateDir, CURRENT_WORK_LOCK_DIR);
  const token = createCurrentWorkLockToken();
  const lockRecord: CurrentWorkLockRecordV1 = {
    created_at: new Date().toISOString(),
    token,
  };
  const startedAt = Date.now();

  let attempt = 0;
  while (Date.now() - startedAt < CURRENT_WORK_LOCK_MAX_WAIT_MS) {
    try {
      await fs.promises.mkdir(lockDir);
      await writeCurrentWorkLockRecord(lockDir, lockRecord);
      return { lockDir, token };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") {
        throw error;
      }

      await breakCurrentWorkLockIfStale(lockDir, token);

      const remainingMs = CURRENT_WORK_LOCK_MAX_WAIT_MS - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        break;
      }

      const delay = Math.min(getCurrentWorkLockRetryDelay(attempt), remainingMs);
      await sleep(Math.max(1, delay));
      attempt += 1;
    }
  }

  process.stderr.write("PAI_STATE_CURRENT_WORK_LOCK_TIMEOUT\n");
  return null;
}

async function releaseCurrentWorkLock(lockHandle: CurrentWorkLockHandle): Promise<void> {
  const current = await readCurrentWorkLockRecord(lockHandle.lockDir);
  if (!current || current.token !== lockHandle.token) {
    return;
  }

  try {
    await fs.promises.rm(lockHandle.lockDir, { recursive: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
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
  const directory = path.dirname(stateFile);
  await ensureDir(directory);

  const tempFile = path.join(
    directory,
    `.${path.basename(stateFile)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.promises.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  try {
    await fs.promises.rename(tempFile, stateFile);
  } catch (error) {
    try {
      await fs.promises.unlink(tempFile);
    } catch (cleanupError) {
      if (!isMissingPathError(cleanupError)) {
        throw cleanupError;
      }
    }
    throw error;
  }
}

export async function getCurrentWorkPathForSession(sessionIdRaw: string): Promise<string | null> {
  const stateFile = path.join(getStateDir(), CURRENT_WORK_STATE_FILE);
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return null;

  const state = await readCurrentWorkState(stateFile);
  const entry = state.sessions[sessionId];
  if (entry?.work_dir) {
    // Guard against tampered STATE: only allow paths inside MEMORY/WORK.
    const workRoot = path.resolve(getWorkDir());
    const candidate = path.resolve(entry.work_dir);
    const rel = path.relative(workRoot, candidate);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return candidate;
    }
    process.stderr.write("PAI_STATE_CURRENT_WORK_MAPPING_OUT_OF_ROOT\n");
    return null;
  }

  return null;
}

export async function setCurrentWorkPathForSession(sessionIdRaw: string, workPath: string): Promise<void> {
  const stateDir = getStateDir();
  const stateFile = path.join(stateDir, CURRENT_WORK_STATE_FILE);
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return;

  // Guard: refuse to persist paths outside MEMORY/WORK.
  const workRoot = path.resolve(getWorkDir());
  const candidate = path.resolve(workPath);
  const rel = path.relative(workRoot, candidate);
  if (!(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)))) {
    process.stderr.write("PAI_STATE_CURRENT_WORK_MAPPING_OUT_OF_ROOT\n");
    return;
  }

  const lockHandle = await acquireCurrentWorkLock(stateDir);
  if (!lockHandle) {
    return;
  }

  try {
    const state = await readCurrentWorkState(stateFile);
    state.sessions[sessionId] = { work_dir: candidate, started_at: new Date().toISOString() };
    state.updated_at = new Date().toISOString();
    await writeCurrentWorkState(stateFile, state);
  } finally {
    await releaseCurrentWorkLock(lockHandle);
  }
}

/**
 * Clear current work session
 */
export async function clearCurrentWorkForSession(sessionIdRaw: string): Promise<void> {
  const stateDir = getStateDir();
  const stateFile = path.join(stateDir, CURRENT_WORK_STATE_FILE);
  const sessionId = sanitizeSessionId(sessionIdRaw);
  if (!sessionId) return;

  const lockHandle = await acquireCurrentWorkLock(stateDir);
  if (!lockHandle) {
    return;
  }

  try {
    const state = await readCurrentWorkState(stateFile);
    delete state.sessions[sessionId];
    state.updated_at = new Date().toISOString();
    await writeCurrentWorkState(stateFile, state);
  } catch {
    // Best effort
  } finally {
    await releaseCurrentWorkLock(lockHandle);
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
