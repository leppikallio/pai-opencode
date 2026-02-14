import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

export type ToolJson = {
  ok: boolean;
  [key: string]: unknown;
};

export function asRecord(value: unknown, label = "value"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseToolJson(raw: string): ToolJson {
  const v = JSON.parse(raw) as ToolJson;
  if (!v || typeof v !== "object") throw new Error(`Tool returned non-object JSON: ${raw}`);
  if (typeof v.ok !== "boolean") throw new Error(`Tool JSON missing boolean 'ok': ${raw}`);
  return v;
}

export async function mkTempDir(prefix = "dr-test-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>, prefix = "dr-test-") {
  const dir = await mkTempDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function resolveOpencodeRootFromCwd(): string {
  // Tests are often run from `.opencode/` but should also work from repo root.
  // This keeps fixture resolution deterministic regardless of cwd.
  return path.basename(process.cwd()) === ".opencode"
    ? process.cwd()
    : path.resolve(process.cwd(), ".opencode");
}

export function testsRootDir(): string {
  return path.join(resolveOpencodeRootFromCwd(), "tests");
}

export function fixturesDir(): string {
  return path.join(testsRootDir(), "fixtures");
}

export function fixturePath(...parts: string[]): string {
  return path.join(fixturesDir(), ...parts);
}

export function makeToolContext() {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "test",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata(..._args: unknown[]) {},
    ask: async (..._args: unknown[]) => {},
  };
}

export async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(updates)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
