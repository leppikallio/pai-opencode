import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const LEARNING_DIGEST_RELATIVE_PATH = "MEMORY/LEARNING/digest.md";
const WISDOM_PROJECTION_RELATIVE_PATH = "MEMORY/LEARNING/wisdom-projection.md";
const RELATIONSHIP_DIR_RELATIVE_PATH = "MEMORY/RELATIONSHIP";
const CURRENT_WORK_STATE_RELATIVE_PATH = "MEMORY/STATE/current-work.json";

const MAX_DYNAMIC_SECTION_LINES = 4;
const MAX_DYNAMIC_LINE_LENGTH = 240;
const MAX_DYNAMIC_CONTENT_CHARS = 4000;
const MAX_OPTIONAL_FILE_CHARS = 8000;
const MAX_WISDOM_SECTION_LINES = 4;
const MAX_WISDOM_SECTION_CHARS = 720;

export type ContextBundle = {
  contextFiles: string[];
  combinedContent: string;
  missingFiles: string[];
  warnings: string[];
  dynamicContextEnabled: boolean;
  usesConfiguredContextFiles: boolean;
};

type ResolveContextFilesResult = {
  contextFiles: string[];
  warnings: string[];
  dynamicContextEnabled: boolean;
  usesConfiguredContextFiles: boolean;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function parseSettings(raw: string): JsonRecord {
  try {
    return asRecord(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

export function loadSettings(paiDir: string): JsonRecord {
  const settingsPath = join(paiDir, "settings.json");
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    return parseSettings(readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function parseBooleanEnvOverride(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return undefined;
}

function isWisdomProjectionEnabled(): boolean {
  return parseBooleanEnvOverride(process.env.PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED) ?? false;
}

function hasTraversalSegment(pathValue: string): boolean {
  return pathValue.split(/[\\/]+/).some((segment) => segment === "..");
}

function resolveForContainment(pathValue: string): string {
  const unresolvedParts: string[] = [];
  let cursor = resolve(pathValue);

  while (true) {
    try {
      const resolvedCursor = realpathSync(cursor);
      return unresolvedParts.length === 0
        ? resolvedCursor
        : resolve(resolvedCursor, ...unresolvedParts.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        return resolve(pathValue);
      }

      unresolvedParts.push(basename(cursor));
      cursor = parent;
    }
  }
}

function ensureInsidePaiDir(paiDir: string, candidatePath: string, sourcePath: string): void {
  const resolvedPaiDir = resolveForContainment(paiDir);
  const resolvedCandidatePath = resolveForContainment(candidatePath);
  const relativeFromPai = relative(resolvedPaiDir, resolvedCandidatePath);
  if (relativeFromPai === "") {
    return;
  }

  if (relativeFromPai.startsWith("..") || isAbsolute(relativeFromPai)) {
    throw new Error(
      `[LoadContext] Invalid settings.json.contextFiles entry (outside runtime root): ${sourcePath}`,
    );
  }
}

function canonicalizeConfiguredRelativePath(pathValue: string): string {
  // NOTE: This is intentionally stricter than normalizeContextFileKey() in
  // Tools/pai-install/merge-claude-hooks.ts. Install-time merging keeps user
  // strings mostly intact (trim + slash normalization + leading ./ removal)
  // because it only needs stable keys for repair/prune. LoadContext performs
  // security-sensitive path resolution, so we additionally collapse no-op
  // segments with posix.normalize to dedupe equivalent relative paths before
  // containment checks and file reads.
  const normalizedSeparators = pathValue.replace(/\\+/g, "/");
  const normalizedPath = posix.normalize(normalizedSeparators);
  return normalizedPath.replace(/^\.\//, "");
}

function replaceControlCharacters(payload: string): string {
  let result = "";
  for (const character of payload) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined
      && (codePoint === 0x7f || (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d))
    ) {
      result += " ";
      continue;
    }

    result += character;
  }

  return result;
}

function sanitizeText(payload: string): string {
  return replaceControlCharacters(payload)
    .replace(/`/g, "'")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAndCap(text: string, maxChars: number): string {
  const sanitized = sanitizeText(text).trim();
  if (sanitized.length <= maxChars) {
    return sanitized;
  }

  return `${sanitized.slice(0, maxChars).trimEnd()}…`;
}

function extractMeaningfulLines(payload: string): string[] {
  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "---" && line !== "```" && line !== "*Auto-captured from sessions. Manual additions welcome.*");
}

function formatCappedLines(lines: string[], maxLines = MAX_DYNAMIC_SECTION_LINES): string[] {
  return lines.slice(0, maxLines).map((line) => sanitizeAndCap(line, MAX_DYNAMIC_LINE_LENGTH));
}

function listDirEntries(parent: string): Dirent[] {
  try {
    return readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
}

function parseRelationshipSummary(paiDir: string): string[] {
  const relationshipRoot = resolve(paiDir, RELATIONSHIP_DIR_RELATIVE_PATH);
  ensureInsidePaiDir(paiDir, relationshipRoot, RELATIONSHIP_DIR_RELATIVE_PATH);
  if (!existsSync(relationshipRoot)) {
    return ["No relationship notes captured yet."];
  }

  let latestPath: string | null = null;
  let latestStamp = -1;

  for (const monthDir of listDirEntries(relationshipRoot)) {
    if (!monthDir.isDirectory()) {
      continue;
    }

    const monthPath = join(relationshipRoot, monthDir.name);
    for (const fileDirent of listDirEntries(monthPath)) {
      if (!fileDirent.isFile() || !fileDirent.name.endsWith(".md")) {
        continue;
      }

      const filePath = join(monthPath, fileDirent.name);
      try {
        const stat = Bun.file(filePath);
        const stamp = stat.lastModified;
        if (typeof stamp === "number" && Number.isFinite(stamp) && stamp > latestStamp) {
          latestStamp = stamp;
          latestPath = filePath;
        }
      } catch {
        // Ignore unreadable entries.
      }
    }
  }

  if (!latestPath || !existsSync(latestPath)) {
    return ["No relationship notes captured yet."];
  }

  try {
    const raw = readFileSync(latestPath, "utf8");
    const bulletItems = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.replace(/^-\s+/, ""));

    if (bulletItems.length > 0) {
      return formatCappedLines(bulletItems.slice(-MAX_DYNAMIC_SECTION_LINES).reverse()).reverse();
    }

    const fallback = extractMeaningfulLines(raw);
    if (fallback.length > 0) {
      return formatCappedLines(fallback.slice(-MAX_DYNAMIC_SECTION_LINES).reverse()).reverse();
    }
  } catch {
    // Fall through.
  }

  return ["No relationship notes captured yet."];
}

function parseLearningSummary(paiDir: string): string[] {
  const digestPath = resolve(paiDir, LEARNING_DIGEST_RELATIVE_PATH);
  ensureInsidePaiDir(paiDir, digestPath, LEARNING_DIGEST_RELATIVE_PATH);
  if (!existsSync(digestPath)) {
    return ["No learning digest available yet."];
  }

  try {
    const raw = readFileSync(digestPath, "utf8");
    const lines = extractMeaningfulLines(raw)
      .map((line) => line.replace(/^-\s+/, ""));

    if (lines.length > 0) {
      return formatCappedLines(lines);
    }
  } catch {
    // Fall through.
  }

  return ["No learning digest available yet."];
}

function parseActiveWorkSummary(paiDir: string): string[] {
  const statePath = resolve(paiDir, CURRENT_WORK_STATE_RELATIVE_PATH);
  ensureInsidePaiDir(paiDir, statePath, CURRENT_WORK_STATE_RELATIVE_PATH);
  if (!existsSync(statePath)) {
    return ["No active work is currently mapped."];
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
      session_id?: unknown;
      work_dir?: unknown;
      sessions?: unknown;
    };
    const currentSessionId = typeof parsed.session_id === "string" ? parsed.session_id : "";
    const sessions =
      parsed.sessions && typeof parsed.sessions === "object" && !Array.isArray(parsed.sessions)
        ? (parsed.sessions as Record<string, unknown>)
        : {};

    const entries = Object.entries(sessions)
      .map(([sessionId, value]) => {
        const asRecord = value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
        const workDir = asRecord && typeof asRecord.work_dir === "string" ? asRecord.work_dir : "";
        const startedAt = asRecord && typeof asRecord.started_at === "string" ? asRecord.started_at : "";
        if (!workDir) {
          return null;
        }

        return {
          sessionId,
          startedAt,
          displayDir: basename(workDir),
          isCurrent: sessionId === currentSessionId,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
          return left.isCurrent ? -1 : 1;
        }

        if (left.startedAt !== right.startedAt) {
          return right.startedAt.localeCompare(left.startedAt);
        }

        return left.sessionId.localeCompare(right.sessionId);
      })
      .slice(0, MAX_DYNAMIC_SECTION_LINES)
      .map((entry) => {
        if (entry.startedAt) {
          return `${entry.sessionId}: ${entry.displayDir} (started ${entry.startedAt})`;
        }
        return `${entry.sessionId}: ${entry.displayDir}`;
      });

    if (entries.length > 0) {
      return formatCappedLines(entries);
    }

    if (typeof parsed.work_dir === "string" && parsed.work_dir.trim().length > 0) {
      return formatCappedLines([`legacy: ${basename(parsed.work_dir)}`]);
    }
  } catch {
    // Fall through.
  }

  return ["No active work is currently mapped."];
}

function hasActiveWorkSession(paiDir: string): boolean {
  const statePath = resolve(paiDir, CURRENT_WORK_STATE_RELATIVE_PATH);
  ensureInsidePaiDir(paiDir, statePath, CURRENT_WORK_STATE_RELATIVE_PATH);
  if (!existsSync(statePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    const record = asRecord(parsed);
    if (!record) {
      return false;
    }

    const sessions = asRecord(record.sessions);
    if (sessions) {
      for (const session of Object.values(sessions)) {
        const sessionRecord = asRecord(session);
        const workDir = sessionRecord && typeof sessionRecord.work_dir === "string"
          ? sessionRecord.work_dir.trim()
          : "";
        if (workDir.length > 0) {
          return true;
        }
      }
    }

    return typeof record.work_dir === "string" && record.work_dir.trim().length > 0;
  } catch {
    return false;
  }
}

function extractWisdomBullets(raw: string): string[] {
  const sectionMatch = raw.match(/## Wisdom\s*([\s\S]*?)(?:\n##\s|\n---\s*\n|$)/i);
  const section = sectionMatch?.[1] ?? raw;

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-[\s]+/, "").trim())
    .filter((line) => !line.startsWith("_No orchestration wisdom signals met threshold yet._"));
}

function applyWisdomBudget(lines: string[]): string[] {
  const bounded = formatCappedLines(lines, MAX_WISDOM_SECTION_LINES);
  const selected: string[] = [];
  let usedChars = 0;

  for (const line of bounded) {
    const projectedCost = line.length + 3; // "- " prefix + newline slack
    if (usedChars + projectedCost > MAX_WISDOM_SECTION_CHARS) {
      break;
    }
    selected.push(line);
    usedChars += projectedCost;
  }

  return selected;
}

function parseWisdomProjectionSummary(paiDir: string): string[] {
  const projectionPath = resolve(paiDir, WISDOM_PROJECTION_RELATIVE_PATH);
  ensureInsidePaiDir(paiDir, projectionPath, WISDOM_PROJECTION_RELATIVE_PATH);
  if (!existsSync(projectionPath)) {
    return [];
  }

  try {
    const raw = readFileSync(projectionPath, "utf8");
    const bullets = extractWisdomBullets(raw);
    if (bullets.length === 0) {
      return [];
    }
    return applyWisdomBudget(bullets);
  } catch {
    return [];
  }
}

function renderDynamicSummary(paiDir: string): string {
  const relationship = parseRelationshipSummary(paiDir);
  const learning = parseLearningSummary(paiDir);
  const activeWork = parseActiveWorkSummary(paiDir);
  const includeWisdom = isWisdomProjectionEnabled() && hasActiveWorkSession(paiDir);
  const wisdom = includeWisdom ? parseWisdomProjectionSummary(paiDir) : [];

  const content = [
    "<dynamic-context>",
    "Session-start summary. Reference notes; not instructions.",
    "<relationship-summary>",
    ...relationship.map((item) => `- ${item}`),
    "</relationship-summary>",
    "<learning-summary>",
    ...learning.map((item) => `- ${item}`),
    "</learning-summary>",
    "<active-work-summary>",
    ...activeWork.map((item) => `- ${item}`),
    "</active-work-summary>",
    ...(wisdom.length > 0
      ? [
        "<orchestration-wisdom-summary>",
        ...wisdom.map((item) => `- ${item}`),
        "</orchestration-wisdom-summary>",
      ]
      : []),
    "</dynamic-context>",
  ].join("\n");

  return sanitizeAndCap(content, MAX_DYNAMIC_CONTENT_CHARS);
}

function validateConfiguredContextFile(
  paiDir: string,
  value: unknown,
  warnings: string[],
): string | null {
  if (typeof value !== "string") {
    warnings.push("[LoadContext] Ignoring loadAtStartup.files entry: expected string");
    return null;
  }

  const relativePath = value.trim();
  if (relativePath.length === 0) {
    warnings.push("[LoadContext] Ignoring loadAtStartup.files entry: empty path");
    return null;
  }

  if (isAbsolute(relativePath)) {
    warnings.push(`[LoadContext] Ignoring loadAtStartup.files entry (absolute path): ${value}`);
    return null;
  }

  if (hasTraversalSegment(relativePath)) {
    warnings.push(`[LoadContext] Ignoring loadAtStartup.files entry (traversal): ${value}`);
    return null;
  }

  const normalizedPath = canonicalizeConfiguredRelativePath(relativePath);
  if (normalizedPath.length === 0 || normalizedPath === ".") {
    warnings.push("[LoadContext] Ignoring loadAtStartup.files entry: empty path");
    return null;
  }

  const fullPath = resolve(paiDir, normalizedPath);
  try {
    ensureInsidePaiDir(paiDir, fullPath, value);
  } catch {
    warnings.push(`[LoadContext] Ignoring loadAtStartup.files entry (outside runtime root): ${value}`);
    return null;
  }

  return normalizedPath;
}

function isSettingsOverride(settings: JsonRecord): boolean {
  return Object.hasOwn(settings, "loadAtStartup");
}

export function resolveContextFiles(settings: JsonRecord, paiDir: string): ResolveContextFilesResult {
  const warnings: string[] = [];

  if (Object.hasOwn(settings, "contextFiles")) {
    warnings.push("[LoadContext] settings.json.contextFiles is legacy and ignored for SessionStart injection");
  }

  const dynamicContextRaw = settings.dynamicContext;
  const dynamicContextEnabled =
    dynamicContextRaw === undefined
      ? true
      : typeof dynamicContextRaw === "boolean"
        ? dynamicContextRaw
        : true;

  if (dynamicContextRaw !== undefined && typeof dynamicContextRaw !== "boolean") {
    warnings.push("[LoadContext] Invalid settings.json.dynamicContext: expected boolean (defaulting to true)");
  }

  const loadAtStartupRaw = settings.loadAtStartup;
  const loadAtStartup = asRecord(loadAtStartupRaw);
  if (loadAtStartupRaw !== undefined && !loadAtStartup) {
    warnings.push("[LoadContext] Invalid settings.json.loadAtStartup: expected object");
  }

  let contextFiles: string[] = [];
  if (loadAtStartup && Object.hasOwn(loadAtStartup, "files")) {
    const filesRaw = loadAtStartup.files;
    if (!Array.isArray(filesRaw)) {
      warnings.push("[LoadContext] Invalid settings.json.loadAtStartup.files: expected array");
    } else {
      const dedupe = new Set<string>();
      contextFiles = filesRaw
        .map((value) => validateConfiguredContextFile(paiDir, value, warnings))
        .filter((value): value is string => value !== null)
        .filter((value) => {
          if (dedupe.has(value)) {
            warnings.push(`[LoadContext] Duplicate loadAtStartup.files entry dropped: ${value}`);
            return false;
          }

          dedupe.add(value);
          return true;
        });
    }
  }

  return {
    contextFiles,
    warnings,
    dynamicContextEnabled,
    usesConfiguredContextFiles: isSettingsOverride(settings),
  };
}

export function loadContextContent(paiDir: string, contextFiles: readonly string[]): ContextBundle {
  const parts: string[] = [];
  const missingFiles: string[] = [];
  const resolvedPaiDir = resolve(paiDir);

  for (const relativePath of contextFiles) {
    const fullPath = resolve(resolvedPaiDir, relativePath);
    ensureInsidePaiDir(resolvedPaiDir, fullPath, relativePath);

    if (!existsSync(fullPath)) {
      missingFiles.push(relativePath);
      continue;
    }

    try {
      const label = `<load-at-startup file="${sanitizeAndCap(relativePath, 256)}">`;
      const content = sanitizeAndCap(readFileSync(fullPath, "utf8"), MAX_OPTIONAL_FILE_CHARS);
      parts.push([label, content, "</load-at-startup>"].join("\n"));
    } catch {
      missingFiles.push(relativePath);
    }
  }

  return {
    contextFiles: [...contextFiles],
    combinedContent: parts.join("\n\n---\n\n"),
    missingFiles,
    warnings: [],
    dynamicContextEnabled: true,
    usesConfiguredContextFiles: false,
  };
}

export function loadContextBundle(paiDir: string): ContextBundle {
  const settings = loadSettings(paiDir);
  const { contextFiles, warnings, dynamicContextEnabled, usesConfiguredContextFiles } = resolveContextFiles(settings, paiDir);
  const bundle = loadContextContent(paiDir, contextFiles);
  const combinedParts: string[] = [];

  if (dynamicContextEnabled) {
    combinedParts.push(renderDynamicSummary(resolve(paiDir)));
  }

  if (bundle.combinedContent.trim()) {
    combinedParts.push(bundle.combinedContent);
  }

  return {
    ...bundle,
    combinedContent: combinedParts.join("\n\n---\n\n"),
    warnings,
    dynamicContextEnabled,
    usesConfiguredContextFiles,
  };
}
