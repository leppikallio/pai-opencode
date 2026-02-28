import * as fs from "node:fs";
import * as path from "node:path";

import { getCurrentWorkPathForSession, slugify } from "../lib/paths";
import { generatePRDFilename } from "../lib/prd-template";

const TASK_DIR_NAME_PATTERN = /^\d{3}_[a-z0-9-]+$/;
const PRD_FILE_NAME_PATTERN = /^PRD-\d{8}-[a-z0-9-]+\.md$/;
const PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR = "PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_TASKS_DIR\n";
const PAI_TASK_SCAFFOLD_UNSAFE_CANONICAL_TARGET =
  "PAI_TASK_SCAFFOLD_SKIPPED_UNSAFE_CANONICAL_TARGET\n";
const PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE =
  "PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE\n";

type MarkerEmitter = (marker: string) => void;

type WorkMeta = {
  title: string;
  startedAt: string;
};

type ParsedWorkMeta = {
  title: string;
  startedAt: Date;
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

async function readParsedWorkMeta(workDir: string): Promise<ParsedWorkMeta | null> {
  const metaPath = path.join(workDir, "META.yaml");
  let content = "";

  try {
    content = await fs.promises.readFile(metaPath, "utf-8");
  } catch {
    return null;
  }

  const titleRaw = parseMetaValue(content, "title")?.trim();
  const startedAtRaw = parseMetaValue(content, "started_at")?.trim();
  if (!titleRaw || !startedAtRaw) {
    return null;
  }

  const startedAt = new Date(startedAtRaw);
  if (Number.isNaN(startedAt.getTime())) {
    return null;
  }

  return {
    title: titleRaw,
    startedAt,
  };
}

function dateStampFor(date: Date): string {
  const markerFilename = generatePRDFilename("marker", date);
  return markerFilename.slice("PRD-".length, "PRD-".length + 8);
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

function createRunMarkerEmitter(): MarkerEmitter {
  const emittedMarkers = new Set<string>();
  return (marker: string): void => {
    if (emittedMarkers.has(marker)) {
      return;
    }
    emittedMarkers.add(marker);
    process.stderr.write(marker);
  };
}

async function ensureSafeTasksDir(workDir: string, emitMarker: MarkerEmitter): Promise<string | null> {
  const tasksDir = path.join(workDir, "tasks");
  const current = await lstatOrNull(tasksDir);

  if (!current) {
    await fs.promises.mkdir(tasksDir, { recursive: true });
  }

  if (!(await ensureTasksDirSafeForMutation(tasksDir))) {
    emitMarker(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
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

type SessionPrdCandidate = {
  name: string;
  absolutePath: string;
};

async function resolveInsideWorkRoot(targetPath: string, workDir: string): Promise<string | null> {
  try {
    const [resolvedRealPath, workRootRealPath] = await Promise.all([
      fs.promises.realpath(targetPath),
      fs.promises.realpath(workDir).catch(() => path.resolve(workDir)),
    ]);

    if (!isInsideRoot(workRootRealPath, resolvedRealPath)) {
      return null;
    }

    return resolvedRealPath;
  } catch {
    return null;
  }
}

async function listSessionPrdCandidates(workDir: string): Promise<SessionPrdCandidate[]> {
  const entries = await fs.promises.readdir(workDir, { withFileTypes: true });
  const candidates: SessionPrdCandidate[] = [];

  for (const entry of entries) {
    if (!PRD_FILE_NAME_PATTERN.test(entry.name)) {
      continue;
    }

    const absolutePath = path.join(workDir, entry.name);
    const stat = await lstatOrNull(absolutePath);
    if (!stat || stat.isDirectory()) {
      continue;
    }

    const resolvedRealPath = await resolveInsideWorkRoot(absolutePath, workDir);
    if (!resolvedRealPath) {
      continue;
    }

    candidates.push({
      name: entry.name,
      absolutePath,
    });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  return candidates;
}

async function chooseCanonicalSessionPrdPath(workDir: string): Promise<string | null> {
  const parsedMeta = await readParsedWorkMeta(workDir);
  if (parsedMeta) {
    const slug = slugify(parsedMeta.title) || "work-session";
    const expectedName = generatePRDFilename(slug, parsedMeta.startedAt);
    const expectedPath = path.join(workDir, expectedName);
    const expectedStat = await lstatOrNull(expectedPath);
    if (expectedStat && !expectedStat.isDirectory()) {
      const expectedRealPath = await resolveInsideWorkRoot(expectedPath, workDir);
      if (expectedRealPath) {
        return expectedPath;
      }
    }
  }

  const candidates = await listSessionPrdCandidates(workDir);
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0]?.absolutePath ?? null;
  }

  if (!parsedMeta) {
    return candidates[0]?.absolutePath ?? null;
  }

  const expectedDateStamp = dateStampFor(parsedMeta.startedAt);
  const dateMatchedCandidates = candidates.filter(
    (candidate) => candidate.name.slice("PRD-".length, "PRD-".length + 8) === expectedDateStamp,
  );

  if (dateMatchedCandidates.length > 0) {
    return dateMatchedCandidates[0]?.absolutePath ?? null;
  }

  return candidates[0]?.absolutePath ?? null;
}

function buildTaskPrdLinkName(basePrdName: string, attempt: number): string {
  if (attempt <= 0) {
    return basePrdName;
  }

  const suffix = `-link-${attempt}.md`;
  return basePrdName.endsWith(".md") ? `${basePrdName.slice(0, -3)}${suffix}` : `${basePrdName}${suffix}`;
}

async function ensureTaskPrdLink(args: {
  taskDirPath: string;
  canonicalPrdPath: string;
  workDir: string;
  validateTasksDir: () => Promise<boolean>;
}): Promise<void> {
  const canonicalRealPath = await resolveInsideWorkRoot(args.canonicalPrdPath, args.workDir);
  if (!canonicalRealPath) {
    return;
  }

  const canonicalPrdName = path.basename(args.canonicalPrdPath);
  const entries = await fs.promises.readdir(args.taskDirPath, { withFileTypes: true });
  const prdNames = entries
    .filter((entry) => PRD_FILE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const canonicalTaskPrdPath = path.join(args.taskDirPath, canonicalPrdName);
  const canonicalTaskPrdStat = await lstatOrNull(canonicalTaskPrdPath);
  const canUseCanonicalPrdName = !canonicalTaskPrdStat || canonicalTaskPrdStat.isSymbolicLink();

  const canonicalTargetSymlinkNames: string[] = [];
  for (const prdName of prdNames) {
    const entryPath = path.join(args.taskDirPath, prdName);
    const entryStat = await lstatOrNull(entryPath);
    if (!entryStat?.isSymbolicLink()) {
      continue;
    }

    try {
      const currentTarget = await fs.promises.readlink(entryPath);
      const resolvedTarget = path.resolve(path.dirname(entryPath), currentTarget);
      const resolvedRealPath = await resolveInsideWorkRoot(resolvedTarget, args.workDir);
      if (resolvedRealPath && path.resolve(resolvedRealPath) === path.resolve(canonicalRealPath)) {
        canonicalTargetSymlinkNames.push(prdName);
      }
    } catch {
      continue;
    }
  }

  let desiredLinkName = canonicalPrdName;
  if (!canUseCanonicalPrdName) {
    const alternateCanonicalTargetSymlink = canonicalTargetSymlinkNames.find(
      (prdName) => prdName !== canonicalPrdName,
    );
    if (alternateCanonicalTargetSymlink) {
      desiredLinkName = alternateCanonicalTargetSymlink;
    } else {
      let attempt = 1;
      while (true) {
        const candidateName = buildTaskPrdLinkName(canonicalPrdName, attempt);
        const candidatePath = path.join(args.taskDirPath, candidateName);
        const candidateStat = await lstatOrNull(candidatePath);
        if (!candidateStat || candidateStat.isSymbolicLink()) {
          desiredLinkName = candidateName;
          break;
        }
        attempt += 1;
      }
    }
  }

  let desiredSymlinkKept = false;
  for (const prdName of prdNames) {
    const entryPath = path.join(args.taskDirPath, prdName);
    const entryStat = await lstatOrNull(entryPath);
    if (!entryStat?.isSymbolicLink()) {
      continue;
    }

    let shouldKeep = false;
    try {
      const currentTarget = await fs.promises.readlink(entryPath);
      const resolvedTarget = path.resolve(path.dirname(entryPath), currentTarget);
      const resolvedRealPath = await resolveInsideWorkRoot(resolvedTarget, args.workDir);
      shouldKeep =
        resolvedRealPath !== null &&
        path.resolve(resolvedRealPath) === path.resolve(canonicalRealPath) &&
        prdName === desiredLinkName &&
        !desiredSymlinkKept;
    } catch {
      shouldKeep = false;
    }

    if (shouldKeep) {
      desiredSymlinkKept = true;
      continue;
    }

    if (!(await args.validateTasksDir())) {
      return;
    }
    await fs.promises.unlink(entryPath).catch(() => undefined);
  }

  if (desiredSymlinkKept) {
    return;
  }

  const desiredLinkPath = path.join(args.taskDirPath, desiredLinkName);

  if (!(await args.validateTasksDir())) {
    return;
  }
  await fs.promises.symlink(path.relative(args.taskDirPath, args.canonicalPrdPath), desiredLinkPath);
}

async function getValidCurrentTaskDirName(
  currentLinkPath: string,
  tasksDir: string,
  workDir: string,
  validateTasksDir: () => Promise<boolean>,
): Promise<string | null> {
  const unlinkCurrentLink = async (): Promise<boolean> => {
    if (!(await validateTasksDir())) {
      return false;
    }

    await fs.promises.unlink(currentLinkPath).catch(() => undefined);
    return true;
  };

  if (!(await validateTasksDir())) {
    return null;
  }

  const currentStat = await lstatOrNull(currentLinkPath);
  if (!currentStat) {
    return null;
  }

  if (!currentStat.isSymbolicLink()) {
    if (!(await validateTasksDir())) {
      return null;
    }
    await createTimestampedRename(currentLinkPath, "invalid");
    return null;
  }

  let linkTarget = "";
  try {
    linkTarget = await fs.promises.readlink(currentLinkPath);
  } catch {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  const resolvedTarget = path.resolve(path.dirname(currentLinkPath), linkTarget);
  if (!isInsideRoot(tasksDir, resolvedTarget)) {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  const taskDirName = path.basename(resolvedTarget);
  if (!TASK_DIR_NAME_PATTERN.test(taskDirName)) {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  let targetStat: fs.Stats;
  try {
    targetStat = await fs.promises.stat(resolvedTarget);
  } catch {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  if (!targetStat.isDirectory()) {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  const targetRealPath = await resolveSafeRealPath(resolvedTarget, workDir);
  if (!targetRealPath || !isInsideRoot(tasksDir, targetRealPath)) {
    if (!(await unlinkCurrentLink())) {
      return null;
    }
    return null;
  }

  return taskDirName;
}

async function ensureTaskLink(args: {
  linkPath: string;
  linkTarget: string;
  expectedResolvedTarget: string;
  workDir: string;
  validateTasksDir: () => Promise<boolean>;
}): Promise<void> {
  const currentStat = await lstatOrNull(args.linkPath);
  if (!currentStat) {
    if (!(await args.validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
    return;
  }

  if (!currentStat.isSymbolicLink()) {
    if (!(await args.validateTasksDir())) {
      return;
    }
    await createTimestampedRename(args.linkPath, "legacy");
    if (!(await args.validateTasksDir())) {
      return;
    }
    await fs.promises.symlink(args.linkTarget, args.linkPath);
    return;
  }

  let currentTarget = "";
  try {
    currentTarget = await fs.promises.readlink(args.linkPath);
  } catch {
    if (!(await args.validateTasksDir())) {
      return;
    }
    await fs.promises.unlink(args.linkPath).catch(() => undefined);
    if (!(await args.validateTasksDir())) {
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
    if (!(await args.validateTasksDir())) {
      return;
    }
    await fs.promises.unlink(args.linkPath).catch(() => undefined);
    if (!(await args.validateTasksDir())) {
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
  validateTasksDir: () => Promise<boolean>,
): Promise<string | null> {
  const authoritative = await getValidCurrentTaskDirName(
    currentLinkPath,
    tasksDir,
    workDir,
    validateTasksDir,
  );
  if (authoritative) {
    return authoritative;
  }

  const taskDirs = await listTaskDirs(tasksDir);
  if (taskDirs.length > 0) {
    const chosen = taskDirs[taskDirs.length - 1];
    if (!(await validateTasksDir())) {
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
  if (!(await validateTasksDir())) {
    return null;
  }
  await fs.promises.mkdir(firstTaskPath, { recursive: true });
  if (!(await validateTasksDir())) {
    return null;
  }
  await fs.promises.symlink(firstTaskDirName, currentLinkPath);
  return firstTaskDirName;
}

export async function ensureTaskScaffoldForSession(sessionId: string, prompt: string): Promise<void> {
  try {
    const emitMarker = createRunMarkerEmitter();
    const workDir = await getCurrentWorkPathForSession(sessionId);
    if (!workDir) {
      return;
    }

    const resolvedWorkDir = path.resolve(workDir);
    const workDirStat = await lstatOrNull(resolvedWorkDir);
    if (!workDirStat?.isDirectory()) {
      return;
    }

    const tasksDir = await ensureSafeTasksDir(resolvedWorkDir, emitMarker);
    if (!tasksDir) {
      return;
    }

    const validateTasksDir = async (): Promise<boolean> => {
      if (await ensureTasksDirSafeForMutation(tasksDir)) {
        return true;
      }
      emitMarker(PAI_TASK_SCAFFOLD_UNSAFE_TASKS_DIR);
      return false;
    };

    const meta = await readWorkMeta(resolvedWorkDir);
    await ensureCanonicalFiles(resolvedWorkDir, meta);
    if (!(await ensureCanonicalTargetsSafe(resolvedWorkDir))) {
      emitMarker(PAI_TASK_SCAFFOLD_UNSAFE_CANONICAL_TARGET);
      return;
    }

    const currentLinkPath = path.join(tasksDir, "current");
    const currentTaskDirName = await ensureCurrentTaskDirName(
      tasksDir,
      currentLinkPath,
      resolvedWorkDir,
      prompt,
      validateTasksDir,
    );
    if (!currentTaskDirName) {
      return;
    }

    const currentTaskDirPath = path.join(tasksDir, currentTaskDirName);
    if (!(await validateTasksDir())) {
      return;
    }
    await fs.promises.mkdir(currentTaskDirPath, { recursive: true });

    await ensureTaskLink({
      linkPath: path.join(currentTaskDirPath, "ISC.json"),
      linkTarget: "../../ISC.json",
      expectedResolvedTarget: path.join(resolvedWorkDir, "ISC.json"),
      workDir: resolvedWorkDir,
      validateTasksDir,
    });

    await ensureTaskLink({
      linkPath: path.join(currentTaskDirPath, "THREAD.md"),
      linkTarget: "../../THREAD.md",
      expectedResolvedTarget: path.join(resolvedWorkDir, "THREAD.md"),
      workDir: resolvedWorkDir,
      validateTasksDir,
    });

    const canonicalPrdPath = await chooseCanonicalSessionPrdPath(resolvedWorkDir);
    if (!canonicalPrdPath) {
      emitMarker(PAI_TASK_SCAFFOLD_PRD_LINK_SKIPPED_NO_CANDIDATE);
      return;
    }

    await ensureTaskPrdLink({
      taskDirPath: currentTaskDirPath,
      canonicalPrdPath,
      workDir: resolvedWorkDir,
      validateTasksDir,
    });
  } catch {
    // Best effort only. Hook callers must never throw.
  }
}
