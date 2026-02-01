/**
 * Scratchpad session workspace
 *
 * Creates a per-session scratchpad dir under <PAI_DIR>/scratchpad/sessions/
 * and deletes it when the OpenCode session ends.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileLog, fileLogError } from "./file-logger";
import { ensureDir, generateSessionId } from "./paths";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

export type ScratchpadState = {
  id: string;
  dir: string;
  created_at: string;
};

function getStatePath(): string {
  return path.join(getStateDir(), "scratchpad.json");
}

function getStateDir(): string {
  const fromEnv = process.env.XDG_CONFIG_HOME;
  const xdg = fromEnv?.trim() ? fromEnv.trim() : path.join(os.homedir(), ".config");
  return path.join(xdg, "opencode", "MEMORY", "STATE");
}

function getOpenCodeDir(): string {
  const fromEnv = process.env.XDG_CONFIG_HOME;
  const xdg = fromEnv?.trim() ? fromEnv.trim() : path.join(os.homedir(), ".config");
  return path.join(xdg, "opencode");
}

export function getScratchpadRoot(): string {
  // Always use the global OpenCode config directory for scratchpad,
  // regardless of whether this code is running from the repo tree.
  return path.join(getOpenCodeDir(), "scratchpad");
}

function getScratchpadSessionsRoot(): string {
  return path.join(getScratchpadRoot(), "sessions");
}

async function readState(): Promise<ScratchpadState | null> {
  try {
    const raw = await fs.promises.readFile(getStatePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const id = getStringProp(parsed, "id");
    const dir = getStringProp(parsed, "dir");
    const created_at = getStringProp(parsed, "created_at");
    if (!id || !dir || !created_at) return null;
    return { id, dir, created_at };
  } catch {
    return null;
  }
}

async function writeState(next: ScratchpadState): Promise<void> {
  await ensureDir(getStateDir());
  await fs.promises.writeFile(getStatePath(), JSON.stringify(next, null, 2));
}

function isSafeSessionDir(candidateDir: string): boolean {
  const root = path.resolve(getScratchpadSessionsRoot());
  const resolved = path.resolve(candidateDir);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(prefix);
}

async function createNewSession(): Promise<ScratchpadState> {
  const sessionsRoot = getScratchpadSessionsRoot();
  await ensureDir(sessionsRoot);

  const id = generateSessionId();
  const dir = path.join(sessionsRoot, id);
  await ensureDir(dir);

  const state: ScratchpadState = {
    id,
    dir,
    created_at: new Date().toISOString(),
  };
  await writeState(state);
  return state;
}

function normalizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function ensureScratchpadSession(sessionIdRaw?: string): Promise<ScratchpadState> {
  try {
    const sessionId = sessionIdRaw ? normalizeSessionId(sessionIdRaw) : "";

    // If the OpenCode sessionID is known, use a deterministic directory.
    // Do NOT persist pointer state in scratchpad.json for this case.
    if (sessionId) {
      const sessionsRoot = getScratchpadSessionsRoot();
      await ensureDir(sessionsRoot);
      const dir = path.join(sessionsRoot, sessionId);
      await ensureDir(dir);
      return { id: sessionId, dir, created_at: new Date().toISOString() };
    }

    const existing = await readState();
    if (existing?.dir && isSafeSessionDir(existing.dir)) {
      try {
        const st = await fs.promises.stat(existing.dir);
        if (st.isDirectory()) return existing;
      } catch {
        // fall through to recreate
      }
    }

    const created = await createNewSession();
    fileLog(`Scratchpad session created: ${created.dir}`, "info");
    return created;
  } catch (error) {
    fileLogError("Failed to ensure scratchpad session", error);
    // Last resort: return a best-effort dir (no state).
    const sessionsRoot = getScratchpadSessionsRoot();
    const id = generateSessionId();
    const dir = path.join(sessionsRoot, id);
    try {
      await ensureDir(dir);
    } catch {
      // ignore
    }
    return { id, dir, created_at: new Date().toISOString() };
  }
}

export async function clearScratchpadSession(): Promise<void> {
  try {
    const existing = await readState();
    if (!existing?.dir) return;

    if (!isSafeSessionDir(existing.dir)) {
      fileLog(`Refusing to delete non-scratchpad dir: ${existing.dir}`, "error");
      return;
    }

    // Do not delete historical scratchpad directories automatically.
    // Only clear the pointer state so a future session can create a new one.
    await fs.promises.unlink(getStatePath()).catch(() => undefined);
    fileLog(`Scratchpad session finalized (kept): ${existing.dir}`, "info");
  } catch (error) {
    fileLogError("Failed to clear scratchpad session", error);
  }
}
