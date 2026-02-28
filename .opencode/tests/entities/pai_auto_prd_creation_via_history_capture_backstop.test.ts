import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";

const PRD_FILENAME_PATTERN = /^PRD-\d{8}-[a-z0-9-]+\.md$/;
const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolveRepoRoot(thisFileDir);

function resolveRepoRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const hookPath = path.join(currentDir, ".opencode", "hooks", "AutoWorkCreation.hook.ts");
    if (existsSync(hookPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`could not resolve repo root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

type SnapshotRecord = {
  relPath: string;
  kind: "dir" | "file" | "symlink";
  linkText?: string;
  sha256?: string;
};

function buildSpawnEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const passthroughKeys = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "CI", "LANG", "LC_ALL"];
  const env: Record<string, string> = {};

  for (const key of passthroughKeys) {
    const value = process.env[key];
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
  root: string;
  sessionId: string;
  prompt: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/AutoWorkCreation.hook.ts"],
    cwd: repoRoot,
    env: buildSpawnEnv({
      OPENCODE_ROOT: args.root,
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

async function emitHistoryCaptureUserMessageCommit(args: {
  root: string;
  sessionId: string;
  messageId: string;
  prompt: string;
}): Promise<void> {
  const capture = createHistoryCapture({ directory: args.root });

  await capture.handleEvent({
    type: "message.updated",
    properties: {
      info: {
        id: args.messageId,
        sessionID: args.sessionId,
        role: "user",
      },
    },
  });

  await capture.handleEvent({
    type: "message.part.updated",
    properties: {
      part: {
        sessionID: args.sessionId,
        messageID: args.messageId,
        type: "text",
        text: args.prompt,
      },
    },
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function addSnapshotRecordIfPresent(
  workDir: string,
  relPath: string,
  records: SnapshotRecord[],
): Promise<void> {
  const absPath = path.join(workDir, relPath);
  if (!(await exists(absPath))) {
    return;
  }

  const stat = await fs.lstat(absPath);
  if (stat.isDirectory()) {
    records.push({
      relPath: relPath.endsWith("/") ? relPath : `${relPath}/`,
      kind: "dir",
    });
    return;
  }

  if (stat.isSymbolicLink()) {
    records.push({
      relPath,
      kind: "symlink",
      linkText: await fs.readlink(absPath),
    });
    return;
  }

  if (stat.isFile()) {
    records.push({
      relPath,
      kind: "file",
      sha256: sha256Hex(await fs.readFile(absPath)),
    });
  }
}

async function snapshotSessionArtifacts(workDir: string): Promise<SnapshotRecord[]> {
  const records: SnapshotRecord[] = [];

  for (const relPath of ["META.yaml", "ISC.json", "THREAD.md", "PROMPT_CLASSIFICATION.json"]) {
    await addSnapshotRecordIfPresent(workDir, relPath, records);
  }

  const rootEntries = await fs.readdir(workDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isFile() || !PRD_FILENAME_PATTERN.test(entry.name)) {
      continue;
    }
    await addSnapshotRecordIfPresent(workDir, entry.name, records);
  }

  const tasksDirPath = path.join(workDir, "tasks");
  if (await exists(tasksDirPath)) {
    await addSnapshotRecordIfPresent(workDir, "tasks/current", records);

    const taskDirs = await findTaskDirs(tasksDirPath);
    for (const taskDir of taskDirs) {
      const taskRelDir = `tasks/${taskDir}/`;
      await addSnapshotRecordIfPresent(workDir, taskRelDir, records);
      await addSnapshotRecordIfPresent(workDir, `tasks/${taskDir}/ISC.json`, records);
      await addSnapshotRecordIfPresent(workDir, `tasks/${taskDir}/THREAD.md`, records);

      const taskAbsPath = path.join(tasksDirPath, taskDir);
      const taskEntries = await fs.readdir(taskAbsPath, { withFileTypes: true });
      for (const entry of taskEntries) {
        if (!PRD_FILENAME_PATTERN.test(entry.name)) {
          continue;
        }
        await addSnapshotRecordIfPresent(workDir, `tasks/${taskDir}/${entry.name}`, records);
      }
    }
  }

  records.sort((a, b) => {
    if (a.relPath === b.relPath) {
      return a.kind.localeCompare(b.kind);
    }
    return a.relPath.localeCompare(b.relPath);
  });
  return records;
}

async function bootstrapWorkSession(root: string, sessionId: string, workDir: string): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  await writeCurrentWorkState(root, sessionId, workDir);

  await fs.writeFile(
    path.join(workDir, "META.yaml"),
    `${[
      "status: ACTIVE",
      "started_at: 2026-01-01T00:00:00.000Z",
      'title: "Commutativity regression test"',
      `opencode_session_id: ${sessionId}`,
      "work_id: 2026-01-01T00-00-00_commutativity-regression-test",
    ].join("\n")}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(workDir, "ISC.json"),
    `${JSON.stringify(
      {
        v: "0.1",
        ideal: "",
        criteria: [],
        antiCriteria: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(path.join(workDir, "THREAD.md"), "# Commutativity regression test\n\n---\n\n", "utf8");
}

function writeCurrentWorkState(root: string, sessionId: string, workDir: string): Promise<void> {
  const stateDir = path.join(root, "MEMORY", "STATE");
  return fs.mkdir(stateDir, { recursive: true }).then(() =>
    fs.writeFile(
      path.join(stateDir, "current-work.json"),
      `${JSON.stringify(
        {
          v: "0.2",
          updated_at: new Date().toISOString(),
          sessions: {
            [sessionId]: { work_dir: workDir },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  );
}

async function listPrdFiles(workDir: string): Promise<string[]> {
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && PRD_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function isTaskDirName(name: string): boolean {
  return /^\d{3}_[a-z0-9-]+$/.test(name);
}

async function findTaskDirs(tasksDirPath: string): Promise<string[]> {
  const entries = await fs.readdir(tasksDirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && isTaskDirName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function listTaskPrdFiles(taskDirPath: string): Promise<string[]> {
  const entries = await fs.readdir(taskDirPath, { withFileTypes: true });
  return entries
    .filter((entry) => PRD_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCurrentWorkDir(root: string, sessionId: string): Promise<string | null> {
  const currentWorkPath = path.join(root, "MEMORY", "STATE", "current-work.json");
  try {
    const raw = await fs.readFile(currentWorkPath, "utf8");
    const parsed = JSON.parse(raw) as {
      sessions?: Record<string, { work_dir?: string }>;
    };
    const workDir = parsed.sessions?.[sessionId]?.work_dir;
    return typeof workDir === "string" && workDir.length > 0 ? workDir : null;
  } catch {
    return null;
  }
}

async function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("auto PRD creation via history-capture backstop", () => {
  test("history-capture user message commit writes PRD and prompt classification artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-history-backstop-"));
    const sessionId = "session-auto-prd-history-backstop";
    const messageId = `message-${Date.now()}`;
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      await fs.mkdir(workDir, { recursive: true });
      await writeCurrentWorkState(root, sessionId, workDir);
      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        `${[
          "status: ACTIVE",
          "started_at: 2026-01-01T00:00:00.000Z",
          'title: "Memory parity backstop test"',
          `opencode_session_id: ${sessionId}`,
        ].join("\n")}\n`,
        "utf8",
      );
      await fs.writeFile(path.join(workDir, "THREAD.md"), "# test\n", "utf8");

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_AUTO_PRD: "1",
          PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
        },
        async () => {
          const capture = createHistoryCapture({ directory: root });

          await capture.handleEvent({
            type: "message.updated",
            properties: {
              info: {
                id: messageId,
                sessionID: sessionId,
                role: "user",
              },
            },
          });

          await capture.handleEvent({
            type: "message.part.updated",
            properties: {
              part: {
                sessionID: sessionId,
                messageID: messageId,
                type: "text",
                text: prompt,
              },
            },
          });
        },
      );

      const canonicalPrdFiles = await listPrdFiles(workDir);
      expect(canonicalPrdFiles).toHaveLength(1);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(true);

      const canonicalPrdName = canonicalPrdFiles[0];
      if (!canonicalPrdName) {
        throw new Error("expected one canonical PRD at session root");
      }

      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");
      expect(await exists(currentTaskPath)).toBe(true);

      const currentTaskStat = await fs.lstat(currentTaskPath);
      expect(currentTaskStat.isSymbolicLink()).toBe(true);

      const taskDirs = await findTaskDirs(tasksDirPath);
      expect(taskDirs.length).toBeGreaterThanOrEqual(1);

      const firstTaskDir = taskDirs.find((entry) => entry.startsWith("001_"));
      expect(typeof firstTaskDir).toBe("string");
      if (!firstTaskDir) {
        throw new Error("expected a 001_* task directory");
      }

      const resolvedCurrentTaskPath = await fs.realpath(currentTaskPath);
      expect(resolvedCurrentTaskPath).toBe(await fs.realpath(path.join(tasksDirPath, firstTaskDir)));

      const taskPrdFiles = await listTaskPrdFiles(resolvedCurrentTaskPath);
      expect(taskPrdFiles).toHaveLength(1);

      const taskPrdName = taskPrdFiles[0];
      if (!taskPrdName) {
        throw new Error("expected one task-level PRD symlink");
      }

      const taskPrdPath = path.join(resolvedCurrentTaskPath, taskPrdName);
      expect((await fs.lstat(taskPrdPath)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(taskPrdPath)).toBe(await fs.realpath(path.join(workDir, canonicalPrdName)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("session.created followed by trivial user variants does not persist work artifacts", async () => {
    const trivialPrompts = [
      "ok",
      "OK!",
      "thanks",
      "thank   you",
      "hi",
      "thanks :)",
      "ok 👍",
      "sounds good.",
    ];

    for (const [index, prompt] of trivialPrompts.entries()) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-history-session-created-trivial-"));
      const sessionId = `session-created-trivial-${index}`;
      const messageId = `message-${Date.now()}-${index}`;

      try {
        await withEnv(
          {
            OPENCODE_ROOT: root,
            PAI_ENABLE_MEMORY_PARITY: "1",
            PAI_ENABLE_AUTO_PRD: "1",
            PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
          },
          async () => {
            const capture = createHistoryCapture({ directory: root });

            await capture.handleEvent({
              type: "session.created",
              properties: {
                info: {
                  id: sessionId,
                  title: "work-session",
                },
              },
            });

            await capture.handleEvent({
              type: "message.updated",
              properties: {
                info: {
                  id: messageId,
                  sessionID: sessionId,
                  role: "user",
                },
              },
            });

            await capture.handleEvent({
              type: "message.part.updated",
              properties: {
                part: {
                  sessionID: sessionId,
                  messageID: messageId,
                  type: "text",
                  text: prompt,
                },
              },
            });
          },
        );

        expect(await exists(path.join(root, "MEMORY", "STATE", "current-work.json"))).toBe(false);

        const workRoot = path.join(root, "MEMORY", "WORK");
        const hasWorkRoot = await exists(workRoot);
        if (hasWorkRoot) {
          const workEntries = await fs.readdir(workRoot, { recursive: true });
          const createdTaskArtifact = workEntries.some((entry) => {
            if (typeof entry !== "string") {
              return false;
            }
            return entry.includes("tasks") || PRD_FILENAME_PATTERN.test(path.basename(entry));
          });
          expect(createdTaskArtifact).toBe(false);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });

  test("session.created followed by non-trivial question bootstraps work session and task scaffold", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-history-session-created-question-"));
    const sessionId = "session-created-question";
    const messageId = `message-${Date.now()}`;

    try {
      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_AUTO_PRD: "1",
          PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
        },
        async () => {
          const capture = createHistoryCapture({ directory: root });

          await capture.handleEvent({
            type: "session.created",
            properties: {
              info: {
                id: sessionId,
                title: "work-session",
              },
            },
          });

          await capture.handleEvent({
            type: "message.updated",
            properties: {
              info: {
                id: messageId,
                sessionID: sessionId,
                role: "user",
              },
            },
          });

          await capture.handleEvent({
            type: "message.part.updated",
            properties: {
              part: {
                sessionID: sessionId,
                messageID: messageId,
                type: "text",
                text: "What does git status do?",
              },
            },
          });
        },
      );

      const workDir = await readCurrentWorkDir(root, sessionId);
      expect(typeof workDir).toBe("string");
      if (!workDir) {
        throw new Error("expected current work directory for non-trivial question");
      }

      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");
      expect(await exists(currentTaskPath)).toBe(true);
      expect((await fs.lstat(currentTaskPath)).isSymbolicLink()).toBe(true);

      const taskDirs = await findTaskDirs(tasksDirPath);
      const firstTaskDir = taskDirs.find((entry) => entry.startsWith("001_"));
      expect(typeof firstTaskDir).toBe("string");
      if (!firstTaskDir) {
        throw new Error("expected a 001_* task directory");
      }

      const resolvedCurrentTaskPath = await fs.realpath(currentTaskPath);
      expect(resolvedCurrentTaskPath).toBe(await fs.realpath(path.join(tasksDirPath, firstTaskDir)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("auto work creation and history-capture backstop are commutative for identical session input", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-history-commutativity-"));
    const sessionId = "session-commutativity-fixed";
    const prompt = "Plan a deterministic migration strategy for task scaffold commutativity checks";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);

    try {
      const envOverrides = {
        OPENCODE_ROOT: root,
        PAI_ENABLE_MEMORY_PARITY: "1",
        PAI_ENABLE_AUTO_PRD: "1",
        PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
        PAI_ENABLE_CARRIER_PROMPT_HINTS: "0",
      };

      await withEnv(envOverrides, async () => {
        await bootstrapWorkSession(root, sessionId, workDir);

        const hookFirst = await runAutoWorkCreationHook({
          root,
          sessionId,
          prompt,
        });
        expect(hookFirst.exitCode).toBe(0);

        await emitHistoryCaptureUserMessageCommit({
          root,
          sessionId,
          messageId: "message-commutativity-a",
          prompt,
        });
      });

      const hookThenBackstopWorkDir = await readCurrentWorkDir(root, sessionId);
      expect(hookThenBackstopWorkDir).toBe(workDir);
      if (!hookThenBackstopWorkDir) {
        throw new Error("expected work dir after hook-first scenario");
      }
      const hookThenBackstopArtifacts = await snapshotSessionArtifacts(hookThenBackstopWorkDir);

      await fs.rm(root, { recursive: true, force: true });
      await fs.mkdir(root, { recursive: true });

      await withEnv(envOverrides, async () => {
        await bootstrapWorkSession(root, sessionId, workDir);

        await emitHistoryCaptureUserMessageCommit({
          root,
          sessionId,
          messageId: "message-commutativity-b",
          prompt,
        });

        const backstopFirst = await runAutoWorkCreationHook({
          root,
          sessionId,
          prompt,
        });
        expect(backstopFirst.exitCode).toBe(0);
      });

      const backstopThenHookWorkDir = await readCurrentWorkDir(root, sessionId);
      expect(backstopThenHookWorkDir).toBe(workDir);
      if (!backstopThenHookWorkDir) {
        throw new Error("expected work dir after backstop-first scenario");
      }

      const backstopThenHookArtifacts = await snapshotSessionArtifacts(backstopThenHookWorkDir);

      expect(hookThenBackstopArtifacts).toEqual(backstopThenHookArtifacts);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
