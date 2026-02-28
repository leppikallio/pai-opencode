import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
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

async function runAutoWorkCreationHook(args: {
  paiDir: string;
  sessionId: string;
  prompt: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/AutoWorkCreation.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      PAI_ENABLE_MEMORY_PARITY: "1",
      PAI_ENABLE_AUTO_PRD: "1",
      PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(
    JSON.stringify({
      session_id: args.sessionId,
      prompt: args.prompt,
    }),
  );
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function writeCurrentWorkState(
  paiDir: string,
  sessions: Record<string, { work_dir: string; started_at?: string }>
): Promise<void> {
  const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    `${JSON.stringify({ v: "0.2", updated_at: new Date().toISOString(), sessions }, null, 2)}\n`,
    "utf8",
  );
}

async function getMappedWorkDir(paiDir: string, sessionId: string): Promise<string> {
  const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
    sessions?: Record<string, { work_dir?: string }>;
  };
  const workDir = state.sessions?.[sessionId]?.work_dir;
  if (!workDir) {
    throw new Error(`Expected mapped work_dir for ${sessionId}`);
  }
  return workDir;
}

async function createSessionSkeleton(args: {
  paiDir: string;
  yearMonth: string;
  sessionId: string;
  metaContent: string;
  iscContent?: string;
  threadContent?: string;
}): Promise<string> {
  const sessionPath = path.join(args.paiDir, "MEMORY", "WORK", args.yearMonth, args.sessionId);
  await fs.mkdir(path.join(sessionPath, "tasks"), { recursive: true });
  await fs.mkdir(path.join(sessionPath, "scratch"), { recursive: true });
  await fs.writeFile(path.join(sessionPath, "META.yaml"), args.metaContent, "utf8");
  if (args.iscContent !== undefined) {
    await fs.writeFile(path.join(sessionPath, "ISC.json"), args.iscContent, "utf8");
  }
  if (args.threadContent !== undefined) {
    await fs.writeFile(path.join(sessionPath, "THREAD.md"), args.threadContent, "utf8");
  }
  return sessionPath;
}

async function countSessionDirs(paiDir: string, sessionId: string): Promise<number> {
  const workRoot = path.join(paiDir, "MEMORY", "WORK");
  let entries: Array<{ isDirectory: () => boolean; name: string }>;
  try {
    entries = await fs.readdir(workRoot, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const stat = await fs.stat(path.join(workRoot, entry.name, sessionId));
      if (stat.isDirectory()) {
        count += 1;
      }
    } catch {
      // ignore
    }
  }
  return count;
}

describe("createWorkSession non-clobber and recovery", () => {
  test("preserves sentinel files when session dir exists and state mapping is missing", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-non-clobber-sentinel-"));
    const sessionId = "session-non-clobber-sentinel";
    const sentinelMeta = [
      "status: ACTIVE",
      "started_at: 2026-01-01T00:00:00.000Z",
      'title: "sentinel-title"',
      "opencode_session_id: session-non-clobber-sentinel",
      "work_id: sentinel-work-id",
      "",
    ].join("\n");
    const sentinelIsc = '{"sentinel":true}\n';
    const sentinelThread = "# sentinel thread\n\nkeep-me\n";

    try {
      const existingPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-01",
        sessionId,
        metaContent: sentinelMeta,
        iscContent: sentinelIsc,
        threadContent: sentinelThread,
      });

      await writeCurrentWorkState(paiDir, {});

      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);

      expect(await fs.readFile(path.join(existingPath, "META.yaml"), "utf8")).toBe(sentinelMeta);
      expect(await fs.readFile(path.join(existingPath, "ISC.json"), "utf8")).toBe(sentinelIsc);
      expect(await fs.readFile(path.join(existingPath, "THREAD.md"), "utf8")).toBe(sentinelThread);
      expect(await getMappedWorkDir(paiDir, sessionId)).toBe(existingPath);
      expect(await countSessionDirs(paiDir, sessionId)).toBe(1);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("recovers missing state by choosing candidate with newest META.started_at", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-non-clobber-newest-meta-"));
    const sessionId = "session-recover-newest-started-at";

    try {
      const olderStartedAtPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-03",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          "started_at: 2026-03-10T09:00:00.000Z",
          'title: "older"',
          "opencode_session_id: session-recover-newest-started-at",
          "work_id: older",
          "",
        ].join("\n"),
      });
      const newestStartedAtPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-01",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          "started_at: 2026-04-10T09:00:00.000Z",
          'title: "newest"',
          "opencode_session_id: session-recover-newest-started-at",
          "work_id: newest",
          "",
        ].join("\n"),
      });

      await writeCurrentWorkState(paiDir, {});

      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);
      expect(await getMappedWorkDir(paiDir, sessionId)).toBe(newestStartedAtPath);
      expect(await countSessionDirs(paiDir, sessionId)).toBe(2);
      expect(newestStartedAtPath).not.toBe(olderStartedAtPath);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("falls back to lexicographically greatest month when META.started_at is missing or invalid", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-non-clobber-lex-month-"));
    const sessionId = "session-recover-lex-month";

    try {
      await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-02",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          "started_at: not-a-timestamp",
          'title: "invalid-started-at"',
          "opencode_session_id: session-recover-lex-month",
          "work_id: invalid",
          "",
        ].join("\n"),
      });

      const expectedPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-11",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          'title: "missing-started-at"',
          "opencode_session_id: session-recover-lex-month",
          "work_id: missing",
          "",
        ].join("\n"),
      });

      await writeCurrentWorkState(paiDir, {});

      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);
      expect(await getMappedWorkDir(paiDir, sessionId)).toBe(expectedPath);
      expect(await countSessionDirs(paiDir, sessionId)).toBe(2);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("recovers from stale in-root state mapping that points to a missing directory", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-non-clobber-stale-state-"));
    const sessionId = "session-recover-stale-state";

    try {
      const existingPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-04",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          "started_at: 2026-04-01T00:00:00.000Z",
          'title: "existing"',
          "opencode_session_id: session-recover-stale-state",
          "work_id: existing",
          "",
        ].join("\n"),
      });

      const staleMissingPath = path.join(paiDir, "MEMORY", "WORK", "2026-10", sessionId);
      await writeCurrentWorkState(paiDir, {
        [sessionId]: { work_dir: staleMissingPath, started_at: "2026-10-01T00:00:00.000Z" },
      });

      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);
      expect(await getMappedWorkDir(paiDir, sessionId)).toBe(existingPath);
      expect(await countSessionDirs(paiDir, sessionId)).toBe(1);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("ignores out-of-root mapping, recovers in-root session, and reports poisoning marker", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-non-clobber-out-of-root-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-work-poisoned-state-"));
    const sessionId = "session-recover-out-of-root";

    try {
      const existingPath = await createSessionSkeleton({
        paiDir,
        yearMonth: "2026-07",
        sessionId,
        metaContent: [
          "status: ACTIVE",
          "started_at: 2026-07-01T00:00:00.000Z",
          'title: "safe"',
          "opencode_session_id: session-recover-out-of-root",
          "work_id: safe",
          "",
        ].join("\n"),
      });

      const poisonPath = path.join(outsideDir, "poison.txt");
      await fs.writeFile(poisonPath, "outside sentinel\n", "utf8");
      const outsideEntriesBefore = (await fs.readdir(outsideDir)).sort();

      await writeCurrentWorkState(paiDir, {
        [sessionId]: { work_dir: outsideDir, started_at: "2026-08-01T00:00:00.000Z" },
      });

      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toContain("PAI_STATE_CURRENT_WORK_MAPPING_OUT_OF_ROOT");
      expect(await getMappedWorkDir(paiDir, sessionId)).toBe(existingPath);
      expect(await countSessionDirs(paiDir, sessionId)).toBe(1);
      expect(await fs.readFile(poisonPath, "utf8")).toBe("outside sentinel\n");
      expect((await fs.readdir(outsideDir)).sort()).toEqual(outsideEntriesBefore);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
