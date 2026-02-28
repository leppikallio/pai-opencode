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
  autoPrdPromptClassification?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/AutoWorkCreation.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      PAI_ENABLE_MEMORY_PARITY: "1",
      PAI_ENABLE_AUTO_PRD: "1",
      PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: args.autoPrdPromptClassification ?? "1",
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

async function getWorkDir(paiDir: string, sessionId: string): Promise<string> {
  const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
    sessions?: Record<string, { work_dir?: string }>;
  };
  const workDir = state.sessions?.[sessionId]?.work_dir;
  if (!workDir) {
    throw new Error(`work_dir missing for session ${sessionId}`);
  }
  return workDir;
}

async function listPrdFiles(workDir: string): Promise<string[]> {
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^PRD-\d{8}-[a-z0-9-]+\.md$/.test(entry.name))
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

describe("auto PRD creation", () => {
  test("work-like prompt creates PRD and prompt classification artifact", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-work-"));
    const sessionId = "session-auto-prd-work";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");

      const workDir = await getWorkDir(paiDir, sessionId);
      const prdFiles = await listPrdFiles(workDir);
      expect(prdFiles.length).toBe(1);

      const classificationPath = path.join(workDir, "PROMPT_CLASSIFICATION.json");
      expect(await exists(classificationPath)).toBe(true);

      const raw = await fs.readFile(classificationPath, "utf8");
      const classification = JSON.parse(raw) as {
        type?: string;
        source?: string;
        title?: string;
      };
      expect(classification.type).toBe("work");
      expect(classification.source).toBe("heuristic");
      expect(typeof classification.title).toBe("string");
      expect(classification.title?.length ?? 0).toBeGreaterThan(0);
      expect(raw).not.toContain(prompt);

      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");
      const currentTaskStat = await fs.lstat(currentTaskPath);
      expect(currentTaskStat.isSymbolicLink()).toBe(true);

      const taskEntries = await fs.readdir(tasksDirPath, { withFileTypes: true });
      const taskDirs = taskEntries.filter((entry) => entry.isDirectory() && /^001_/.test(entry.name));
      expect(taskDirs.length).toBe(1);

      const taskDir = taskDirs[0];
      if (!taskDir) {
        throw new Error("expected exactly one 001_ task directory");
      }

      const taskDirPath = path.join(tasksDirPath, taskDir.name);
      expect(await exists(path.join(taskDirPath, "ISC.json"))).toBe(true);
      expect(await exists(path.join(taskDirPath, "THREAD.md"))).toBe(true);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("classification artifact is skipped when prompt classification flag is disabled", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-classification-off-"));
    const sessionId = "session-auto-prd-classification-off";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const run = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdPromptClassification: "0",
      });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");

      const workDir = await getWorkDir(paiDir, sessionId);
      const prdFiles = await listPrdFiles(workDir);
      expect(prdFiles.length).toBe(1);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test('prompt "ok" creates neither PRD nor classification artifact', async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-ok-"));
    const sessionId = "session-auto-prd-ok";

    try {
      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      expect((await listPrdFiles(workDir)).length).toBe(0);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("question prompts create neither PRD nor classification artifact", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-question-"));
    const sessionId = "session-auto-prd-question";

    try {
      const run = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt: "What does git status do?",
      });
      expect(run.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      expect((await listPrdFiles(workDir)).length).toBe(0);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("running auto work hook twice still leaves exactly one PRD", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-idempotent-"));
    const sessionId = "session-auto-prd-idempotent";
    const prompt = "Implement memory parity workstream with deterministic task artifacts";

    try {
      const first = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(first.exitCode).toBe(0);

      const second = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(second.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      expect((await listPrdFiles(workDir)).length).toBe(1);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
