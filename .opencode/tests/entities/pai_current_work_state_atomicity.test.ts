import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getCurrentWorkPathForSession,
  setCurrentWorkPathForSession,
} from "../../plugins/lib/paths";
import { createWorkSession } from "../../plugins/handlers/work-tracker";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const pathsModulePath = path.join(repoRoot, ".opencode", "plugins", "lib", "paths.ts");

type CurrentWorkState = {
  v: "0.2";
  updated_at: string;
  sessions: Record<string, { work_dir: string; started_at?: string }>;
};

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function makeWorkPath(paiDir: string, sessionId: string, idx: number): string {
  return path.join(paiDir, "MEMORY", "WORK", "2026-02", sessionId, String(idx));
}

function getStatePaths(paiDir: string): { stateFile: string; lockDir: string; lockInfoFile: string } {
  const stateDir = path.join(paiDir, "MEMORY", "STATE");
  return {
    stateFile: path.join(stateDir, "current-work.json"),
    lockDir: path.join(stateDir, "current-work.lock"),
    lockInfoFile: path.join(stateDir, "current-work.lock", "lock.json"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function writeCurrentWorkState(
  paiDir: string,
  sessions: Record<string, { work_dir: string; started_at?: string }>,
): Promise<void> {
  const { stateFile } = getStatePaths(paiDir);
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(
    stateFile,
    `${JSON.stringify({ v: "0.2", updated_at: new Date().toISOString(), sessions }, null, 2)}\n`,
    "utf8",
  );
}

async function readCurrentWorkState(paiDir: string): Promise<CurrentWorkState> {
  const { stateFile } = getStatePaths(paiDir);
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as CurrentWorkState;
}

async function assertStateJsonIsValidIfPresent(paiDir: string): Promise<void> {
  const { stateFile } = getStatePaths(paiDir);
  let raw: string;
  try {
    raw = await fs.readFile(stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  expect(() => JSON.parse(raw)).not.toThrow();
}

async function createLockDir(paiDir: string, args: { createdAtIso: string; token: string }): Promise<void> {
  const { lockInfoFile } = getStatePaths(paiDir);
  await fs.mkdir(path.dirname(lockInfoFile), { recursive: true });
  await fs.writeFile(
    lockInfoFile,
    `${JSON.stringify({ created_at: args.createdAtIso, token: args.token })}\n`,
    "utf8",
  );
}

async function runWriterProcess(args: {
  paiDir: string;
  sessionId: string;
  iterations: number;
}): Promise<Bun.Subprocess> {
  const writerScript = [
    `import path from "node:path";`,
    `import { setCurrentWorkPathForSession } from ${JSON.stringify(pathsModulePath)};`,
    `const root = process.env.OPENCODE_ROOT;`,
    `if (!root) process.exit(2);`,
    `const session = process.env.WRITER_SESSION ?? "writer";`,
    `const iterations = Number.parseInt(process.env.WRITER_ITERATIONS ?? "100", 10);`,
    `for (let idx = 0; idx < iterations; idx += 1) {`,
    `  const target = path.join(root, "MEMORY", "WORK", "2026-02", session, String(idx));`,
    `  await setCurrentWorkPathForSession(session, target);`,
    `}`,
  ].join("\n");

  return Bun.spawn({
    cmd: ["bun", "-e", writerScript],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      WRITER_SESSION: args.sessionId,
      WRITER_ITERATIONS: String(args.iterations),
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function runSingleSetProcess(args: {
  paiDir: string;
  sessionId: string;
  workPath: string;
}): Promise<{ exitCode: number; stderr: string }> {
  const writerScript = [
    `import { setCurrentWorkPathForSession } from ${JSON.stringify(pathsModulePath)};`,
    `const root = process.env.OPENCODE_ROOT;`,
    `if (!root) process.exit(2);`,
    `const session = process.env.WRITER_SESSION ?? "writer";`,
    `const target = process.env.WRITER_WORK_PATH ?? "";`,
    `await setCurrentWorkPathForSession(session, target);`,
  ].join("\n");

  const writer = Bun.spawn({
    cmd: ["bun", "-e", writerScript],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      WRITER_SESSION: args.sessionId,
      WRITER_WORK_PATH: args.workPath,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    writer.exited,
    readSubprocessPipe(writer.stderr),
  ]);

  return {
    exitCode,
    stderr,
  };
}

async function createLockDirWithoutMetadata(paiDir: string, staleByMs: number): Promise<void> {
  const { lockDir } = getStatePaths(paiDir);
  await fs.mkdir(lockDir, { recursive: true });
  const staleDate = new Date(Date.now() - staleByMs);
  await fs.utimes(lockDir, staleDate, staleDate);
}

async function createLockDirWithCorruptMetadata(paiDir: string, staleByMs: number): Promise<void> {
  const { lockDir, lockInfoFile } = getStatePaths(paiDir);
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(lockInfoFile, "{ invalid-json", "utf8");
  const staleDate = new Date(Date.now() - staleByMs);
  await fs.utimes(lockDir, staleDate, staleDate);
}

async function terminateSubprocessIfNeeded(proc: Bun.Subprocess | null): Promise<void> {
  if (!proc) return;
  if (proc.exitCode === null) {
    proc.kill();
  }
  await proc.exited;
}

function readSubprocessPipe(pipe: number | ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (typeof pipe === "number" || pipe === undefined) {
    return Promise.resolve("");
  }
  return new Response(pipe).text();
}

describe("current-work state atomicity and non-lossy updates", () => {
  test("atomic writes remain valid JSON during repeated set operations", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-atomic-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      for (let idx = 0; idx < 80; idx += 1) {
        let finished = false;
        const writePromise = setCurrentWorkPathForSession(
          "session-atomic",
          makeWorkPath(paiDir, "session-atomic", idx),
        ).finally(() => {
          finished = true;
        });

        while (!finished) {
          await assertStateJsonIsValidIfPresent(paiDir);
          await sleep(1);
        }

        await writePromise;
        await assertStateJsonIsValidIfPresent(paiDir);
      }
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("set merges entries and preserves unrelated sessions", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-non-lossy-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await writeCurrentWorkState(paiDir, {
        "session-b": { work_dir: makeWorkPath(paiDir, "session-b", 0) },
      });

      await setCurrentWorkPathForSession("session-a", makeWorkPath(paiDir, "session-a", 0));

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]?.work_dir).toBe(makeWorkPath(paiDir, "session-a", 0));
      expect(state.sessions["session-b"]?.work_dir).toBe(makeWorkPath(paiDir, "session-b", 0));
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("two independent writers keep parseable JSON and preserve union of sessions", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-contention-"));
    let writerA: Bun.Subprocess | null = null;
    let writerB: Bun.Subprocess | null = null;

    writerA = await runWriterProcess({
      paiDir,
      sessionId: "session-a",
      iterations: 180,
    });
    writerB = await runWriterProcess({
      paiDir,
      sessionId: "session-b",
      iterations: 180,
    });

    if (!writerA || !writerB) {
      throw new Error("failed to spawn contention writers");
    }

    let doneA = false;
    let doneB = false;
    writerA.exited.then(() => {
      doneA = true;
    });
    writerB.exited.then(() => {
      doneB = true;
    });

    try {
      while (!doneA || !doneB) {
        await assertStateJsonIsValidIfPresent(paiDir);
        await sleep(2);
      }

      const [exitA, exitB, stderrA, stderrB] = await Promise.all([
        writerA.exited,
        writerB.exited,
        readSubprocessPipe(writerA.stderr),
        readSubprocessPipe(writerB.stderr),
      ]);

      expect(exitA).toBe(0);
      expect(exitB).toBe(0);
      expect(stderrA).not.toContain("TypeError");
      expect(stderrB).not.toContain("TypeError");

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]?.work_dir).toBeDefined();
      expect(state.sessions["session-b"]?.work_dir).toBeDefined();
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      await Promise.allSettled([
        terminateSubprocessIfNeeded(writerA),
        terminateSubprocessIfNeeded(writerB),
      ]);
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("corrupt state is tolerated by read and rewritten on bootstrap write", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-corrupt-"));
    const previousRoot = process.env.OPENCODE_ROOT;
    const { stateFile } = getStatePaths(paiDir);

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, "{ invalid-json", "utf8");

      await expect(getCurrentWorkPathForSession("session-corrupt")).resolves.toBeNull();

      const created = await createWorkSession("session-corrupt", "bootstrap from corrupt state");
      expect(created.success).toBe(true);

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-corrupt"]?.work_dir).toBeDefined();
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("lock timeout warns and preserves existing state without corruption", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-lock-timeout-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await writeCurrentWorkState(paiDir, {
        "session-b": { work_dir: makeWorkPath(paiDir, "session-b", 0) },
      });

      await createLockDir(paiDir, {
        createdAtIso: new Date().toISOString(),
        token: "token-live-a",
      });

      const { exitCode, stderr } = await runSingleSetProcess({
        paiDir,
        sessionId: "session-a",
        workPath: makeWorkPath(paiDir, "session-a", 0),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("PAI_STATE_CURRENT_WORK_LOCK_TIMEOUT");

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]).toBeUndefined();
      expect(state.sessions["session-b"]?.work_dir).toBe(makeWorkPath(paiDir, "session-b", 0));
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("stale lock is broken, warning emitted, and merged write succeeds", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-lock-stale-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await writeCurrentWorkState(paiDir, {
        "session-b": { work_dir: makeWorkPath(paiDir, "session-b", 0) },
      });

      await createLockDir(paiDir, {
        createdAtIso: new Date(Date.now() - 30_000).toISOString(),
        token: "token-stale-a",
      });

      const { exitCode, stderr } = await runSingleSetProcess({
        paiDir,
        sessionId: "session-a",
        workPath: makeWorkPath(paiDir, "session-a", 1),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("PAI_STATE_CURRENT_WORK_LOCK_BROKEN_STALE");

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]?.work_dir).toBe(makeWorkPath(paiDir, "session-a", 1));
      expect(state.sessions["session-b"]?.work_dir).toBe(makeWorkPath(paiDir, "session-b", 0));
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("token mismatch contender cannot release or break a live lock", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-lock-token-mismatch-"));
    const previousRoot = process.env.OPENCODE_ROOT;
    const { lockInfoFile } = getStatePaths(paiDir);

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await createLockDir(paiDir, {
        createdAtIso: new Date().toISOString(),
        token: "token-a",
      });

      const { exitCode, stderr } = await runSingleSetProcess({
        paiDir,
        sessionId: "session-b",
        workPath: makeWorkPath(paiDir, "session-b", 3),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("PAI_STATE_CURRENT_WORK_LOCK_TIMEOUT");

      const lockRecord = JSON.parse(await fs.readFile(lockInfoFile, "utf8")) as {
        created_at?: string;
        token?: string;
      };
      expect(lockRecord.token).toBe("token-a");
      expect(lockRecord.created_at).toBeDefined();
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("stale lock dir with missing metadata is broken and write succeeds", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-lock-missing-metadata-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await writeCurrentWorkState(paiDir, {
        "session-b": { work_dir: makeWorkPath(paiDir, "session-b", 0) },
      });

      await createLockDirWithoutMetadata(paiDir, 30_000);

      const { exitCode, stderr } = await runSingleSetProcess({
        paiDir,
        sessionId: "session-a",
        workPath: makeWorkPath(paiDir, "session-a", 2),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("PAI_STATE_CURRENT_WORK_LOCK_BROKEN_STALE");

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]?.work_dir).toBe(makeWorkPath(paiDir, "session-a", 2));
      expect(state.sessions["session-b"]?.work_dir).toBe(makeWorkPath(paiDir, "session-b", 0));
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("stale lock dir with corrupt metadata is broken and write succeeds", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-current-work-lock-corrupt-metadata-"));
    const previousRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await writeCurrentWorkState(paiDir, {
        "session-b": { work_dir: makeWorkPath(paiDir, "session-b", 0) },
      });

      await createLockDirWithCorruptMetadata(paiDir, 30_000);

      const { exitCode, stderr } = await runSingleSetProcess({
        paiDir,
        sessionId: "session-a",
        workPath: makeWorkPath(paiDir, "session-a", 4),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("PAI_STATE_CURRENT_WORK_LOCK_BROKEN_STALE");

      const state = await readCurrentWorkState(paiDir);
      expect(state.sessions["session-a"]?.work_dir).toBe(makeWorkPath(paiDir, "session-a", 4));
      expect(state.sessions["session-b"]?.work_dir).toBe(makeWorkPath(paiDir, "session-b", 0));
      await assertStateJsonIsValidIfPresent(paiDir);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousRoot;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
