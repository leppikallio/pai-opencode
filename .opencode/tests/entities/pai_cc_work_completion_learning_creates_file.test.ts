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

async function runHook(args: {
  paiDir: string;
  payload: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/WorkCompletionLearning.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      ...args.env,
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

async function listMarkdownFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };

  await walk(root);
  return out;
}

describe("WorkCompletionLearning hook", () => {
  test("creates one learning markdown file for a session state", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-completion-learning-"));
    const sessionId = "session-learning-create";
    const workDirRel = path.join("2099-01", sessionId);

    try {
      const stateDir = path.join(paiDir, "MEMORY", "STATE");
      const workDir = path.join(paiDir, "MEMORY", "WORK", workDirRel);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        path.join(stateDir, "current-work.json"),
        `${JSON.stringify({
          v: "0.2",
          updated_at: new Date().toISOString(),
          sessions: {
            [sessionId]: {
              work_dir: workDir,
              started_at: new Date().toISOString(),
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "Learning Capture Session"\nopencode_session_id: ${sessionId}\nwork_id: test\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          v: "0.1",
          ideal: "",
          criteria: [
            {
              id: "isc-1",
              text: "Verified criterion",
              status: "VERIFIED",
            },
          ],
          antiCriteria: [],
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      const thread = [
        "# THREAD",
        "",
        "━━━ 📚 LEARN ━━━ 7/7",
        "",
        "Delete internal sessions reliably and quickly.",
        "",
        "🗣️ Marvin: done",
        "",
      ].join("\n");
      await fs.writeFile(path.join(workDir, "THREAD.md"), thread, "utf8");

      const firstResult = await runHook({
        paiDir,
        payload: { session_id: sessionId },
        env: {
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
          PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
        },
      });

      expect(firstResult.exitCode).toBe(0);
      expect(firstResult.stdout).toBe("");
      expect(firstResult.stderr).toBe("");

      const secondResult = await runHook({
        paiDir,
        payload: { session_id: sessionId },
        env: {
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
          PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
        },
      });

      expect(secondResult.exitCode).toBe(0);
      expect(secondResult.stdout).toBe("");
      expect(secondResult.stderr).toBe("");

      const allFiles = await listMarkdownFilesRecursive(path.join(paiDir, "MEMORY", "LEARNING"));

      expect(allFiles).toHaveLength(1);

      const content = await fs.readFile(allFiles[0], "utf8");
      expect(content).toContain("# Work Completion Summary");
      expect(content).toContain(`**Session:** ${sessionId}`);
      expect(content).toContain("Verified ISC criteria: 1");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("does not create learning markdown for placeholder-only sessions", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-completion-placeholder-"));
    const sessionId = "session-learning-placeholder";
    const workDirRel = path.join("2099-01", sessionId);

    try {
      const stateDir = path.join(paiDir, "MEMORY", "STATE");
      const workDir = path.join(paiDir, "MEMORY", "WORK", workDirRel);
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        path.join(stateDir, "current-work.json"),
        `${JSON.stringify({
          v: "0.2",
          updated_at: new Date().toISOString(),
          sessions: {
            [sessionId]: {
              work_dir: workDir,
              started_at: new Date().toISOString(),
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "Placeholder Session"\nopencode_session_id: ${sessionId}\nwork_id: test\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          v: "0.1",
          ideal: "",
          criteria: [],
          antiCriteria: [],
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(path.join(workDir, "THREAD.md"), "ok\n", "utf8");

      const result = await runHook({
        paiDir,
        payload: { session_id: sessionId },
        env: {
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
          PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const allFiles = await listMarkdownFilesRecursive(path.join(paiDir, "MEMORY", "LEARNING"));
      expect(allFiles).toHaveLength(0);
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
