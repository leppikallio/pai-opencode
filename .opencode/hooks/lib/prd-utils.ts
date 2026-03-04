import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import YAML from "yaml";

import { paiPath } from "./paths";

export type PathAction = "write" | "delete";

export type WorkJsonPhase =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "BUILD"
  | "EXECUTE"
  | "VERIFY"
  | "LEARN"
  | "COMPLETE";

export interface WorkCriterion {
  id: string;
  description: string;
  type: "criterion" | "anti";
  status: "pending" | "complete";
}

export interface ParsedPrdData {
  targetKey: string;
  task?: string;
  slug?: string;
  id?: string;
  effort?: string;
  phase?: string;
  progress?: string;
  mode?: string;
  started?: string;
  updated?: string;
  status?: string;
  verificationSummary?: string;
  criteria: WorkCriterion[];
}

export interface WorkSessionEntry {
  sessionUUID: string;
  targetKey: string;
  source: "prd" | "placeholder";
  prdPath?: string;
  task?: string;
  slug?: string;
  id?: string;
  effort?: string;
  phase?: string;
  progress?: string;
  mode?: string;
  started?: string;
  updated?: string;
  status?: string;
  verificationSummary?: string;
  criteria: WorkCriterion[];
  updatedAt: string;
}

export interface WorkJsonState {
  v: "0.1";
  updatedAt: string;
  sessions: Record<string, WorkSessionEntry>;
}

type ApplyPatchPathEvent = {
  action: PathAction;
  filePath: string;
};

type WorkLockRecord = {
  created_at: string;
  token: string;
};

type WorkLockHandle = {
  lockDir: string;
  token: string;
};

type MutateWorkStateResult<T> =
  | { applied: true; value: T }
  | { applied: false; reason: "lock-timeout" | "corrupt-dual-failure" };

const PRD_EVENT_FILENAME_RE = /^PRD-.*\.md$/i;
const PRD_CANONICAL_FILENAME_RE = /^PRD(?:-.*)?\.md$/i;
const PRD_DASH_FILENAME_RE = /^PRD-.*\.md$/i;
const IDENTITY_SLUG_V2_RE = /^\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{6,}$/;
const APPLY_PATCH_FILE_HEADER_RE = /^\*\*\*\s+(Add File|Update File|Delete File):\s+(.+)\s*$/;
const APPLY_PATCH_MOVE_TO_RE = /^\*\*\*\s+Move to:\s+(.+)\s*$/;
const PHASE_SET = new Set<WorkJsonPhase>([
  "OBSERVE",
  "THINK",
  "PLAN",
  "BUILD",
  "EXECUTE",
  "VERIFY",
  "LEARN",
  "COMPLETE",
]);
const PLACEHOLDER_STRING_SET = new Set(["", "placeholder", "unknown", "tbd", "todo"]);
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

const WORK_LOCK_DIR_NAME = "work.json.lock";
const WORK_LOCK_INFO_FILE = "lock.json";
const WORK_LOCK_RETRY_BASE_MS = 12;

function readPositiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

const WORK_LOCK_STALE_TTL_MS = readPositiveIntFromEnv("PAI_PRDSYNC_WORK_LOCK_STALE_TTL_MS", 60_000);
const WORK_LOCK_MAX_WAIT_MS = readPositiveIntFromEnv("PAI_PRDSYNC_WORK_LOCK_MAX_WAIT_MS", 10_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeTargetKey(value: string | undefined, sessionUUID: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }

  return `session-${sessionUUID}`;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const startsWithDouble = trimmed.startsWith("\"") && trimmed.endsWith("\"");
  const startsWithSingle = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (!startsWithDouble && !startsWithSingle) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function normalizePatchPath(value: string): string {
  const unquoted = stripOptionalQuotes(value);
  if (!unquoted) {
    return "";
  }

  return unquoted.replace(/\\/g, "/");
}

function expandHome(value: string): string {
  return value
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/^\$\{HOME\}(?=\/|$)/, homedir());
}

function normalizeForPosixRuntime(value: string): string {
  return value.replace(/\\/g, path.sep);
}

function isAbsolutePath(raw: string): boolean {
  if (path.isAbsolute(raw)) {
    return true;
  }

  return /^[A-Za-z]:[\\/]/.test(raw);
}

function normalizePhase(value: string | undefined): WorkJsonPhase | null {
  if (!value) {
    return null;
  }

  const upper = value.trim().toUpperCase();
  return PHASE_SET.has(upper as WorkJsonPhase) ? (upper as WorkJsonPhase) : null;
}

function normalizeLegacyEffort(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }

  if (lower === "low") return "standard";
  if (lower === "medium") return "extended";
  if (lower === "high") return "advanced";
  if (lower === "std") return "standard";

  return lower;
}

function normalizeLegacyStatus(value: string | undefined): WorkJsonPhase | null {
  if (!value) {
    return null;
  }

  const lower = value.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  const map: Record<string, WorkJsonPhase> = {
    observe: "OBSERVE",
    thinking: "THINK",
    think: "THINK",
    plan: "PLAN",
    planning: "PLAN",
    build: "BUILD",
    execute: "EXECUTE",
    executing: "EXECUTE",
    verify: "VERIFY",
    verifying: "VERIFY",
    learn: "LEARN",
    learning: "LEARN",
    complete: "COMPLETE",
    completed: "COMPLETE",
    done: "COMPLETE",
  };

  return map[lower] ?? null;
}

function isPlaceholderValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return PLACEHOLDER_STRING_SET.has(value.trim().toLowerCase());
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function chooseMergedValue<T>(
  existing: T | undefined,
  incoming: T | undefined,
  preferIncoming: boolean,
): T | undefined {
  if (incoming === undefined) {
    return existing;
  }

  if (preferIncoming || isPlaceholderValue(existing)) {
    return incoming;
  }

  return existing;
}

function insideRoot(rootPath: string, candidatePath: string): boolean {
  const rel = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function nowIso(): string {
  return new Date().toISOString();
}

function createWorkState(): WorkJsonState {
  return {
    v: "0.1",
    updatedAt: nowIso(),
    sessions: {},
  };
}

function sanitizeCriteria(value: unknown): WorkCriterion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: WorkCriterion[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const id = asString(item.id);
    const description = asString(item.description);
    const statusRaw = asString(item.status);
    const typeRaw = asString(item.type);
    if (!id || !description) {
      continue;
    }

    const type = typeRaw === "anti" ? "anti" : "criterion";
    const status = statusRaw === "complete" ? "complete" : "pending";
    out.push({ id, description, type, status });
  }

  return out;
}

function sanitizeEntry(value: unknown): WorkSessionEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const sessionUUID = asString(value.sessionUUID);
  const targetKey = asString(value.targetKey);
  if (!sessionUUID || !targetKey) {
    return null;
  }

  return {
    sessionUUID,
    targetKey,
    source: value.source === "placeholder" ? "placeholder" : "prd",
    prdPath: asString(value.prdPath),
    task: asString(value.task),
    slug: asString(value.slug),
    id: asString(value.id),
    effort: asString(value.effort),
    phase: asString(value.phase),
    progress: asString(value.progress),
    mode: asString(value.mode),
    started: asString(value.started),
    updated: asString(value.updated),
    status: asString(value.status),
    verificationSummary: asString(value.verificationSummary),
    criteria: sanitizeCriteria(value.criteria),
    updatedAt: asString(value.updatedAt) ?? nowIso(),
  };
}

function parseWorkState(raw: string): WorkJsonState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const sessionsRecord = isRecord(parsed.sessions) ? parsed.sessions : {};
  const sessions: Record<string, WorkSessionEntry> = {};
  for (const [key, value] of Object.entries(sessionsRecord)) {
    const entry = sanitizeEntry(value);
    if (!entry) {
      continue;
    }

    sessions[key] = entry;
  }

  return {
    v: "0.1",
    updatedAt: asString(parsed.updatedAt) ?? nowIso(),
    sessions,
  };
}

function workStatePaths() {
  const stateDir = paiPath("MEMORY", "STATE");
  return {
    stateDir,
    workPath: paiPath("MEMORY", "STATE", "work.json"),
    backupPath: paiPath("MEMORY", "STATE", "work.json.bak"),
    lockDir: path.join(stateDir, WORK_LOCK_DIR_NAME),
  };
}

function workLockInfoPath(lockDir: string): string {
  return path.join(lockDir, WORK_LOCK_INFO_FILE);
}

function createWorkLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lockRetryDelay(attempt: number): number {
  const base = Math.min(120, WORK_LOCK_RETRY_BASE_MS * (attempt + 1));
  return base + Math.floor(Math.random() * 7);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseWorkLockRecord(raw: string): WorkLockRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const createdAt = asString(parsed.created_at);
    const token = asString(parsed.token);
    if (!createdAt || !token) {
      return null;
    }

    return { created_at: createdAt, token };
  } catch {
    return null;
  }
}

async function readWorkLockRecord(lockDir: string): Promise<WorkLockRecord | null> {
  try {
    const raw = await fs.promises.readFile(workLockInfoPath(lockDir), "utf8");
    return parseWorkLockRecord(raw);
  } catch {
    return null;
  }
}

async function getLockAgeMs(lockDir: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(lockDir);
    if (!Number.isFinite(stat.mtimeMs)) {
      return null;
    }

    return Math.max(0, Date.now() - stat.mtimeMs);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

function isLockRecordStale(record: WorkLockRecord): boolean {
  const createdAtMs = Date.parse(record.created_at);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs > WORK_LOCK_STALE_TTL_MS;
}

async function breakStaleWorkLockIfNeeded(lockDir: string, contenderToken: string): Promise<boolean> {
  const lockRecord = await readWorkLockRecord(lockDir);
  let stale = false;

  if (lockRecord) {
    stale = isLockRecordStale(lockRecord);
  } else {
    const ageMs = await getLockAgeMs(lockDir);
    stale = ageMs !== null && ageMs > WORK_LOCK_STALE_TTL_MS;
  }

  if (!stale) {
    return false;
  }

  const quarantinePath = `${lockDir}.quarantine.${Date.now()}.${contenderToken}`;
  try {
    await fs.promises.rename(lockDir, quarantinePath);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return false;
    }

    throw error;
  }

  await fs.promises.rm(quarantinePath, { recursive: true, force: true });
  process.stderr.write("PAI_PRDSYNC_WORK_JSON_LOCK_BROKEN_STALE\n");
  return true;
}

async function acquireWorkLock(stateDir: string): Promise<WorkLockHandle | null> {
  await fs.promises.mkdir(stateDir, { recursive: true });

  const lockDir = path.join(stateDir, WORK_LOCK_DIR_NAME);
  const token = createWorkLockToken();
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    try {
      await fs.promises.mkdir(lockDir);
      const lockRecord: WorkLockRecord = {
        created_at: nowIso(),
        token,
      };
      await fs.promises.writeFile(workLockInfoPath(lockDir), `${JSON.stringify(lockRecord)}\n`, "utf8");
      return { lockDir, token };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") {
        throw error;
      }

      const staleBroken = await breakStaleWorkLockIfNeeded(lockDir, token);
      if (staleBroken) {
        attempt = 0;
        continue;
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= WORK_LOCK_MAX_WAIT_MS) {
        process.stderr.write("PAI_PRDSYNC_WORK_JSON_LOCK_TIMEOUT\n");
        return null;
      }

      await sleep(lockRetryDelay(attempt));
      attempt += 1;
    }
  }
}

async function releaseWorkLock(lockHandle: WorkLockHandle): Promise<void> {
  const current = await readWorkLockRecord(lockHandle.lockDir);
  if (!current || current.token !== lockHandle.token) {
    return;
  }

  try {
    await fs.promises.rm(lockHandle.lockDir, { recursive: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

async function loadWorkStateWithRecovery(args: {
  workPath: string;
  backupPath: string;
}): Promise<WorkJsonState | null> {
  let workRaw: string | null = null;
  let backupRaw: string | null = null;

  try {
    workRaw = await fs.promises.readFile(args.workPath, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  if (workRaw === null) {
    return createWorkState();
  }

  const parsedWork = parseWorkState(workRaw);
  if (parsedWork) {
    return parsedWork;
  }

  try {
    backupRaw = await fs.promises.readFile(args.backupPath, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  if (backupRaw !== null) {
    const parsedBackup = parseWorkState(backupRaw);
    if (parsedBackup) {
      return parsedBackup;
    }
  }

  process.stderr.write("PAI_PRDSYNC_WORK_JSON_CORRUPT_DUAL_FAILURE\n");
  return null;
}

async function writeWorkStateAtomic(args: {
  workPath: string;
  backupPath: string;
  state: WorkJsonState;
}): Promise<void> {
  await fs.promises.mkdir(path.dirname(args.workPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(args.workPath),
    `.work.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.promises.writeFile(tempPath, `${JSON.stringify(args.state, null, 2)}\n`, "utf8");
  try {
    await fs.promises.rename(tempPath, args.workPath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // best effort cleanup
    }

    throw error;
  }

  await fs.promises.copyFile(args.workPath, args.backupPath);
}

async function mutateWorkStateUnderLock<T>(
  mutator: (state: WorkJsonState) => T,
): Promise<MutateWorkStateResult<T>> {
  const paths = workStatePaths();
  const lockHandle = await acquireWorkLock(paths.stateDir);
  if (!lockHandle) {
    return { applied: false, reason: "lock-timeout" };
  }

  try {
    const state = await loadWorkStateWithRecovery({
      workPath: paths.workPath,
      backupPath: paths.backupPath,
    });

    if (!state) {
      return { applied: false, reason: "corrupt-dual-failure" };
    }

    const value = mutator(state);
    state.v = "0.1";
    state.updatedAt = nowIso();

    await writeWorkStateAtomic({
      workPath: paths.workPath,
      backupPath: paths.backupPath,
      state,
    });

    return { applied: true, value };
  } finally {
    await releaseWorkLock(lockHandle);
  }
}

function mergeWorkEntry(args: {
  existing: WorkSessionEntry | undefined;
  incoming: Partial<WorkSessionEntry>;
  targetKey: string;
  sessionUUID: string;
  source: "prd" | "placeholder";
}): WorkSessionEntry {
  const preferIncoming = args.source === "prd";
  const base = args.existing;

  return {
    sessionUUID: args.sessionUUID,
    targetKey: args.targetKey,
    source: args.source,
    prdPath: chooseMergedValue(base?.prdPath, args.incoming.prdPath, preferIncoming),
    task: chooseMergedValue(base?.task, args.incoming.task, preferIncoming),
    slug: chooseMergedValue(base?.slug, args.incoming.slug, preferIncoming),
    id: chooseMergedValue(base?.id, args.incoming.id, preferIncoming),
    effort: chooseMergedValue(base?.effort, args.incoming.effort, preferIncoming),
    phase: chooseMergedValue(base?.phase, args.incoming.phase, preferIncoming),
    progress: chooseMergedValue(base?.progress, args.incoming.progress, preferIncoming),
    mode: chooseMergedValue(base?.mode, args.incoming.mode, preferIncoming),
    started: chooseMergedValue(base?.started, args.incoming.started, preferIncoming),
    updated: chooseMergedValue(base?.updated, args.incoming.updated, preferIncoming),
    status: chooseMergedValue(base?.status, args.incoming.status, preferIncoming),
    verificationSummary: chooseMergedValue(
      base?.verificationSummary,
      args.incoming.verificationSummary,
      preferIncoming,
    ),
    criteria: chooseMergedValue(base?.criteria, args.incoming.criteria, preferIncoming) ?? [],
    updatedAt: nowIso(),
  };
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareExistingSessionEntries(
  a: [string, WorkSessionEntry],
  b: [string, WorkSessionEntry],
): number {
  const aIsPrd = a[1].source === "prd";
  const bIsPrd = b[1].source === "prd";
  if (aIsPrd !== bIsPrd) {
    return aIsPrd ? -1 : 1;
  }

  const aHasPrdPath = Boolean(asString(a[1].prdPath));
  const bHasPrdPath = Boolean(asString(b[1].prdPath));
  if (aHasPrdPath !== bHasPrdPath) {
    return aHasPrdPath ? -1 : 1;
  }

  const aUpdatedMs = parseIsoMs(a[1].updatedAt);
  const bUpdatedMs = parseIsoMs(b[1].updatedAt);
  const aHasUpdated = aUpdatedMs !== null;
  const bHasUpdated = bUpdatedMs !== null;
  if (aHasUpdated !== bHasUpdated) {
    return aHasUpdated ? -1 : 1;
  }

  if (aUpdatedMs !== null && bUpdatedMs !== null && aUpdatedMs !== bUpdatedMs) {
    return bUpdatedMs - aUpdatedMs;
  }

  return a[0].localeCompare(b[0]);
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match?.[1]) {
    return {};
  }

  try {
    const parsed = YAML.parse(match[1]) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractCriteriaSection(content: string): string {
  const sectionStartMatch = content.match(/^##\s+Criteria\s*$/m);
  if (!sectionStartMatch || sectionStartMatch.index === undefined) {
    return "";
  }

  const sectionStart = sectionStartMatch.index + sectionStartMatch[0].length;
  const afterSection = content.slice(sectionStart);
  const nextSectionMatch = afterSection.match(/^##\s+[^\n]+$/m);
  if (!nextSectionMatch || nextSectionMatch.index === undefined) {
    return afterSection;
  }

  return afterSection.slice(0, nextSectionMatch.index);
}

function parseCriteria(content: string): WorkCriterion[] {
  const criteriaSection = extractCriteriaSection(content);
  if (!criteriaSection) {
    return [];
  }

  const lines = criteriaSection.split(/\r?\n/);
  const out: WorkCriterion[] = [];
  const lineRe = /^\s*-\s*\[( |x|X)\]\s*(ISC(?:-A)?-\d+)\s*:\s*(.+?)\s*$/;

  for (const line of lines) {
    const match = line.match(lineRe);
    if (!match) {
      continue;
    }

    const id = match[2]?.trim();
    const description = match[3]?.trim();
    if (!id || !description) {
      continue;
    }

    out.push({
      id,
      description,
      type: id.includes("-A-") ? "anti" : "criterion",
      status: match[1]?.toLowerCase() === "x" ? "complete" : "pending",
    });
  }

  return out;
}

function asTextValue(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

type CanonicalPrdCandidate = {
  prdPath: string;
  hasV2IdentitySlug: boolean;
  isDashedPrdFile: boolean;
  updatedMs: number | null;
  mtimeMs: number;
};

function compareCanonicalPrdCandidates(a: CanonicalPrdCandidate, b: CanonicalPrdCandidate): number {
  if (a.hasV2IdentitySlug !== b.hasV2IdentitySlug) {
    return a.hasV2IdentitySlug ? -1 : 1;
  }

  if (a.isDashedPrdFile !== b.isDashedPrdFile) {
    return a.isDashedPrdFile ? -1 : 1;
  }

  const aHasUpdated = a.updatedMs !== null;
  const bHasUpdated = b.updatedMs !== null;
  if (aHasUpdated !== bHasUpdated) {
    return aHasUpdated ? -1 : 1;
  }

  if (a.updatedMs !== null && b.updatedMs !== null && a.updatedMs !== b.updatedMs) {
    return b.updatedMs - a.updatedMs;
  }

  if (a.mtimeMs !== b.mtimeMs) {
    return b.mtimeMs - a.mtimeMs;
  }

  return a.prdPath.localeCompare(b.prdPath);
}

async function parseCanonicalPrdCandidate(prdPath: string): Promise<CanonicalPrdCandidate> {
  const resolvedPrdPath = path.resolve(prdPath);
  let content = "";
  let mtimeMs = 0;

  try {
    content = await fs.promises.readFile(resolvedPrdPath, "utf8");
  } catch {
    content = "";
  }

  try {
    const stat = await fs.promises.stat(resolvedPrdPath);
    if (Number.isFinite(stat.mtimeMs)) {
      mtimeMs = stat.mtimeMs;
    }
  } catch {
    mtimeMs = 0;
  }

  const frontmatter = parseFrontmatter(content);
  const slug = asTextValue(frontmatter, "slug") ?? "";
  const updatedMs = parseIsoMs(asTextValue(frontmatter, "updated"));
  const basename = path.basename(resolvedPrdPath);

  return {
    prdPath: resolvedPrdPath,
    hasV2IdentitySlug: IDENTITY_SLUG_V2_RE.test(slug),
    isDashedPrdFile: PRD_DASH_FILENAME_RE.test(basename),
    updatedMs,
    mtimeMs,
  };
}

export function parsePrdContent(content: string): ParsedPrdData | null {
  const frontmatter = parseFrontmatter(content);
  const slug = asTextValue(frontmatter, "slug");
  const id = asTextValue(frontmatter, "id");
  const targetKey = slug ?? id;

  if (!targetKey) {
    return null;
  }

  const phase =
    asTextValue(frontmatter, "phase") ??
    normalizeLegacyStatus(asTextValue(frontmatter, "status")) ??
    undefined;

  const effort =
    asTextValue(frontmatter, "effort") ?? normalizeLegacyEffort(asTextValue(frontmatter, "effort_level"));

  return {
    targetKey,
    task: asTextValue(frontmatter, "task"),
    slug,
    id,
    effort,
    phase,
    progress: asTextValue(frontmatter, "progress"),
    mode: asTextValue(frontmatter, "mode"),
    started: asTextValue(frontmatter, "started"),
    updated: asTextValue(frontmatter, "updated"),
    status: asTextValue(frontmatter, "status"),
    verificationSummary: asTextValue(frontmatter, "verification_summary"),
    criteria: parseCriteria(content),
  };
}

export async function parsePrdFile(prdPath: string): Promise<ParsedPrdData | null> {
  let content = "";
  try {
    content = await fs.promises.readFile(prdPath, "utf8");
  } catch {
    return null;
  }

  return parsePrdContent(content);
}

export function extractApplyPatchPaths(patchText: string): ApplyPatchPathEvent[] {
  const out: ApplyPatchPathEvent[] = [];
  const lines = patchText.split(/\r?\n/);

  let pendingUpdatePath: string | null = null;
  let pendingUpdateMoved = false;

  const flushPendingUpdate = () => {
    if (pendingUpdatePath && !pendingUpdateMoved) {
      out.push({ action: "write", filePath: pendingUpdatePath });
    }

    pendingUpdatePath = null;
    pendingUpdateMoved = false;
  };

  for (const line of lines) {
    const fileHeaderMatch = line.match(APPLY_PATCH_FILE_HEADER_RE);
    if (fileHeaderMatch) {
      flushPendingUpdate();

      const op = fileHeaderMatch[1];
      const candidatePath = normalizePatchPath(fileHeaderMatch[2] ?? "");
      if (!candidatePath) {
        continue;
      }

      if (op === "Update File") {
        pendingUpdatePath = candidatePath;
        continue;
      }

      if (op === "Delete File") {
        out.push({ action: "delete", filePath: candidatePath });
      } else {
        out.push({ action: "write", filePath: candidatePath });
      }

      continue;
    }

    const moveToMatch = line.match(APPLY_PATCH_MOVE_TO_RE);
    if (moveToMatch && pendingUpdatePath) {
      const moveDestination = normalizePatchPath(moveToMatch[1] ?? "");
      out.push({ action: "delete", filePath: pendingUpdatePath });
      if (moveDestination) {
        out.push({ action: "write", filePath: moveDestination });
      }
      pendingUpdateMoved = true;
    }
  }

  flushPendingUpdate();
  return out;
}

export function resolveApplyPatchPaths(args: {
  paiDir: string;
  cwd?: string;
  filePathRaw: string;
}): string[] {
  const raw = args.filePathRaw.trim();
  if (!raw) {
    return [];
  }

  const expanded = expandHome(raw);
  const normalized = normalizeForPosixRuntime(expanded);

  if (isAbsolutePath(expanded)) {
    if (/^[A-Za-z]:[\\/]/.test(expanded)) {
      return [path.win32.resolve(expanded).replace(/\\/g, "/")];
    }

    return [path.resolve(normalized)];
  }

  const candidates: string[] = [];
  if (args.cwd) {
    candidates.push(path.resolve(path.join(args.cwd, normalized)));
  }
  candidates.push(path.resolve(path.join(args.paiDir, normalized)));

  return Array.from(new Set(candidates));
}

export function isPrdPathUnderMemoryWork(paiDir: string, candidatePath: string): boolean {
  const memoryWorkRoot = path.resolve(path.join(paiDir, "MEMORY", "WORK"));
  const resolvedPath = path.resolve(candidatePath);
  return insideRoot(memoryWorkRoot, resolvedPath) && PRD_EVENT_FILENAME_RE.test(path.basename(resolvedPath));
}

export function deriveSessionUUIDFromPrdPath(paiDir: string, candidatePath: string): string | null {
  const memoryWorkRoot = path.resolve(path.join(paiDir, "MEMORY", "WORK"));
  const resolvedPath = path.resolve(candidatePath);
  if (!insideRoot(memoryWorkRoot, resolvedPath)) {
    return null;
  }

  const relativePath = path.relative(memoryWorkRoot, resolvedPath);
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const sessionUUID = parts[1] ?? "";
  return SESSION_ID_RE.test(sessionUUID) ? sessionUUID : null;
}

export function deriveSessionDirFromPrdPath(paiDir: string, candidatePath: string): string | null {
  const memoryWorkRoot = path.resolve(path.join(paiDir, "MEMORY", "WORK"));
  const resolvedPath = path.resolve(candidatePath);
  if (!insideRoot(memoryWorkRoot, resolvedPath)) {
    return null;
  }

  const relativePath = path.relative(memoryWorkRoot, resolvedPath);
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return path.join(memoryWorkRoot, parts[0] ?? "", parts[1] ?? "");
}

export async function scanCanonicalPrdInSessionDir(sessionDir: string): Promise<string | null> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(sessionDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const fileCandidates = entries
    .filter((entry) => entry.isFile() && PRD_CANONICAL_FILENAME_RE.test(entry.name))
    .map((entry) => path.join(sessionDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
  if (fileCandidates.length === 0) {
    return null;
  }

  const rankedCandidates = await Promise.all(
    fileCandidates.map((candidatePath) => parseCanonicalPrdCandidate(candidatePath)),
  );
  rankedCandidates.sort(compareCanonicalPrdCandidates);
  return rankedCandidates[0]?.prdPath ?? null;
}

export async function upsertWorkSessionFromEvent(args: {
  sessionUUID: string;
  targetKey: string;
  entry: Partial<WorkSessionEntry>;
  source?: "prd" | "placeholder";
}): Promise<{
  applied: boolean;
  phaseChanged: boolean;
  phase: WorkJsonPhase | null;
  reason?: "invalid-session-uuid" | "lock-timeout" | "corrupt-dual-failure";
}> {
  if (!SESSION_ID_RE.test(args.sessionUUID)) {
    return {
      applied: false,
      phaseChanged: false,
      phase: null,
      reason: "invalid-session-uuid",
    };
  }

  const source = args.source ?? "prd";
  const targetKey = sanitizeTargetKey(args.targetKey, args.sessionUUID);

  const mutation = await mutateWorkStateUnderLock((state) => {
    const existingEntries = Object.entries(state.sessions).filter(
      ([, entry]) => entry.sessionUUID === args.sessionUUID,
    );

    const existing = existingEntries.sort(compareExistingSessionEntries)[0]?.[1];
    const previousPhase = normalizePhase(existing?.phase);

    for (const [key] of existingEntries) {
      delete state.sessions[key];
    }

    const mergedEntry = mergeWorkEntry({
      existing,
      incoming: args.entry,
      targetKey,
      sessionUUID: args.sessionUUID,
      source,
    });

    state.sessions[targetKey] = mergedEntry;
    const nextPhase = normalizePhase(mergedEntry.phase);

    return {
      phaseChanged: previousPhase !== nextPhase,
      phase: nextPhase,
    };
  });

  if (!mutation.applied) {
    return {
      applied: false,
      phaseChanged: false,
      phase: null,
      reason: mutation.reason,
    };
  }

  return {
    applied: true,
    phaseChanged: mutation.value.phaseChanged,
    phase: mutation.value.phase,
  };
}

export async function removeWorkSessionEntries(sessionUUID: string): Promise<boolean> {
  if (!SESSION_ID_RE.test(sessionUUID)) {
    return false;
  }

  const mutation = await mutateWorkStateUnderLock((state) => {
    let changed = false;
    for (const [key, entry] of Object.entries(state.sessions)) {
      if (entry.sessionUUID === sessionUUID) {
        delete state.sessions[key];
        changed = true;
      }
    }

    return changed;
  });

  return mutation.applied && mutation.value;
}

export function buildWorkEntryFromParsedPrd(args: {
  sessionUUID: string;
  prdPath: string;
  parsedPrd: ParsedPrdData;
}): { targetKey: string; entry: Partial<WorkSessionEntry>; phase: WorkJsonPhase | null } {
  const normalizedPhase =
    normalizePhase(args.parsedPrd.phase) ?? normalizeLegacyStatus(args.parsedPrd.status) ?? null;

  return {
    targetKey: sanitizeTargetKey(args.parsedPrd.targetKey, args.sessionUUID),
    phase: normalizedPhase,
    entry: {
      source: "prd",
      prdPath: path.resolve(args.prdPath),
      task: args.parsedPrd.task,
      slug: args.parsedPrd.slug,
      id: args.parsedPrd.id,
      effort: args.parsedPrd.effort,
      phase: normalizedPhase ?? args.parsedPrd.phase,
      progress: args.parsedPrd.progress,
      mode: args.parsedPrd.mode,
      started: args.parsedPrd.started,
      updated: args.parsedPrd.updated,
      status: args.parsedPrd.status,
      verificationSummary: args.parsedPrd.verificationSummary,
      criteria: args.parsedPrd.criteria,
    },
  };
}
