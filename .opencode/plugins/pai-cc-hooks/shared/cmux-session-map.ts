import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type RecordV1 = {
  sessionId: string;
  workspaceId: string;
  surfaceId: string;
  cwd?: string;
  startedAt: number;
  updatedAt: number;
};

export type StoreV1 = {
  version: 1;
  sessions: Record<string, RecordV1>;
};

const LOCK_STALE_MS = 10_000;
const LOCK_MAX_RETRIES = 50;
const LOCK_BASE_DELAY_MS = 10;
const LOCK_DEFAULT_MAX_WAIT_MS = 5_000;
const LOCK_MAX_WAIT_ENV = "PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS";
const LOCK_FORCE_RENAME_NON_STALE_ENV = "PAI_CMUX_SESSION_MAP_TEST_FORCE_RENAME_NON_STALE";

type LockFileV1 = {
  ownerId: string;
  createdAt: number;
};

type LockHandle = {
  fileHandle: fs.promises.FileHandle;
  ownerId: string;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingFileError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function getLockRetryDelay(attempt: number): number {
  return Math.min(100, LOCK_BASE_DELAY_MS * (attempt + 1));
}

function getLockMaxWaitMs(): number {
  const raw = process.env[LOCK_MAX_WAIT_ENV];
  if (!raw) {
    return LOCK_DEFAULT_MAX_WAIT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return LOCK_DEFAULT_MAX_WAIT_MS;
  }

  return parsed;
}

function shouldForceRenameNonStaleLockForTest(): boolean {
  return process.env[LOCK_FORCE_RENAME_NON_STALE_ENV] === "1";
}

function createLockOwnerId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildStaleLockPath(lockPath: string, ownerId: string): string {
  return `${lockPath}.stale.${ownerId}.${Date.now()}`;
}

function isLockFileV1(value: unknown): value is LockFileV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const maybe = value as Partial<LockFileV1>;
  return typeof maybe.ownerId === "string" && Number.isFinite(maybe.createdAt);
}

function isStaleLockFile(lockFile: LockFileV1): boolean {
  return Date.now() - lockFile.createdAt > LOCK_STALE_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readLockFile(lockPath: string): Promise<LockFileV1 | null> {
  try {
    const raw = await fs.promises.readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    return isLockFileV1(parsed) ? parsed : null;
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

async function maybeEvictStaleLock(lockPath: string, ownerId: string): Promise<boolean> {
  const lockFileBeforeRename = await readLockFile(lockPath);
  if (!lockFileBeforeRename) {
    return false;
  }

  const staleBeforeRename = isStaleLockFile(lockFileBeforeRename);
  if (!staleBeforeRename && !shouldForceRenameNonStaleLockForTest()) {
    return false;
  }

  const stalePath = buildStaleLockPath(lockPath, ownerId);
  try {
    await fs.promises.rename(lockPath, stalePath);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return false;
    }
    throw error;
  }

  const lockFileAfterRename = await readLockFile(stalePath);
  if (lockFileAfterRename && isStaleLockFile(lockFileAfterRename)) {
    return true;
  }

  if (!(await pathExists(lockPath))) {
    try {
      await fs.promises.rename(stalePath, lockPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }
      throw error;
    }
  }

  return false;
}

async function acquireLock(lockPath: string): Promise<LockHandle> {
  const ownerId = createLockOwnerId();
  const lockFile: LockFileV1 = { ownerId, createdAt: Date.now() };
  const startedAt = Date.now();
  const maxWaitMs = getLockMaxWaitMs();

  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt += 1) {
    try {
      const fileHandle = await fs.promises.open(lockPath, "wx");
      await fileHandle.writeFile(`${JSON.stringify(lockFile)}\n`, "utf-8");
      await fileHandle.sync();
      return { fileHandle, ownerId };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") {
        throw error;
      }

      await maybeEvictStaleLock(lockPath, ownerId);

      if (attempt === LOCK_MAX_RETRIES || Date.now() - startedAt >= maxWaitMs) {
        throw new Error(`Failed to acquire cmux session map lock: ${lockPath}`);
      }

      const remainingMs = maxWaitMs - (Date.now() - startedAt);
      await sleep(Math.min(getLockRetryDelay(attempt), Math.max(1, remainingMs)));
    }
  }

  throw new Error(`Failed to acquire cmux session map lock: ${lockPath}`);
}

async function releaseLock(lockPath: string, lockHandle: LockHandle): Promise<void> {
  try {
    await lockHandle.fileHandle.close();
  } finally {
    const currentLockFile = await readLockFile(lockPath);
    if (!currentLockFile || currentLockFile.ownerId !== lockHandle.ownerId) {
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

export function getDefaultCmuxSessionMapPath(args?: { homeDir?: string }): string {
  const home = args?.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return path.join(home, ".cmuxterm", "opencode-hook-sessions.json");
}

function resolveStatePath(statePath?: string): string {
  return statePath ?? getDefaultCmuxSessionMapPath();
}

async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  const lockHandle = await acquireLock(lockPath);

  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, lockHandle);
  }
}

async function readStore(statePath: string): Promise<StoreV1> {
  try {
    const raw = await fs.promises.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreV1>;

    if (parsed.version === 1 && parsed.sessions && typeof parsed.sessions === "object") {
      return parsed as StoreV1;
    }
  } catch {
    // ignore malformed/missing store and return default
  }

  return { version: 1, sessions: {} };
}

async function writeStore(statePath: string, store: StoreV1): Promise<void> {
  const directory = path.dirname(statePath);
  await fs.promises.mkdir(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.promises.writeFile(tempPath, JSON.stringify(store, null, 2) + "\n", "utf-8");

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

export async function upsertSessionMapping(args: {
  statePath?: string;
  sessionId: string;
  workspaceId: string;
  surfaceId: string;
  cwd?: string;
}): Promise<void> {
  const statePath = resolveStatePath(args.statePath);
  const now = Date.now();

  await withLock(`${statePath}.lock`, async () => {
    const store = await readStore(statePath);
    const existing = store.sessions[args.sessionId];

    store.sessions[args.sessionId] = {
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      surfaceId: args.surfaceId,
      cwd: args.cwd,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
    };

    await writeStore(statePath, store);
  });
}

export async function lookupSessionMapping(args: {
  statePath?: string;
  sessionId: string;
}): Promise<RecordV1 | null> {
  const store = await readStore(resolveStatePath(args.statePath));
  return store.sessions[args.sessionId] ?? null;
}
