import fs from "node:fs";
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

async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  const lockHandle = await fs.promises.open(lockPath, "a+");

  try {
    return await fn();
  } finally {
    await lockHandle.close();
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
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.writeFile(statePath, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export async function upsertSessionMapping(args: {
  statePath: string;
  sessionId: string;
  workspaceId: string;
  surfaceId: string;
  cwd?: string;
}): Promise<void> {
  const now = Date.now();

  await withLock(`${args.statePath}.lock`, async () => {
    const store = await readStore(args.statePath);
    const existing = store.sessions[args.sessionId];

    store.sessions[args.sessionId] = {
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      surfaceId: args.surfaceId,
      cwd: args.cwd,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
    };

    await writeStore(args.statePath, store);
  });
}

export async function lookupSessionMapping(args: {
  statePath: string;
  sessionId: string;
}): Promise<RecordV1 | null> {
  const store = await readStore(args.statePath);
  return store.sessions[args.sessionId] ?? null;
}
