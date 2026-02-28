import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";

const PRD_FILENAME_PATTERN = /^PRD-\d{8}-[a-z0-9-]+\.md$/;

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

  test("session.created followed by trivial user message does not persist work artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-history-session-created-trivial-"));
    const sessionId = "session-created-trivial";
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
                text: "ok",
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
  });
});
