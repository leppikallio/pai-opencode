import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DUPLICATE_WINDOW_MS = 2_000;
const NOTIFIED_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const NOTIFIED_TASK_MAX_ENTRIES = 2_000;

const LOCK_STALE_MS = 10_000;
const LOCK_MAX_RETRIES = 40;
const LOCK_BASE_DELAY_MS = 10;

type LockFile = {
  ownerId: string;
  createdAt: number;
};

type LockHandle = {
  fileHandle: fs.promises.FileHandle;
  ownerId: string;
};

type SessionDuplicateRecord = {
  messageKey: string;
  atMs: number;
};

export type BackgroundTaskRecord = {
  task_id: string;
  child_session_id: string;
  parent_session_id: string;
  launched_at_ms: number;
  updated_at_ms: number;
};

type BackgroundTaskStateV1 = {
  version: 1;
  updatedAtMs: number;
  notifiedTaskIds: Record<string, number>;
  duplicateBySession: Record<string, SessionDuplicateRecord>;
  backgroundTasks: Record<string, BackgroundTaskRecord>;
};

export type RecordBackgroundTaskLaunchArgs = {
  taskId: string;
  childSessionId: string;
  parentSessionId: string;
  nowMs?: number;
};

export type ShouldSuppressDuplicateArgs = {
  sessionId: string;
  title: string;
  body: string;
  nowMs?: number;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingFileError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lockRetryDelay(attempt: number): number {
  return Math.min(100, LOCK_BASE_DELAY_MS * (attempt + 1));
}

function resolvePaiDir(): string {
  const fromEnv = process.env.PAI_DIR?.trim();
  if (fromEnv && !fromEnv.includes("${PAI_DIR}")) {
    return fromEnv;
  }

  return path.join(homedir(), ".config", "opencode");
}

export function getBackgroundTaskStatePath(): string {
  return path.join(resolvePaiDir(), "MEMORY", "STATE", "background-tasks.json");
}

function createDefaultState(nowMs: number): BackgroundTaskStateV1 {
  return {
    version: 1,
    updatedAtMs: nowMs,
    notifiedTaskIds: {},
    duplicateBySession: {},
    backgroundTasks: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value;
}

function coerceBackgroundTaskRecord(value: unknown): BackgroundTaskRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const taskId = asString(value.task_id);
  const childSessionId = asString(value.child_session_id);
  const parentSessionId = asString(value.parent_session_id);
  const launchedAtMs = asFiniteNumber(value.launched_at_ms);
  const updatedAtMs = asFiniteNumber(value.updated_at_ms);

  if (!taskId || !childSessionId || !parentSessionId || launchedAtMs == null || updatedAtMs == null) {
    return null;
  }

  return {
    task_id: taskId,
    child_session_id: childSessionId,
    parent_session_id: parentSessionId,
    launched_at_ms: launchedAtMs,
    updated_at_ms: updatedAtMs,
  };
}

function coerceState(value: unknown, nowMs: number): BackgroundTaskStateV1 {
  if (!isRecord(value) || value.version !== 1) {
    return createDefaultState(nowMs);
  }

  const notifiedTaskIds: Record<string, number> = {};
  const rawNotified = isRecord(value.notifiedTaskIds) ? value.notifiedTaskIds : {};
  for (const [taskId, atMs] of Object.entries(rawNotified)) {
    const parsedAtMs = asFiniteNumber(atMs);
    if (parsedAtMs == null) continue;
    notifiedTaskIds[taskId] = parsedAtMs;
  }

  const duplicateBySession: Record<string, SessionDuplicateRecord> = {};
  const rawDuplicateBySession = isRecord(value.duplicateBySession) ? value.duplicateBySession : {};
  for (const [sessionId, record] of Object.entries(rawDuplicateBySession)) {
    if (!isRecord(record)) continue;
    const messageKey = asString(record.messageKey);
    const atMs = asFiniteNumber(record.atMs);
    if (!messageKey || atMs == null) continue;
    duplicateBySession[sessionId] = { messageKey, atMs };
  }

  const backgroundTasks: Record<string, BackgroundTaskRecord> = {};
  const rawBackgroundTasks = isRecord(value.backgroundTasks) ? value.backgroundTasks : {};
  for (const [taskId, record] of Object.entries(rawBackgroundTasks)) {
    const parsed = coerceBackgroundTaskRecord(record);
    if (!parsed) continue;
    if (parsed.task_id !== taskId) continue;
    backgroundTasks[taskId] = parsed;
  }

  return {
    version: 1,
    updatedAtMs: asFiniteNumber(value.updatedAtMs) ?? nowMs,
    notifiedTaskIds,
    duplicateBySession,
    backgroundTasks,
  };
}

function createLockOwnerId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildStaleLockPath(lockPath: string, ownerId: string): string {
  return `${lockPath}.stale.${ownerId}.${Date.now()}`;
}

function isStaleLockFile(lockFile: LockFile): boolean {
  return Date.now() - lockFile.createdAt > LOCK_STALE_MS;
}

async function readLockFile(lockPath: string): Promise<LockFile | null> {
  try {
    const raw = await fs.promises.readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (typeof parsed.ownerId !== "string") return null;
    if (!Number.isFinite(parsed.createdAt)) return null;
    return {
      ownerId: parsed.ownerId,
      createdAt: Number(parsed.createdAt),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function maybeEvictStaleLock(lockPath: string, ownerId: string): Promise<void> {
  const lockFileBeforeRename = await readLockFile(lockPath);
  if (!lockFileBeforeRename) {
    return;
  }

  if (!isStaleLockFile(lockFileBeforeRename)) {
    return;
  }

  const stalePath = buildStaleLockPath(lockPath, ownerId);
  try {
    await fs.promises.rename(lockPath, stalePath);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return;
    }
    throw error;
  }

  const lockFileAfterRename = await readLockFile(stalePath);
  if (lockFileAfterRename && isStaleLockFile(lockFileAfterRename)) {
    return;
  }

  if (!(await pathExists(lockPath))) {
    try {
      await fs.promises.rename(stalePath, lockPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }
  }
}

async function acquireLock(lockPath: string): Promise<LockHandle> {
  const ownerId = createLockOwnerId();
  const lockPayload: LockFile = {
    ownerId,
    createdAt: Date.now(),
  };

  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt += 1) {
    try {
      const fileHandle = await fs.promises.open(lockPath, "wx");
      await fileHandle.writeFile(`${JSON.stringify(lockPayload)}\n`, "utf-8");
      await fileHandle.sync();
      return { fileHandle, ownerId };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") {
        throw error;
      }

      await maybeEvictStaleLock(lockPath, ownerId);

      if (attempt === LOCK_MAX_RETRIES) {
        throw new Error(`Failed to acquire background task state lock: ${lockPath}`);
      }

      await sleep(lockRetryDelay(attempt));
    }
  }

  throw new Error(`Failed to acquire background task state lock: ${lockPath}`);
}

async function releaseLock(lockPath: string, lockHandle: LockHandle): Promise<void> {
  try {
    await lockHandle.fileHandle.close();
  } finally {
    const lock = await readLockFile(lockPath);
    if (!lock || lock.ownerId !== lockHandle.ownerId) {
      return;
    }

    try {
      await fs.promises.unlink(lockPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
}

async function withStateLock<T>(statePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${statePath}.lock`;
  const lockHandle = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, lockHandle);
  }
}

function createCorruptStatePath(statePath: string): string {
  return `${statePath}.corrupt.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

async function archiveCorruptStateFile(statePath: string): Promise<void> {
  const corruptPath = createCorruptStatePath(statePath);
  try {
    await fs.promises.rename(statePath, corruptPath);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return;
    }
    throw error;
  }
}

async function readState(statePath: string, nowMs: number): Promise<BackgroundTaskStateV1> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(statePath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultState(nowMs);
    }
    throw error;
  }

  try {
    return coerceState(JSON.parse(raw), nowMs);
  } catch {
    await archiveCorruptStateFile(statePath);
    return createDefaultState(nowMs);
  }
}

function createTempPath(statePath: string): string {
  return `${statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeState(statePath: string, state: BackgroundTaskStateV1): Promise<void> {
  const stateDir = path.dirname(statePath);
  await fs.promises.mkdir(stateDir, { recursive: true });

  const tempPath = createTempPath(statePath);
  await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf-8");

  try {
    await fs.promises.rename(tempPath, statePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError)) {
        throw cleanupError;
      }
    }
    throw error;
  }
}

function normalizeNowMs(nowMs?: number): number {
  if (Number.isFinite(nowMs)) {
    return Number(nowMs);
  }
  return Date.now();
}

function buildMessageKey(title: string, body: string): string {
  return `${title}\u0000${body}`;
}

function pruneDuplicateState(state: BackgroundTaskStateV1, nowMs: number): void {
  for (const [sessionId, record] of Object.entries(state.duplicateBySession)) {
    if (nowMs - record.atMs >= DUPLICATE_WINDOW_MS) {
      delete state.duplicateBySession[sessionId];
    }
  }
}

function pruneNotifiedTaskIds(state: BackgroundTaskStateV1, nowMs: number): void {
  for (const [taskId, notifiedAtMs] of Object.entries(state.notifiedTaskIds)) {
    if (nowMs >= notifiedAtMs && nowMs - notifiedAtMs >= NOTIFIED_TASK_RETENTION_MS) {
      delete state.notifiedTaskIds[taskId];
    }
  }

  const entries = Object.entries(state.notifiedTaskIds);
  if (entries.length <= NOTIFIED_TASK_MAX_ENTRIES) {
    return;
  }

  const keepTaskIds = new Set(
    entries
      .sort((left, right) => right[1] - left[1])
      .slice(0, NOTIFIED_TASK_MAX_ENTRIES)
      .map(([taskId]) => taskId),
  );

  for (const taskId of Object.keys(state.notifiedTaskIds)) {
    if (!keepTaskIds.has(taskId)) {
      delete state.notifiedTaskIds[taskId];
    }
  }
}

function pruneState(state: BackgroundTaskStateV1, nowMs: number): void {
  pruneDuplicateState(state, nowMs);
  pruneNotifiedTaskIds(state, nowMs);
}

export async function markNotified(taskId: string, nowMs?: number): Promise<boolean> {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return false;
  }

  const statePath = getBackgroundTaskStatePath();
  const atMs = normalizeNowMs(nowMs);

  return withStateLock(statePath, async () => {
    const state = await readState(statePath, atMs);
    pruneState(state, atMs);

    if (state.notifiedTaskIds[normalizedTaskId] != null) {
      return false;
    }

    state.notifiedTaskIds[normalizedTaskId] = atMs;
    state.updatedAtMs = atMs;
    pruneState(state, atMs);
    await writeState(statePath, state);
    return true;
  });
}

export async function shouldSuppressDuplicate(args: ShouldSuppressDuplicateArgs): Promise<boolean> {
  const sessionId = args.sessionId.trim();
  if (!sessionId) {
    return false;
  }

  const nowMs = normalizeNowMs(args.nowMs);
  const messageKey = buildMessageKey(args.title, args.body);
  const statePath = getBackgroundTaskStatePath();

  return withStateLock(statePath, async () => {
    const state = await readState(statePath, nowMs);
    pruneState(state, nowMs);

    const existing = state.duplicateBySession[sessionId];
    const shouldSuppress =
      existing != null &&
      existing.messageKey === messageKey &&
      nowMs >= existing.atMs &&
      nowMs - existing.atMs < DUPLICATE_WINDOW_MS;

    state.duplicateBySession[sessionId] = {
      messageKey,
      atMs: nowMs,
    };
    state.updatedAtMs = nowMs;
    pruneState(state, nowMs);
    await writeState(statePath, state);

    return shouldSuppress;
  });
}

export async function recordBackgroundTaskLaunch(args: RecordBackgroundTaskLaunchArgs): Promise<void> {
  const taskId = args.taskId.trim();
  const childSessionId = args.childSessionId.trim();
  const parentSessionId = args.parentSessionId.trim();
  if (!taskId || !childSessionId || !parentSessionId) {
    throw new Error("recordBackgroundTaskLaunch requires taskId, childSessionId, and parentSessionId");
  }

  const nowMs = normalizeNowMs(args.nowMs);
  const statePath = getBackgroundTaskStatePath();

  await withStateLock(statePath, async () => {
    const state = await readState(statePath, nowMs);
    pruneState(state, nowMs);

    const existing = state.backgroundTasks[taskId];
    state.backgroundTasks[taskId] = {
      task_id: taskId,
      child_session_id: childSessionId,
      parent_session_id: parentSessionId,
      launched_at_ms: existing?.launched_at_ms ?? nowMs,
      updated_at_ms: nowMs,
    };
    state.updatedAtMs = nowMs;

    await writeState(statePath, state);
  });
}
