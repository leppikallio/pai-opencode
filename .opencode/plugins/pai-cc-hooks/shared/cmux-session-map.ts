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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingFileError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function getLockRetryDelay(attempt: number): number {
  return Math.min(100, LOCK_BASE_DELAY_MS * (attempt + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function maybeClearStaleLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
      return;
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  try {
    await fs.promises.unlink(lockPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function acquireLock(lockPath: string): Promise<fs.promises.FileHandle> {
  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt += 1) {
    try {
      return await fs.promises.open(lockPath, "wx");
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") {
        throw error;
      }

      await maybeClearStaleLock(lockPath);

      if (attempt === LOCK_MAX_RETRIES) {
        throw new Error(`Failed to acquire cmux session map lock: ${lockPath}`);
      }

      await sleep(getLockRetryDelay(attempt));
    }
  }

  throw new Error(`Failed to acquire cmux session map lock: ${lockPath}`);
}

async function releaseLock(lockPath: string, lockHandle: fs.promises.FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } finally {
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
