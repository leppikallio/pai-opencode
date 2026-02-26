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

      const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
      expect(await fileExists(statePath)).toBe(true);

      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        v?: string;
        sessions?: Record<string, { work_dir?: string }>;
      };

      expect(state.v).toBe("0.2");
      const workDir = state.sessions?.[sessionId]?.work_dir;
      expect(typeof workDir).toBe("string");
      expect(await fileExists(workDir as string)).toBe(true);

      const metaPath = path.join(workDir as string, "META.yaml");
      const iscPath = path.join(workDir as string, "ISC.json");
      const threadPath = path.join(workDir as string, "THREAD.md");

      expect(await fileExists(metaPath)).toBe(true);
      expect(await fileExists(iscPath)).toBe(true);
      expect(await fileExists(threadPath)).toBe(true);
      expect(await fileExists(path.join(workDir as string, "tasks"))).toBe(true);
      expect(await fileExists(path.join(workDir as string, "scratch"))).toBe(true);

      const metaContentBefore = await fs.readFile(metaPath, "utf8");
      expect(metaContentBefore).toContain("status: ACTIVE");
      expect(metaContentBefore).toContain("started_at:");

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
      expect(metaContentAfter).toContain("status: COMPLETED");
      expect(metaContentAfter).toMatch(/completed_at: [^\n]+/);

      const stateAfter = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        sessions?: Record<string, unknown>;
      };
      expect(stateAfter.sessions?.[sessionId]).toBeUndefined();
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

      const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
      const originalState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        sessions?: Record<string, { work_dir?: string }>;
      };
      const originalWorkDir = originalState.sessions?.[sessionId]?.work_dir;
      expect(typeof originalWorkDir).toBe("string");
      const originalMetaPath = path.join(originalWorkDir as string, "META.yaml");

      const outsideMetaPath = path.join(outsideDir, "META.yaml");
      const outsideMetaBefore = 'status: "ACTIVE"\ncompleted_at: null\n';
      await fs.writeFile(outsideMetaPath, outsideMetaBefore, "utf8");

      await fs.writeFile(
        statePath,
        `${JSON.stringify(
          {
            ...originalState,
            sessions: {
              ...(originalState.sessions || {}),
              [sessionId]: { work_dir: outsideDir },
            },
          },
          null,
          2,
        )}\n`,
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
      expect(originalMetaAfter).toContain("status: ACTIVE");
      expect(originalMetaAfter).not.toContain("completed_at:");
      expect(await fileExists(statePath)).toBe(true);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
