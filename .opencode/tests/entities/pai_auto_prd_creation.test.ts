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

function isTaskDirName(name: string): boolean {
  return /^\d{3}_[a-z0-9-]+$/.test(name);
}

function countMatching(entries: string[], pattern: RegExp): number {
  return entries.filter((entry) => pattern.test(entry)).length;
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
      const currentLinkTarget = await fs.readlink(currentTaskPath);
      expect(isTaskDirName(currentLinkTarget)).toBe(true);

      const taskEntries = await fs.readdir(tasksDirPath, { withFileTypes: true });
      const taskDirs = taskEntries.filter((entry) => entry.isDirectory() && /^001_/.test(entry.name));
      expect(taskDirs.length).toBe(1);

      const taskDir = taskDirs[0];
      if (!taskDir) {
        throw new Error("expected exactly one 001_ task directory");
      }

      const taskDirPath = path.join(tasksDirPath, taskDir.name);
      const taskIscPath = path.join(taskDirPath, "ISC.json");
      const taskThreadPath = path.join(taskDirPath, "THREAD.md");

      expect(await exists(taskIscPath)).toBe(true);
      expect(await exists(taskThreadPath)).toBe(true);

      const taskIscStat = await fs.lstat(taskIscPath);
      const taskThreadStat = await fs.lstat(taskThreadPath);
      expect(taskIscStat.isSymbolicLink()).toBe(true);
      expect(taskThreadStat.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(taskIscPath)).toBe("../../ISC.json");
      expect(await fs.readlink(taskThreadPath)).toBe("../../THREAD.md");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("repairs non-symlink current entry and non-symlink task artifacts", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-repair-current-"));
    const sessionId = "session-auto-prd-repair-current";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");

      const firstCurrentTarget = await fs.readlink(currentTaskPath);
      expect(isTaskDirName(firstCurrentTarget)).toBe(true);
      const taskDirPath = path.join(tasksDirPath, firstCurrentTarget);

      await fs.unlink(currentTaskPath);
      await fs.writeFile(currentTaskPath, "invalid-current", "utf8");

      await fs.unlink(path.join(taskDirPath, "ISC.json"));
      await fs.writeFile(path.join(taskDirPath, "ISC.json"), "legacy isc", "utf8");
      await fs.unlink(path.join(taskDirPath, "THREAD.md"));
      await fs.writeFile(path.join(taskDirPath, "THREAD.md"), "legacy thread", "utf8");

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toBe("");

      const repairedCurrentStat = await fs.lstat(currentTaskPath);
      expect(repairedCurrentStat.isSymbolicLink()).toBe(true);
      const repairedCurrentTarget = await fs.readlink(currentTaskPath);
      expect(repairedCurrentTarget).toBe(firstCurrentTarget);

      const taskIscPath = path.join(taskDirPath, "ISC.json");
      const taskThreadPath = path.join(taskDirPath, "THREAD.md");
      expect((await fs.lstat(taskIscPath)).isSymbolicLink()).toBe(true);
      expect((await fs.lstat(taskThreadPath)).isSymbolicLink()).toBe(true);
      expect(await fs.readlink(taskIscPath)).toBe("../../ISC.json");
      expect(await fs.readlink(taskThreadPath)).toBe("../../THREAD.md");

      const taskEntries = await fs.readdir(taskDirPath);
      expect(taskEntries.some((entry) => /^ISC\.json\.legacy\.\d+$/.test(entry))).toBe(true);
      expect(taskEntries.some((entry) => /^THREAD\.md\.legacy\.\d+$/.test(entry))).toBe(true);

      const tasksEntries = await fs.readdir(tasksDirPath);
      expect(tasksEntries.some((entry) => /^current\.invalid\.\d+$/.test(entry))).toBe(true);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("repairs missing task artifacts when current symlink stays valid and remains idempotent", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-repair-missing-files-"));
    const sessionId = "session-auto-prd-repair-missing-files";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");

      const taskEntriesBeforeRepair = await fs.readdir(tasksDirPath, { withFileTypes: true });
      const taskDirs001 = taskEntriesBeforeRepair
        .filter((entry) => entry.isDirectory() && /^001_/.test(entry.name))
        .map((entry) => entry.name);
      expect(taskDirs001).toHaveLength(1);

      const expectedTaskDir = taskDirs001[0];
      if (!expectedTaskDir) {
        throw new Error("expected exactly one 001_ task directory");
      }

      const firstCurrentStat = await fs.lstat(currentTaskPath);
      expect(firstCurrentStat.isSymbolicLink()).toBe(true);
      const firstCurrentTarget = await fs.readlink(currentTaskPath);
      expect(firstCurrentTarget).toBe(expectedTaskDir);

      const firstCurrentResolvedPath = path.resolve(tasksDirPath, firstCurrentTarget);
      expect(firstCurrentResolvedPath).toBe(path.join(tasksDirPath, expectedTaskDir));
      expect((await fs.lstat(firstCurrentResolvedPath)).isDirectory()).toBe(true);

      const taskDirPath = path.join(tasksDirPath, firstCurrentTarget);
      const taskIscPath = path.join(taskDirPath, "ISC.json");
      const taskThreadPath = path.join(taskDirPath, "THREAD.md");

      await fs.unlink(taskIscPath);
      await fs.unlink(taskThreadPath);

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toBe("");

      const repairedCurrentStat = await fs.lstat(currentTaskPath);
      expect(repairedCurrentStat.isSymbolicLink()).toBe(true);
      const repairedCurrentTarget = await fs.readlink(currentTaskPath);
      expect(repairedCurrentTarget).toBe(expectedTaskDir);

      const repairedCurrentResolvedPath = path.resolve(tasksDirPath, repairedCurrentTarget);
      expect(repairedCurrentResolvedPath).toBe(path.join(tasksDirPath, expectedTaskDir));
      expect((await fs.lstat(repairedCurrentResolvedPath)).isDirectory()).toBe(true);

      const repairedTaskDirPath = path.join(tasksDirPath, repairedCurrentTarget);
      expect((await fs.lstat(repairedTaskDirPath)).isDirectory()).toBe(true);

      const repairedTaskIscPath = path.join(repairedTaskDirPath, "ISC.json");
      const repairedTaskThreadPath = path.join(repairedTaskDirPath, "THREAD.md");
      expect(await exists(repairedTaskIscPath)).toBe(true);
      expect(await exists(repairedTaskThreadPath)).toBe(true);
      expect((await fs.lstat(repairedTaskIscPath)).isSymbolicLink()).toBe(true);
      expect((await fs.lstat(repairedTaskThreadPath)).isSymbolicLink()).toBe(true);
      expect(await fs.readlink(repairedTaskIscPath)).toBe("../../ISC.json");
      expect(await fs.readlink(repairedTaskThreadPath)).toBe("../../THREAD.md");

      const legacyCountBefore = countMatching(
        await fs.readdir(repairedTaskDirPath),
        /^(ISC\.json|THREAD\.md)\.legacy\.\d+$/,
      );
      const invalidCountBefore = countMatching(
        await fs.readdir(tasksDirPath),
        /^current\.invalid\.\d+$/,
      );

      const thirdRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(thirdRun.exitCode).toBe(0);
      expect(thirdRun.stderr).toBe("");

      const legacyCountAfter = countMatching(
        await fs.readdir(repairedTaskDirPath),
        /^(ISC\.json|THREAD\.md)\.legacy\.\d+$/,
      );
      const invalidCountAfter = countMatching(
        await fs.readdir(tasksDirPath),
        /^current\.invalid\.\d+$/,
      );

      expect(legacyCountAfter).toBe(legacyCountBefore);
      expect(invalidCountAfter).toBe(invalidCountBefore);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("repairs escaped current symlink target back into tasks root", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-current-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-current-target-"));
    const sessionId = "session-auto-prd-unsafe-current";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");

      await fs.unlink(currentTaskPath);
      await fs.symlink(outsideDir, currentTaskPath, "dir");

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);

      const repairedCurrentStat = await fs.lstat(currentTaskPath);
      expect(repairedCurrentStat.isSymbolicLink()).toBe(true);
      const repairedCurrentTarget = await fs.readlink(currentTaskPath);
      expect(isTaskDirName(repairedCurrentTarget)).toBe(true);

      const repairedTaskDirPath = path.resolve(tasksDirPath, repairedCurrentTarget);
      expect(repairedTaskDirPath.startsWith(`${tasksDirPath}${path.sep}`)).toBe(true);
      expect((await fs.lstat(repairedTaskDirPath)).isDirectory()).toBe(true);

      const repairedTaskIscPath = path.join(repairedTaskDirPath, "ISC.json");
      const repairedTaskThreadPath = path.join(repairedTaskDirPath, "THREAD.md");
      expect((await fs.lstat(repairedTaskIscPath)).isSymbolicLink()).toBe(true);
      expect((await fs.lstat(repairedTaskThreadPath)).isSymbolicLink()).toBe(true);
      expect(await fs.readlink(repairedTaskIscPath)).toBe("../../ISC.json");
      expect(await fs.readlink(repairedTaskThreadPath)).toBe("../../THREAD.md");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  test("unsafe tasks symlink is skipped with marker", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-tasks-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-target-"));
    const sessionId = "session-auto-prd-unsafe-tasks";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      await fs.rm(tasksDirPath, { recursive: true, force: true });
      await fs.symlink(outsideDir, tasksDirPath, "dir");

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toContain("PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_TASKS_DIR");

      const outsideEntries = await fs.readdir(outsideDir);
      expect(outsideEntries).toHaveLength(0);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  test("unsafe canonical ISC symlink is skipped with marker", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-canonical-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-canonical-target-"));
    const sessionId = "session-auto-prd-unsafe-canonical";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskName = await fs.readlink(path.join(tasksDirPath, "current"));
      expect(isTaskDirName(currentTaskName)).toBe(true);

      const taskIscPath = path.join(tasksDirPath, currentTaskName, "ISC.json");
      await fs.unlink(taskIscPath);
      await fs.writeFile(taskIscPath, "legacy isc", "utf8");

      const canonicalIscPath = path.join(workDir, "ISC.json");
      const outsideIscPath = path.join(outsideDir, "outside-isc.json");
      await fs.unlink(canonicalIscPath);
      await fs.symlink(outsideIscPath, canonicalIscPath);

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toContain("PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_CANONICAL_TARGET");

      const taskIscStat = await fs.lstat(taskIscPath);
      expect(taskIscStat.isSymbolicLink()).toBe(false);
      expect(await fs.readFile(taskIscPath, "utf8")).toBe("legacy isc");
      expect(await exists(outsideIscPath)).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  test("unsafe canonical THREAD symlink is skipped with marker", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-thread-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-unsafe-thread-target-"));
    const sessionId = "session-auto-prd-unsafe-thread";
    const prompt = "Implement deterministic task scaffold repair behavior";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskName = await fs.readlink(path.join(tasksDirPath, "current"));
      expect(isTaskDirName(currentTaskName)).toBe(true);

      const taskThreadPath = path.join(tasksDirPath, currentTaskName, "THREAD.md");
      await fs.unlink(taskThreadPath);
      await fs.writeFile(taskThreadPath, "legacy thread", "utf8");

      const canonicalThreadPath = path.join(workDir, "THREAD.md");
      const outsideThreadPath = path.join(outsideDir, "outside-thread.md");
      await fs.unlink(canonicalThreadPath);
      await fs.symlink(outsideThreadPath, canonicalThreadPath);

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toContain("PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_CANONICAL_TARGET");

      const taskThreadStat = await fs.lstat(taskThreadPath);
      expect(taskThreadStat.isSymbolicLink()).toBe(false);
      expect(await fs.readFile(taskThreadPath, "utf8")).toBe("legacy thread");
      expect(await exists(outsideThreadPath)).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
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
