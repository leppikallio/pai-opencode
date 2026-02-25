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
  hookPath: string;
  paiDir: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", args.hookPath],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("cc work lifecycle hooks", () => {
  test("creates work session on first prompt and completes it on session summary", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-lifecycle-"));
    const sessionId = "session-work-lifecycle";

    try {
      const createResult = await runHook({
        hookPath: ".opencode/hooks/AutoWorkCreation.hook.ts",
        paiDir,
        payload: {
          session_id: sessionId,
          prompt: "Build deterministic work lifecycle handling for first prompt session boot",
        },
      });

      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout).toBe("");
      expect(createResult.stderr).toBe("");

      const statePath = path.join(paiDir, "MEMORY", "STATE", `current-work-${sessionId}.json`);
      expect(await fileExists(statePath)).toBe(true);

      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        session_dir: string;
        current_task: string;
      };

      const workRoot = path.join(paiDir, "MEMORY", "WORK");
      expect(await fileExists(workRoot)).toBe(true);

      const sessionDirPath = path.join(workRoot, state.session_dir);
      const metaPath = path.join(sessionDirPath, "META.yaml");
      const tasksDir = path.join(sessionDirPath, "tasks");
      const taskDirPath = path.join(tasksDir, state.current_task);

      const metaContentBefore = await fs.readFile(metaPath, "utf8");
      expect(metaContentBefore).toContain('status: "ACTIVE"');
      expect(metaContentBefore).toContain("completed_at: null");

      expect(await fileExists(path.join(taskDirPath, "ISC.json"))).toBe(true);
      expect(await fileExists(path.join(taskDirPath, "THREAD.md"))).toBe(true);

      const currentLinkTarget = await fs.readlink(path.join(tasksDir, "current"));
      expect(currentLinkTarget).toBe(state.current_task);

      const completeResult = await runHook({
        hookPath: ".opencode/hooks/SessionSummary.hook.ts",
        paiDir,
        payload: {
          session_id: sessionId,
        },
      });

      expect(completeResult.exitCode).toBe(0);
      expect(completeResult.stdout).toBe("");
      expect(completeResult.stderr).toBe("");

      const metaContentAfter = await fs.readFile(metaPath, "utf8");
      expect(metaContentAfter).toContain('status: "COMPLETED"');
      expect(metaContentAfter).toMatch(/completed_at: "[^\"]+"/);
      expect(await fileExists(statePath)).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("ignores invalid session_id without creating work files", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-invalid-session-"));

    try {
      const result = await runHook({
        hookPath: ".opencode/hooks/AutoWorkCreation.hook.ts",
        paiDir,
        payload: {
          session_id: "../x",
          prompt: "This should be ignored due to invalid session id",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(await fileExists(path.join(paiDir, "MEMORY"))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("no-ops when state session_dir is outside work root", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-tampered-state-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-cc-work-outside-root-"));
    const sessionId = "session-tampered-state";

    try {
      const createResult = await runHook({
        hookPath: ".opencode/hooks/AutoWorkCreation.hook.ts",
        paiDir,
        payload: {
          session_id: sessionId,
          prompt: "Create initial work state for tampered session_dir test",
        },
      });

      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout).toBe("");
      expect(createResult.stderr).toBe("");

      const statePath = path.join(paiDir, "MEMORY", "STATE", `current-work-${sessionId}.json`);
      const originalState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        session_dir: string;
      };
      const originalMetaPath = path.join(
        paiDir,
        "MEMORY",
        "WORK",
        originalState.session_dir,
        "META.yaml",
      );

      const outsideMetaPath = path.join(outsideDir, "META.yaml");
      const outsideMetaBefore = 'status: "ACTIVE"\ncompleted_at: null\n';
      await fs.writeFile(outsideMetaPath, outsideMetaBefore, "utf8");

      await fs.writeFile(
        statePath,
        `${JSON.stringify({ ...originalState, session_dir: outsideDir }, null, 2)}\n`,
        "utf8",
      );

      const completeResult = await runHook({
        hookPath: ".opencode/hooks/SessionSummary.hook.ts",
        paiDir,
        payload: {
          session_id: sessionId,
        },
      });

      expect(completeResult.exitCode).toBe(0);
      expect(completeResult.stdout).toBe("");
      expect(completeResult.stderr).toBe("");

      const outsideMetaAfter = await fs.readFile(outsideMetaPath, "utf8");
      expect(outsideMetaAfter).toBe(outsideMetaBefore);

      const originalMetaAfter = await fs.readFile(originalMetaPath, "utf8");
      expect(originalMetaAfter).toContain('status: "ACTIVE"');
      expect(originalMetaAfter).toContain("completed_at: null");
      expect(await fileExists(statePath)).toBe(true);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
