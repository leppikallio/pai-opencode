import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getPSTComponents } from "../../hooks/lib/time";

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

async function runHook(args: {
  paiDir: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/WorkCompletionLearning.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      PAI_DIR: args.paiDir,
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function currentMonthToken(): string {
  const parts = getPSTComponents(new Date());
  return `${parts.year}-${parts.month}`;
}

async function readMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

describe("WorkCompletionLearning hook", () => {
  test("creates one learning markdown file for a session state", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-completion-learning-"));
    const sessionId = "session-learning-create";
    const sessionDir = "20260224-101010_learning-capture";
    const month = currentMonthToken();

    try {
      const stateDir = path.join(paiDir, "MEMORY", "STATE");
      const workDir = path.join(paiDir, "MEMORY", "WORK", sessionDir);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        path.join(stateDir, `current-work-${sessionId}.json`),
        `${JSON.stringify({
          session_id: sessionId,
          session_dir: sessionDir,
          current_task: "001_learning-capture",
          task_title: "Learning Capture Session",
          task_count: 1,
          created_at: "2026-02-24T10:10:10+00:00",
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        [
          `id: ${JSON.stringify(sessionDir)}`,
          `title: ${JSON.stringify("Learning capture for completion hook")}`,
          `session_id: ${JSON.stringify(sessionId)}`,
          `created_at: ${JSON.stringify("2026-02-24T10:10:10+00:00")}`,
          `completed_at: ${JSON.stringify("2026-02-24T10:20:10+00:00")}`,
          'status: "COMPLETED"',
          "",
        ].join("\n"),
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          current: {
            criteria: ["Learning markdown created"],
            antiCriteria: ["No uncaught exception"],
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const firstResult = await runHook({
        paiDir,
        payload: { session_id: sessionId },
      });

      expect(firstResult.exitCode).toBe(0);
      expect(firstResult.stdout).toBe("");
      expect(firstResult.stderr).toBe("");

      const secondResult = await runHook({
        paiDir,
        payload: { session_id: sessionId },
      });

      expect(secondResult.exitCode).toBe(0);
      expect(secondResult.stdout).toBe("");
      expect(secondResult.stderr).toBe("");

      const systemFiles = await readMarkdownFiles(path.join(paiDir, "MEMORY", "LEARNING", "SYSTEM", month));
      const algorithmFiles = await readMarkdownFiles(path.join(paiDir, "MEMORY", "LEARNING", "ALGORITHM", month));
      const allFiles = [...systemFiles, ...algorithmFiles];

      expect(allFiles).toHaveLength(1);

      const content = await fs.readFile(allFiles[0], "utf8");
      expect(content).toContain("# Work Completion Learning");
      expect(content).toContain(`- Session ID: ${sessionId}`);
      expect(content).toContain("- Learning markdown created");
      expect(content).toContain("- No uncaught exception");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("does not create learning markdown for placeholder-only sessions", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-completion-placeholder-"));
    const sessionId = "session-learning-placeholder";
    const sessionDir = "20260224-111111_placeholder-only";
    const month = currentMonthToken();

    try {
      const stateDir = path.join(paiDir, "MEMORY", "STATE");
      const workDir = path.join(paiDir, "MEMORY", "WORK", sessionDir);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        path.join(stateDir, `current-work-${sessionId}.json`),
        `${JSON.stringify({
          session_id: sessionId,
          session_dir: sessionDir,
          current_task: "001_placeholder",
          task_title: "Placeholder Session",
          task_count: 1,
          created_at: "2026-02-24T11:11:11+00:00",
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        [
          `id: ${JSON.stringify(sessionDir)}`,
          `title: ${JSON.stringify("Placeholder completion")}`,
          `session_id: ${JSON.stringify(sessionId)}`,
          `created_at: ${JSON.stringify("2026-02-24T11:11:11+00:00")}`,
          `completed_at: ${JSON.stringify("2026-02-24T11:12:11+00:00")}`,
          'status: "COMPLETED"',
          "",
        ].join("\n"),
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          current: {
            criteria: [],
            antiCriteria: [],
          },
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(path.join(workDir, "THREAD.md"), "ok\n", "utf8");

      const result = await runHook({
        paiDir,
        payload: { session_id: sessionId },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const systemFiles = await readMarkdownFiles(path.join(paiDir, "MEMORY", "LEARNING", "SYSTEM", month));
      const algorithmFiles = await readMarkdownFiles(path.join(paiDir, "MEMORY", "LEARNING", "ALGORITHM", month));

      expect([...systemFiles, ...algorithmFiles]).toHaveLength(0);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("exits 0 and no-ops when state file is missing", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-completion-missing-state-"));
    const sessionId = "session-learning-missing-state";

    try {
      const result = await runHook({
        paiDir,
        payload: { session_id: sessionId },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const learningRoot = path.join(paiDir, "MEMORY", "LEARNING");
      await expect(fs.readdir(learningRoot)).rejects.toBeDefined();
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
