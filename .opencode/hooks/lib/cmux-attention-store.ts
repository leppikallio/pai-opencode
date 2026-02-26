import fs from "node:fs";
import path from "node:path";

import { paiPath } from "./paths";

export interface ShouldEmitAttentionArgs {
  dedupeKey: string;
  nowMs: number;
  windowMs: number;
}

interface AttentionDedupeStateV1 {
  version: 1;
  updatedAtMs: number;
  lastSeenByKey: Record<string, number>;
}

const STATE_FILE_NAME = "cmux-attention-dedupe.json";
const DEFAULT_WINDOW_MS = 2_000;
const lockByStatePath = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function normalizeNowMs(nowMs: number): number {
  return Number.isFinite(nowMs) ? nowMs : Date.now();
}

function normalizeWindowMs(windowMs: number): number {
  if (Number.isFinite(windowMs) && windowMs > 0) {
    return windowMs;
  }

  return DEFAULT_WINDOW_MS;
}

function createDefaultState(nowMs: number): AttentionDedupeStateV1 {
  return {
    version: 1,
    updatedAtMs: nowMs,
    lastSeenByKey: {},
  };
}

function coerceState(value: unknown, nowMs: number): AttentionDedupeStateV1 {
  if (!isRecord(value) || value.version !== 1) {
    return createDefaultState(nowMs);
  }

  const lastSeenByKey: Record<string, number> = {};
  const rawLastSeenByKey = isRecord(value.lastSeenByKey) ? value.lastSeenByKey : {};

  for (const [key, seenAtMs] of Object.entries(rawLastSeenByKey)) {
    const parsedSeenAtMs = asFiniteNumber(seenAtMs);
    if (parsedSeenAtMs == null) {
      continue;
    }

    lastSeenByKey[key] = parsedSeenAtMs;
  }

  return {
    version: 1,
    updatedAtMs: asFiniteNumber(value.updatedAtMs) ?? nowMs,
    lastSeenByKey,
  };
}

function dedupeStatePath(): string {
  return paiPath("MEMORY", "STATE", STATE_FILE_NAME);
}

async function readState(statePath: string, nowMs: number): Promise<AttentionDedupeStateV1> {
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
    return createDefaultState(nowMs);
  }
}

function pruneStaleKeys(state: AttentionDedupeStateV1, nowMs: number, windowMs: number): void {
  for (const [key, seenAtMs] of Object.entries(state.lastSeenByKey)) {
    if (nowMs >= seenAtMs && nowMs - seenAtMs >= windowMs) {
      delete state.lastSeenByKey[key];
    }
  }
}

function tempStatePath(statePath: string): string {
  return path.join(
    path.dirname(statePath),
    `.${path.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

async function writeStateAtomic(statePath: string, state: AttentionDedupeStateV1): Promise<void> {
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

  const tmpPath = tempStatePath(statePath);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  await fs.promises.writeFile(tmpPath, serialized, "utf-8");

  try {
    await fs.promises.rename(tmpPath, statePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {}

    throw error;
  }
}

async function writeStateBestEffort(statePath: string, state: AttentionDedupeStateV1): Promise<void> {
  try {
    await writeStateAtomic(statePath, state);
    return;
  } catch {}

  const serialized = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
    await fs.promises.writeFile(statePath, serialized, "utf-8");
  } catch {
    // Best effort only.
  }
}

async function withStateLock<T>(statePath: string, run: () => Promise<T>): Promise<T> {
  const previous = lockByStatePath.get(statePath) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queued = previous.then(() => current);
  lockByStatePath.set(statePath, queued);

  await previous;

  try {
    return await run();
  } finally {
    release();
    if (lockByStatePath.get(statePath) === queued) {
      lockByStatePath.delete(statePath);
    }
  }
}

export function __testOnlyGetStateLockCount(): number {
  return lockByStatePath.size;
}

export async function shouldEmitAttention(args: ShouldEmitAttentionArgs): Promise<boolean> {
  const dedupeKey = args.dedupeKey.trim();
  if (!dedupeKey) {
    return true;
  }

  const nowMs = normalizeNowMs(args.nowMs);
  const windowMs = normalizeWindowMs(args.windowMs);
  const statePath = dedupeStatePath();

  try {
    return await withStateLock(statePath, async () => {
      const state = await readState(statePath, nowMs);
      const seenAtMs = state.lastSeenByKey[dedupeKey];
      const shouldSuppress =
        seenAtMs != null && nowMs >= seenAtMs && nowMs - seenAtMs < windowMs;

      if (shouldSuppress) {
        return false;
      }

      state.lastSeenByKey[dedupeKey] = nowMs;
      state.updatedAtMs = nowMs;
      pruneStaleKeys(state, nowMs, windowMs);
      await writeStateBestEffort(statePath, state);

      return true;
    });
  } catch {
    return true;
  }
}
