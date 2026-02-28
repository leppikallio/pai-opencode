import * as fs from "node:fs";
import * as path from "node:path";

import { getCurrentWorkPathForSession, slugify } from "../lib/paths";

const TASK_DIR_NAME_PATTERN = /^\d{3}_[a-z0-9-]+$/;
const PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR = "PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_TASKS_DIR\n";
const PAI_TASK_SCAFFOLD_UNSAFE_CANONICAL_TARGET =
  "PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_CANONICAL_TARGET\n";

type WorkMeta = {
  title: string;
  startedAt: string;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath === "") {
    return true;
  }

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function parseMetaValue(content: string, key: string): string | null {
  const matcher = new RegExp(`^${key}:\\s*(.+)\\s*$`, "m");
  const match = content.match(matcher);
  if (!match?.[1]) {
    return null;
  }

  const raw = match[1].trim();
  if (!raw) {
    return null;
  }

  const quoted = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
  return quoted?.[1] ?? raw;
}

async function readWorkMeta(workDir: string): Promise<WorkMeta> {
  const metaPath = path.join(workDir, "META.yaml");
  const now = new Date().toISOString();

  try {
    const content = await fs.promises.readFile(metaPath, "utf-8");
    const title = parseMetaValue(content, "title")?.trim() || "task";
    const startedAt = parseMetaValue(content, "started_at")?.trim() || now;
    return { title, startedAt };
  } catch {
    return {
      title: "task",
      startedAt: now,
    };
  }
}

async function lstatOrNull(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(targetPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeFileAtomicOnce(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  let handle: fs.promises.FileHandle | null = null;

  try {
    handle = await fs.promises.open(filePath, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
  } catch (error) {
    if (!(isErrnoException(error) && error.code === "EEXIST")) {
      throw error;
    }
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

function iscTemplate(nowIso: string): string {
  return `${JSON.stringify(
    {
      v: "0.1",
      ideal: "",
      criteria: [],
      antiCriteria: [],
      updatedAt: nowIso,
    },
    null,
    2,
  )}\n`;
}

function threadTemplate(meta: WorkMeta): string {
  return `# ${meta.title}\n\n**Started:** ${meta.startedAt}\n**Status:** ACTIVE\n\n---\n\n`;
}

async function createTimestampedRename(originalPath: string, suffix: string): Promise<void> {
  const dirPath = path.dirname(originalPath);
  const baseName = path.basename(originalPath);
  const now = Date.now();
  let attempt = 0;

  while (true) {
    const candidateSuffix = attempt === 0 ? `${suffix}.${now}` : `${suffix}.${now}.${attempt}`;
    const candidatePath = path.join(dirPath, `${baseName}.${candidateSuffix}`);

    try {
      await fs.promises.rename(originalPath, candidatePath);
      return;
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function ensureSafeTasksDir(workDir: string): Promise<string | null> {
  const tasksDir = path.join(workDir, "tasks");
  const current = await lstatOrNull(tasksDir);

  if (!current) {
    await fs.promises.mkdir(tasksDir, { recursive: true });
  }

  if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
    process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
    return null;
  }

  return tasksDir;
}

async function ensureTasksDirSafeForMutation(tasksDir: string): Promise<boolean> {
  const tasksDirStat = await lstatOrNull(tasksDir);
  return Boolean(tasksDirStat && tasksDirStat.isDirectory() && !tasksDirStat.isSymbolicLink());
}

async function listTaskDirs(tasksDir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && TASK_DIR_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left.slice(0, 3), 10);
      const rightNumber = Number.parseInt(right.slice(0, 3), 10);
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      return left.localeCompare(right);
    });
}

async function resolveSafeRealPath(targetPath: string, workDir: string): Promise<string | null> {
  try {
    const resolvedRealPath = await fs.promises.realpath(targetPath);
    if (!isInsideRoot(workDir, resolvedRealPath)) {
      return null;
    }
    return resolvedRealPath;
  } catch {
    return null;
  }
}

async function getValidCurrentTaskDirName(
  currentLinkPath: string,
  tasksDir: string,
  workDir: string,
): Promise<string | null> {
  const currentStat = await lstatOrNull(currentLinkPath);
  if (!currentStat) {
    return null;
  }

  if (!currentStat.isSymbolicLink()) {
    await createTimestampedRename(currentLinkPath, "invalid");
    return null;
  }

  let linkTarget = "";
  try {
    linkTarget = await fs.promises.readlink(currentLinkPath);
  } catch {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  const resolvedTarget = path.resolve(path.dirname(currentLinkPath), linkTarget);
  if (!isInsideRoot(tasksDir, resolvedTarget)) {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  const taskDirName = path.basename(resolvedTarget);
  if (!TASK_DIR_NAME_PATTERN.test(taskDirName)) {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  let targetStat: fs.Stats;
  try {
    targetStat = await fs.promises.stat(resolvedTarget);
  } catch {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  if (!targetStat.isDirectory()) {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  const targetRealPath = await resolveSafeRealPath(resolvedTarget, workDir);
  if (!targetRealPath || !isInsideRoot(tasksDir, targetRealPath)) {
    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return null;
  }

  return taskDirName;
}

async function ensureTaskLink(args: {
  linkPath: string;
  linkTarget: string;
  expectedResolvedTarget: string;
  workDir: string;
  tasksDir: string;
}): Promise<void> {
  const validateTasksDir = async (): Promise<boolean> => {
    if (await ensureTasksDirSafeForMutation(args.tasksDir)) {
      return true;
    }
    process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
    return false;
  };

  const currentStat = await lstatOrNull(args.linkPath);
  if (!currentStat) {
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
    return;
  }

  if (!currentStat.isSymbolicLink()) {
    if (!(await validateTasksDir())) {
      return;
    }
    await createTimestampedRename(args.linkPath, "legacy");
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
    return;
  }

  let currentTarget = "";
  try {
    currentTarget = await fs.promises.readlink(args.linkPath);
  } catch {
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.unlink(args.linkPath).catch(() => undefined);
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
    return;
  }

  const resolvedTarget = path.resolve(path.dirname(args.linkPath), currentTarget);
  const resolvedRealPath = await resolveSafeRealPath(resolvedTarget, args.workDir);
  const expectedTargetPath = path.resolve(args.expectedResolvedTarget);
  const isExpectedTarget = path.resolve(resolvedTarget) === expectedTargetPath;

  if (!resolvedRealPath || !isExpectedTarget) {
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.unlink(args.linkPath).catch(() => undefined);
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
  }
}

async function ensureCanonicalFiles(workDir: string, meta: WorkMeta): Promise<void> {
  await writeFileAtomicOnce(path.join(workDir, "ISC.json"), iscTemplate(new Date().toISOString()));
  await writeFileAtomicOnce(path.join(workDir, "THREAD.md"), threadTemplate(meta));
}

async function isCanonicalTargetSafe(workDir: string, canonicalPath: string): Promise<boolean> {
  const canonicalStat = await lstatOrNull(canonicalPath);
  if (!canonicalStat) {
    return false;
  }

  if (!canonicalStat.isSymbolicLink()) {
    return true;
  }

  const canonicalRealPath = await resolveSafeRealPath(canonicalPath, workDir);
  return canonicalRealPath !== null;
}

async function ensureCanonicalTargetsSafe(workDir: string): Promise<boolean> {
  const iscPath = path.join(workDir, "ISC.json");
  const threadPath = path.join(workDir, "THREAD.md");
  return (
    (await isCanonicalTargetSafe(workDir, iscPath)) &&
    (await isCanonicalTargetSafe(workDir, threadPath))
  );
}

async function ensureCurrentTaskDirName(
  tasksDir: string,
  currentLinkPath: string,
  workDir: string,
  prompt: string,
): Promise<string | null> {
  const authoritative = await getValidCurrentTaskDirName(currentLinkPath, tasksDir, workDir);
  if (authoritative) {
    return authoritative;
  }

  const taskDirs = await listTaskDirs(tasksDir);
  if (taskDirs.length > 0) {
    const chosen = taskDirs[taskDirs.length - 1];
    if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
      process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
      return null;
    }
    await fs.promises.symlink(chosen, currentLinkPath);
    return chosen;
  }

  const meta = await readWorkMeta(workDir);
  const fallbackTitle = meta.title || prompt || "task";
  const slug = slugify(fallbackTitle) || "task";
  const firstTaskDirName = `001_${slug}`;
  const firstTaskPath = path.join(tasksDir, firstTaskDirName);
  if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
    process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
    return null;
  }
  await fs.promises.mkdir(firstTaskPath, { recursive: true });
  if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
    process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
    return null;
  }
  await fs.promises.symlink(firstTaskDirName, currentLinkPath);
  return firstTaskDirName;
}

export async function ensureTaskScaffoldForSession(sessionId: string, prompt: string): Promise<void> {
  try {
    const workDir = await getCurrentWorkPathForSession(sessionId);
    if (!workDir) {
      return;
    }

    const resolvedWorkDir = path.resolve(workDir);
    const workDirStat = await lstatOrNull(resolvedWorkDir);
    if (!workDirStat?.isDirectory()) {
      return;
    }

    const tasksDir = await ensureSafeTasksDir(resolvedWorkDir);
    if (!tasksDir) {
      return;
    }

    const meta = await readWorkMeta(resolvedWorkDir);
    await ensureCanonicalFiles(resolvedWorkDir, meta);
    if (!(await ensureCanonicalTargetsSafe(resolvedWorkDir))) {
      process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_CANONICAL_TARGET);
      return;
    }

    const currentLinkPath = path.join(tasksDir, "current");
    const currentTaskDirName = await ensureCurrentTaskDirName(
      tasksDir,
      currentLinkPath,
      resolvedWorkDir,
      prompt,
    );
    if (!currentTaskDirName) {
      return;
    }

    const currentTaskDirPath = path.join(tasksDir, currentTaskDirName);
    if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
      process.stderr.write(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
      return;
    }
    await fs.promises.mkdir(currentTaskDirPath, { recursive: true });

    await ensureTaskLink({
      linkPath: path.join(currentTaskDirPath, "ISC.json"),
      linkTarget: "../../ISC.json",
      expectedResolvedTarget: path.join(resolvedWorkDir, "ISC.json"),
      workDir: resolvedWorkDir,
      tasksDir,
    });

    await ensureTaskLink({
      linkPath: path.join(currentTaskDirPath, "THREAD.md"),
      linkTarget: "../../THREAD.md",
      expectedResolvedTarget: path.join(resolvedWorkDir, "THREAD.md"),
      workDir: resolvedWorkDir,
      tasksDir,
    });
  } catch {
    // Best effort only. Hook callers must never throw.
  }
}
