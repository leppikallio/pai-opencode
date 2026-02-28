import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisFileDir, "..", "..", "..");
const PRD_FILENAME_PATTERN = /^PRD-\d{8}-[a-z0-9-]+\.md$/;

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
  autoPrdEnabled?: string;
  autoPrdPromptClassification?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/AutoWorkCreation.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      PAI_ENABLE_MEMORY_PARITY: "1",
      PAI_ENABLE_AUTO_PRD: args.autoPrdEnabled ?? "1",
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
    .filter((entry) => entry.isFile() && PRD_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function getCurrentTaskDirPath(workDir: string): Promise<string> {
  const tasksDirPath = path.join(workDir, "tasks");
  const currentTaskName = await fs.readlink(path.join(tasksDirPath, "current"));
  return path.join(tasksDirPath, currentTaskName);
}

async function listTaskPrdFiles(taskDirPath: string): Promise<string[]> {
  const entries = await fs.readdir(taskDirPath, { withFileTypes: true });
  return entries
    .filter((entry) => PRD_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function formatUtcDateStamp(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

async function readMetaStartedAtDateStamp(workDir: string): Promise<string> {
  const rawMeta = await fs.readFile(path.join(workDir, "META.yaml"), "utf8");
  const match = rawMeta.match(/^started_at:\s*(.+)\s*$/m);
  if (!match?.[1]) {
    throw new Error("META.yaml is missing started_at");
  }

  const startedAtRaw = match[1].trim().replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1");
  const startedAt = new Date(startedAtRaw);
  if (Number.isNaN(startedAt.getTime())) {
    throw new Error("META.yaml started_at is unparseable");
  }

  return formatUtcDateStamp(startedAt);
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

      const taskPrdFiles = await listTaskPrdFiles(taskDirPath);
      expect(taskPrdFiles).toHaveLength(1);
      const taskPrdName = taskPrdFiles[0];
      if (!taskPrdName) {
        throw new Error("expected one task-level PRD symlink");
      }

      const canonicalPrdPath = path.join(workDir, prdFiles[0] ?? "");
      const taskPrdPath = path.join(taskDirPath, taskPrdName);
      expect((await fs.lstat(taskPrdPath)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(taskPrdPath)).toBe(await fs.realpath(canonicalPrdPath));
      expect(run.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("repairs task-level PRD symlinks and preserves regular PRD files", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-task-link-repair-"));
    const sessionId = "session-auto-prd-task-link-repair";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const canonicalPrdFiles = await listPrdFiles(workDir);
      expect(canonicalPrdFiles).toHaveLength(1);

      const canonicalPrdName = canonicalPrdFiles[0];
      if (!canonicalPrdName) {
        throw new Error("expected one canonical PRD at session root");
      }

      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const staleSessionPrdName = "PRD-19990101-stale-session-prd.md";
      const staleTaskSymlinkName = "PRD-19990101-stale-task-link.md";
      const regularTaskPrdName = "PRD-19990101-keep-regular.md";

      await fs.writeFile(path.join(workDir, staleSessionPrdName), "# stale\n", "utf8");
      await fs.rm(path.join(taskDirPath, canonicalPrdName), { force: true });
      await fs.symlink(`../../${canonicalPrdName}`, path.join(taskDirPath, canonicalPrdName));
      await fs.rm(path.join(taskDirPath, staleTaskSymlinkName), { force: true });
      await fs.symlink(`../../${staleSessionPrdName}`, path.join(taskDirPath, staleTaskSymlinkName));
      await fs.writeFile(path.join(taskDirPath, regularTaskPrdName), "keep me\n", "utf8");

      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const taskPrdFiles = await listTaskPrdFiles(taskDirPath);
      const symlinkPrdFiles: string[] = [];

      for (const fileName of taskPrdFiles) {
        const stat = await fs.lstat(path.join(taskDirPath, fileName));
        if (stat.isSymbolicLink()) {
          symlinkPrdFiles.push(fileName);
        }
      }

      expect(symlinkPrdFiles).toEqual([canonicalPrdName]);
      expect(await fs.realpath(path.join(taskDirPath, canonicalPrdName))).toBe(
        await fs.realpath(path.join(workDir, canonicalPrdName)),
      );

      const regularPath = path.join(taskDirPath, regularTaskPrdName);
      expect((await fs.lstat(regularPath)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(regularPath, "utf8")).toBe("keep me\n");
      expect(await exists(path.join(taskDirPath, staleTaskSymlinkName))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("multi-candidate PRD selection prefers META date match", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-meta-winner-"));
    const sessionId = "session-auto-prd-meta-winner";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const existingPrdFiles = await listPrdFiles(workDir);
      for (const fileName of existingPrdFiles) {
        await fs.rm(path.join(workDir, fileName), { force: true });
      }

      const metaDateStamp = await readMetaStartedAtDateStamp(workDir);
      const expectedWinner = `PRD-${metaDateStamp}-aaa-date-match.md`;
      const otherCandidateA = "PRD-19990101-zzz-older.md";
      const otherCandidateB = "PRD-20990101-bbb-newer.md";

      await fs.writeFile(path.join(workDir, expectedWinner), "# winner\n", "utf8");
      await fs.writeFile(path.join(workDir, otherCandidateA), "# older\n", "utf8");
      await fs.writeFile(path.join(workDir, otherCandidateB), "# newer\n", "utf8");

      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const taskPrdFiles = await listTaskPrdFiles(taskDirPath);
      const symlinkPrdFiles: string[] = [];

      for (const fileName of taskPrdFiles) {
        const stat = await fs.lstat(path.join(taskDirPath, fileName));
        if (stat.isSymbolicLink()) {
          symlinkPrdFiles.push(fileName);
        }
      }

      expect(symlinkPrdFiles).toEqual([expectedWinner]);
      expect(await fs.realpath(path.join(taskDirPath, expectedWinner))).toBe(
        await fs.realpath(path.join(workDir, expectedWinner)),
      );
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("multi-candidate PRD selection prefers META expected filename when present", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-meta-expected-winner-"));
    const sessionId = "session-auto-prd-meta-expected-winner";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const initialPrdFiles = await listPrdFiles(workDir);
      expect(initialPrdFiles).toHaveLength(1);

      const expectedWinner = initialPrdFiles[0];
      if (!expectedWinner) {
        throw new Error("expected one canonical PRD at session root");
      }

      const metaDateStamp = await readMetaStartedAtDateStamp(workDir);
      const sameDateEarlierLexical = `PRD-${metaDateStamp}-000-alpha.md`;
      const otherDateCandidate = "PRD-19990101-zzz-older.md";

      for (const fileName of initialPrdFiles) {
        await fs.rm(path.join(workDir, fileName), { force: true });
      }

      await fs.writeFile(path.join(workDir, expectedWinner), "# expected\n", "utf8");
      await fs.writeFile(path.join(workDir, sameDateEarlierLexical), "# same-date\n", "utf8");
      await fs.writeFile(path.join(workDir, otherDateCandidate), "# older\n", "utf8");

      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const taskPrdFiles = await listTaskPrdFiles(taskDirPath);
      const symlinkPrdFiles: string[] = [];

      for (const fileName of taskPrdFiles) {
        const stat = await fs.lstat(path.join(taskDirPath, fileName));
        if (stat.isSymbolicLink()) {
          symlinkPrdFiles.push(fileName);
        }
      }

      expect(symlinkPrdFiles).toEqual([expectedWinner]);
      expect(await fs.realpath(path.join(taskDirPath, expectedWinner))).toBe(
        await fs.realpath(path.join(workDir, expectedWinner)),
      );
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("task PRD alternate symlink remains stable when canonical basename is blocked by regular file", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-stable-alt-link-"));
    const sessionId = "session-auto-prd-stable-alt-link";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const canonicalPrdFiles = await listPrdFiles(workDir);
      expect(canonicalPrdFiles).toHaveLength(1);

      const canonicalPrdName = canonicalPrdFiles[0];
      if (!canonicalPrdName) {
        throw new Error("expected one canonical PRD at session root");
      }

      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const canonicalTaskPrdPath = path.join(taskDirPath, canonicalPrdName);
      await fs.rm(canonicalTaskPrdPath, { force: true });
      await fs.writeFile(canonicalTaskPrdPath, "blocked canonical basename\n", "utf8");

      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const afterSecondTaskPrdFiles = await listTaskPrdFiles(taskDirPath);
      const afterSecondSymlinkPrdFiles: string[] = [];
      for (const fileName of afterSecondTaskPrdFiles) {
        const stat = await fs.lstat(path.join(taskDirPath, fileName));
        if (stat.isSymbolicLink()) {
          afterSecondSymlinkPrdFiles.push(fileName);
        }
      }

      expect(afterSecondSymlinkPrdFiles).toHaveLength(1);
      const alternateLinkName = afterSecondSymlinkPrdFiles[0];
      if (!alternateLinkName) {
        throw new Error("expected one task-level PRD symlink");
      }
      expect(alternateLinkName).not.toBe(canonicalPrdName);

      const alternateLinkPath = path.join(taskDirPath, alternateLinkName);
      const inodeAfterSecondRun = (await fs.lstat(alternateLinkPath)).ino;

      const thirdRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(thirdRun.exitCode).toBe(0);
      expect(thirdRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const inodeAfterThirdRun = (await fs.lstat(alternateLinkPath)).ino;
      expect(inodeAfterThirdRun).toBe(inodeAfterSecondRun);

      expect(await fs.realpath(alternateLinkPath)).toBe(await fs.realpath(path.join(workDir, canonicalPrdName)));
      expect((await fs.lstat(canonicalTaskPrdPath)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(canonicalTaskPrdPath, "utf8")).toBe("blocked canonical basename\n");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("multi-candidate PRD selection falls back to lexicographic winner when META is unparseable", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-lexical-winner-"));
    const sessionId = "session-auto-prd-lexical-winner";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const existingPrdFiles = await listPrdFiles(workDir);
      for (const fileName of existingPrdFiles) {
        await fs.rm(path.join(workDir, fileName), { force: true });
      }

      await fs.writeFile(path.join(workDir, "META.yaml"), "title: Broken\nstarted_at: not-a-date\n", "utf8");

      const expectedWinner = "PRD-20230101-aaa-first.md";
      const candidateB = "PRD-20230101-bbb-second.md";
      const candidateC = "PRD-20240101-ccc-third.md";

      await fs.writeFile(path.join(workDir, expectedWinner), "# first\n", "utf8");
      await fs.writeFile(path.join(workDir, candidateB), "# second\n", "utf8");
      await fs.writeFile(path.join(workDir, candidateC), "# third\n", "utf8");

      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).not.toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const taskPrdFiles = await listTaskPrdFiles(taskDirPath);
      const symlinkPrdFiles: string[] = [];

      for (const fileName of taskPrdFiles) {
        const stat = await fs.lstat(path.join(taskDirPath, fileName));
        if (stat.isSymbolicLink()) {
          symlinkPrdFiles.push(fileName);
        }
      }

      expect(symlinkPrdFiles).toEqual([expectedWinner]);
      expect(await fs.realpath(path.join(taskDirPath, expectedWinner))).toBe(
        await fs.realpath(path.join(workDir, expectedWinner)),
      );
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("no-candidate PRD path emits marker and leaves task PRD files unchanged", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-no-candidate-"));
    const sessionId = "session-auto-prd-no-candidate";
    const prompt = "Implement deterministic auto PRD creation for memory parity handlers";

    try {
      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const taskDirPath = await getCurrentTaskDirPath(workDir);
      const sessionPrdFiles = await listPrdFiles(workDir);
      for (const fileName of sessionPrdFiles) {
        await fs.rm(path.join(workDir, fileName), { force: true });
      }

      const regularTaskPrdName = "PRD-20991231-keep-regular.md";
      const regularTaskPrdPath = path.join(taskDirPath, regularTaskPrdName);
      await fs.writeFile(regularTaskPrdPath, "regular stays\n", "utf8");

      const beforePrdEntries = await listTaskPrdFiles(taskDirPath);
      const secondRun = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt,
        autoPrdEnabled: "0",
      });
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toContain("PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE");

      const afterPrdEntries = await listTaskPrdFiles(taskDirPath);
      expect(afterPrdEntries).toEqual(beforePrdEntries);
      expect((await fs.lstat(regularTaskPrdPath)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(regularTaskPrdPath, "utf8")).toBe("regular stays\n");
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
      const sentinelPath = path.join(outsideDir, "sentinel.txt");
      await fs.writeFile(sentinelPath, "do-not-touch", "utf8");
      const outsideEntriesBefore = (await fs.readdir(outsideDir)).sort();
      const sentinelContentsBefore = await fs.readFile(sentinelPath, "utf8");

      const firstRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(firstRun.exitCode).toBe(0);

      const workDir = await getWorkDir(paiDir, sessionId);
      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");

      await fs.unlink(currentTaskPath);
      await fs.symlink(outsideDir, currentTaskPath, "dir");

      const secondRun = await runAutoWorkCreationHook({ paiDir, sessionId, prompt });
      expect(secondRun.exitCode).toBe(0);

      expect(await fs.readFile(sentinelPath, "utf8")).toBe(sentinelContentsBefore);
      expect((await fs.readdir(outsideDir)).sort()).toEqual(outsideEntriesBefore);

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

      const workDir = await getWorkDir(paiDir, sessionId);
      const prdFiles = await listPrdFiles(workDir);
      expect(prdFiles.length).toBe(1);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test('prompt "ok" exits without creating current-work state', async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-ok-"));
    const sessionId = "session-auto-prd-ok";

    try {
      const run = await runAutoWorkCreationHook({ paiDir, sessionId, prompt: "ok" });
      expect(run.exitCode).toBe(0);

      const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
      expect(await exists(statePath)).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test('near-miss prompt "ok I need help" is not treated as trivial', async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-auto-prd-ok-near-miss-"));
    const sessionId = "session-auto-prd-ok-near-miss";

    try {
      const run = await runAutoWorkCreationHook({
        paiDir,
        sessionId,
        prompt: "ok I need help",
      });
      expect(run.exitCode).toBe(0);

      const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
      expect(await exists(statePath)).toBe(true);

      const workDir = await getWorkDir(paiDir, sessionId);
      expect(await exists(path.join(workDir, "tasks", "current"))).toBe(true);
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
      const canonicalPrdFiles = await listPrdFiles(workDir);
      expect(canonicalPrdFiles).toHaveLength(1);

      const canonicalPrdName = canonicalPrdFiles[0];
      if (!canonicalPrdName) {
        throw new Error("expected one canonical PRD at session root");
      }

      const tasksDirPath = path.join(workDir, "tasks");
      const currentTaskPath = path.join(tasksDirPath, "current");
      expect(await exists(currentTaskPath)).toBe(true);

      const taskEntries = await fs.readdir(tasksDirPath, { withFileTypes: true });
      const taskDirs = taskEntries
        .filter((entry) => entry.isDirectory() && isTaskDirName(entry.name))
        .map((entry) => entry.name);
      expect(taskDirs).toHaveLength(1);

      const onlyTaskDir = taskDirs[0];
      if (!onlyTaskDir) {
        throw new Error("expected exactly one task directory");
      }
      expect(onlyTaskDir.startsWith("001_")).toBe(true);

      const currentTaskStat = await fs.lstat(currentTaskPath);
      expect(currentTaskStat.isSymbolicLink()).toBe(true);
      const currentTaskTarget = await fs.readlink(currentTaskPath);

      const resolvedCurrentTaskPath = path.resolve(tasksDirPath, currentTaskTarget);
      expect(resolvedCurrentTaskPath.startsWith(`${tasksDirPath}${path.sep}`)).toBe(true);
      expect(resolvedCurrentTaskPath).toBe(path.join(tasksDirPath, onlyTaskDir));
      expect((await fs.lstat(resolvedCurrentTaskPath)).isDirectory()).toBe(true);

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
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
