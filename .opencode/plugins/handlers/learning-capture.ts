/**
 * Learning Capture Handler
 *
 * Equivalent to PAI v2.4 WorkCompletionLearning hook.
 * Extracts learnings from completed work sessions and bridges
 * MEMORY/WORK/ to MEMORY/LEARNING/
 *
 * @module learning-capture
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileLog, fileLogError } from "../lib/file-logger";
import {
  getLearningDir,
  getYearMonth,
  getTimestamp,
  ensureDir,
  getCurrentWorkPathForSession,
  slugify,
} from "../lib/paths";
import { isEnvFlagEnabled, isMemoryParityEnabled } from "../lib/env-flags";
import { getLearningCategory } from "../lib/learning-utils";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Learning entry structure
 */
export interface LearningEntry {
  title: string;
  content: string;
  category: string;
  source: string;
  timestamp: string;
  score?: number;
}

/**
 * Capture learning result
 */
export interface CaptureLearningResult {
  success: boolean;
  learnings: LearningEntry[];
  error?: string;
}

/**
 * Work completion summary capture result
 */
export interface CaptureWorkCompletionSummaryResult {
  success: boolean;
  written: boolean;
  filePath?: string;
  reason?: string;
  error?: string;
}

type WorkSummarySignals = {
  verifiedIscCount: number;
  criteriaSummary: string;
  antiCriteriaSummary: string;
  applyPatchCount: number;
  writeCount: number;
  editCount: number;
};

type WorkMeta = {
  title: string;
  startedAt?: string;
  completedAt?: string;
  workId?: string;
};

type IscSnapshot = {
  criteria: string[] | null;
  antiCriteria: string[] | null;
  verifiedIscCount: number;
};

/**
 * Learning categories
 */
const CATEGORIES = {
  ALGORITHM: "ALGORITHM", // Process improvements
  SYSTEM: "SYSTEM", // Technical improvements
  CODE: "CODE", // Code patterns
  RESPONSE: "RESPONSE", // Response format
  GENERAL: "GENERAL", // General learnings
} as const;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function parseMetaValue(content: string, key: string): string | null {
  const matcher = new RegExp(`^${key}:\\s*(.+)\\s*$`, "m");
  const match = content.match(matcher);
  if (!match?.[1]) return null;

  const raw = match[1].trim();
  if (!raw) return null;

  const quoted = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
  return quoted?.[1] ?? raw;
}

async function readWorkMeta(workPath: string): Promise<WorkMeta> {
  const metaPath = path.join(workPath, "META.yaml");
  let content = "";

  try {
    content = await fs.promises.readFile(metaPath, "utf8");
  } catch {
    return { title: "work-session" };
  }

  const title = parseMetaValue(content, "title")?.trim() || "work-session";
  const startedAt = parseMetaValue(content, "started_at")?.trim();
  const completedAt = parseMetaValue(content, "completed_at")?.trim();
  const workId = parseMetaValue(content, "work_id")?.trim();

  return {
    title,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(workId ? { workId } : {}),
  };
}

function normalizeSummaryList(items: string[] | null): string {
  if (items === null) return "Not specified";
  if (items.length === 0) return "(none)";
  return items.join("; ");
}

function parseIscTextList(items: unknown[], allowStatusObjects: boolean): { values: string[]; verifiedCount: number } {
  const values: string[] = [];
  let verifiedCount = 0;

  for (const item of items) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) values.push(text);
      continue;
    }

    if (!allowStatusObjects || !isRecord(item)) continue;

    const text = (getStringProp(item, "text") ?? getStringProp(item, "description") ?? "").trim();
    if (text) values.push(text);

    const status = getStringProp(item, "status")?.trim().toUpperCase() ?? "";
    if (status === "VERIFIED" || status === "DONE") verifiedCount += 1;
  }

  return { values, verifiedCount };
}

function parseIscSnapshot(iscRaw: unknown): IscSnapshot {
  if (!isRecord(iscRaw)) {
    return {
      criteria: null,
      antiCriteria: null,
      verifiedIscCount: 0,
    };
  }

  const criteriaRaw = iscRaw.criteria;
  const antiCriteriaRaw = iscRaw.antiCriteria;

  if (Array.isArray(criteriaRaw) || Array.isArray(antiCriteriaRaw)) {
    const criteriaResult = Array.isArray(criteriaRaw)
      ? parseIscTextList(criteriaRaw, true)
      : { values: [], verifiedCount: 0 };
    const antiCriteriaResult = Array.isArray(antiCriteriaRaw)
      ? parseIscTextList(antiCriteriaRaw, true)
      : { values: [] };

    return {
      criteria: Array.isArray(criteriaRaw) ? criteriaResult.values : null,
      antiCriteria: Array.isArray(antiCriteriaRaw) ? antiCriteriaResult.values : null,
      verifiedIscCount: criteriaResult.verifiedCount,
    };
  }

  const currentRaw = iscRaw.current;
  if (isRecord(currentRaw)) {
    const currentCriteriaRaw = currentRaw.criteria;
    const currentAntiCriteriaRaw = currentRaw.antiCriteria;
    if (Array.isArray(currentCriteriaRaw) || Array.isArray(currentAntiCriteriaRaw)) {
      const criteriaValues = Array.isArray(currentCriteriaRaw)
        ? parseIscTextList(currentCriteriaRaw, false).values
        : null;
      const antiCriteriaValues = Array.isArray(currentAntiCriteriaRaw)
        ? parseIscTextList(currentAntiCriteriaRaw, false).values
        : null;

      return {
        criteria: criteriaValues,
        antiCriteria: antiCriteriaValues,
        verifiedIscCount: 0,
      };
    }
  }

  return {
    criteria: null,
    antiCriteria: null,
    verifiedIscCount: 0,
  };
}

function deriveYearMonthFromIso(isoTimestamp: string | undefined): string | null {
  if (!isoTimestamp) return null;
  const parsedMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsedMs)) return null;
  const date = new Date(parsedMs);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function deriveYearMonthFromWorkPath(workPath: string): string | null {
  const normalized = path.resolve(workPath).replace(/\\/g, "/");
  const match = normalized.match(/\/MEMORY\/WORK\/([0-9]{4}-(?:0[1-9]|1[0-2]))(?:\/|$)/);
  return match?.[1] ?? null;
}

function deriveWorkYearMonth(meta: WorkMeta, workPath: string): string {
  return (
    deriveYearMonthFromIso(meta.startedAt)
    ?? deriveYearMonthFromIso(meta.completedAt)
    ?? deriveYearMonthFromWorkPath(workPath)
    ?? "1970-01"
  );
}

function firstValid(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function toDeterministicPrefix(rawPrefix: string): string {
  const normalized = rawPrefix
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "session";
}

async function readSummarySignals(workPath: string): Promise<WorkSummarySignals> {
  let verifiedIscCount = 0;
  let criteriaSummary = "Not specified";
  let antiCriteriaSummary = "Not specified";
  let applyPatchCount = 0;
  let writeCount = 0;
  let editCount = 0;

  try {
    const iscContent = await fs.promises.readFile(path.join(workPath, "ISC.json"), "utf8");
    const iscSnapshot = parseIscSnapshot(JSON.parse(iscContent));
    verifiedIscCount = iscSnapshot.verifiedIscCount;
    criteriaSummary = normalizeSummaryList(iscSnapshot.criteria);
    antiCriteriaSummary = normalizeSummaryList(iscSnapshot.antiCriteria);
  } catch {
    // best effort
  }

  try {
    const lineageContent = await fs.promises.readFile(path.join(workPath, "LINEAGE.json"), "utf8");
    const lineageRaw = JSON.parse(lineageContent);
    if (isRecord(lineageRaw)) {
      const toolsUsed = lineageRaw.tools_used;
      if (isRecord(toolsUsed)) {
        const applyPatch = toolsUsed.apply_patch;
        const write = toolsUsed.write;
        const edit = toolsUsed.edit;
        applyPatchCount = typeof applyPatch === "number" && Number.isFinite(applyPatch) ? Math.max(0, applyPatch) : 0;
        writeCount = typeof write === "number" && Number.isFinite(write) ? Math.max(0, write) : 0;
        editCount = typeof edit === "number" && Number.isFinite(edit) ? Math.max(0, edit) : 0;
      }
    }
  } catch {
    // best effort
  }

  return {
    verifiedIscCount,
    criteriaSummary,
    antiCriteriaSummary,
    applyPatchCount,
    writeCount,
    editCount,
  };
}

function isSignificantCompletion(signals: WorkSummarySignals): boolean {
  if (signals.verifiedIscCount > 0) return true;
  if (signals.applyPatchCount > 0) return true;
  if (signals.writeCount > 0) return true;
  if (signals.editCount > 0) return true;
  return false;
}

function buildWorkCompletionSummaryText(meta: WorkMeta, signals: WorkSummarySignals): string {
  return [
    `Work session title: ${meta.title}`,
    `Verified ISC criteria: ${signals.verifiedIscCount}`,
    `ISC criteria: ${signals.criteriaSummary}`,
    `ISC anti-criteria: ${signals.antiCriteriaSummary}`,
    `Lineage edit tools: apply_patch=${signals.applyPatchCount}, write=${signals.writeCount}, edit=${signals.editCount}`,
  ].join("\n");
}

function fingerprintForWorkCompletionSummary(
  sessionId: string,
  stableWorkId: string,
  stableStartedAt: string,
  stableYearMonth: string,
): string {
  return createHash("sha1")
    .update([sessionId, stableWorkId, stableStartedAt, stableYearMonth].join("|"))
    .digest("hex")
    .slice(0, 10);
}

async function findExistingCategoryDriftMatch(
  learningDir: string,
  yearMonth: string,
  fingerprint: string,
): Promise<string | null> {
  for (const category of [CATEGORIES.SYSTEM, CATEGORIES.ALGORITHM]) {
    const categoryDir = path.join(learningDir, category, yearMonth);
    try {
      const entries = await fs.promises.readdir(categoryDir);
      const match = entries.find((entry) => entry.endsWith(`_${fingerprint}.md`));
      if (match) return path.join(categoryDir, match);
    } catch {
      // best effort
    }
  }
  return null;
}

async function writeFileAtomicOnce(filePath: string, content: string): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  let handle: fs.promises.FileHandle | null = null;

  try {
    handle = await fs.promises.open(filePath, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * Detect learning category from content
 */
function detectCategory(content: string): string {
  const lower = content.toLowerCase();

  if (/algorithm|phase|isc|execute|verify|observe|think|plan|build/i.test(lower)) {
    return CATEGORIES.ALGORITHM;
  }
  // Common PAI-process learnings that don't mention "algorithm" explicitly.
  if (/negative constraint|constraints?|must not|skill-of-skills|createskill|validateskill/i.test(lower)) {
    return CATEGORIES.ALGORITHM;
  }
  if (/system|config|hook|plugin|infrastructure|architecture/i.test(lower)) {
    return CATEGORIES.SYSTEM;
  }
  if (/code|function|class|method|bug|fix|refactor/i.test(lower)) {
    return CATEGORIES.CODE;
  }
  if (/response|format|output|voice|display/i.test(lower)) {
    return CATEGORIES.RESPONSE;
  }

  return CATEGORIES.GENERAL;
}

/**
 * Extract learnings from work session
 *
 * Looks for:
 * - Patterns like "Learning:", "Learned:", "Key insight:"
 * - ISC.json for completed criteria
 * - THREAD.md for significant content
 */
function normalizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
}

function stripToolOutputNoise(markdown: string): string {
  // THREAD.md can include large tool dumps. For learning extraction, keep text
  // but remove the common wrappers that create false positives.
  let t = markdown;
  t = t.replace(/<file>[\s\S]*?<\/file>/g, "");
  t = t.replace(/<commentary>[\s\S]*?<\/commentary>/g, "");
  t = t
    .split(/\r?\n/)
    .filter((line) => !/^\s*\d{5}\|/.test(line))
    .join("\n");
  return t;
}

function sanitizeLearnPhaseChunk(chunkRaw: string): string {
  let chunk = chunkRaw.replace(/\r\n/g, "\n").trim();
  if (!chunk) return "";

  // Remove common boilerplate line from our template.
  chunk = chunk.replace(/^What I(?:’|')ll do better next time\s*\n+/i, "");
  chunk = chunk.replace(/^What I will do better next time\s*\n+/i, "");
  chunk = chunk.replace(/^What to improve next time\s*\n+/i, "");

  // Skip placeholder-only chunks.
  if (/\[What to improve next time\]/i.test(chunk) && chunk.length < 80) return "";

  return chunk.trim();
}

function extractLearnPhasesFromThread(threadMarkdown: string): string[] {
  const text = stripToolOutputNoise(threadMarkdown);

  // Capture content after LEARN phase header up to SUMMARY/voice/next phase.
  const re =
    /━━━\s+📚\s+(?:L E A R N|LEARN)\s+━━━\s+7\/7[\s\S]*?\n([\s\S]*?)(?=\n📋 SUMMARY:|\n🗣️\s|\n━━━\s+|$)/g;

  const out: string[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const chunk = sanitizeLearnPhaseChunk(String(m[1] || ""));
    if (chunk) out.push(chunk);
  }
  return out;
}

export async function captureWorkCompletionSummary(
  sessionIdRaw: string
): Promise<CaptureWorkCompletionSummaryResult> {
  try {
    if (!isMemoryParityEnabled()) {
      return { success: true, written: false, reason: "memory-parity-disabled" };
    }
    if (!isEnvFlagEnabled("PAI_ENABLE_WORK_COMPLETION_SUMMARY", false)) {
      return { success: true, written: false, reason: "work-completion-summary-disabled" };
    }

    const sessionId = normalizeSessionId(sessionIdRaw);
    if (!sessionId) {
      return { success: true, written: false, reason: "invalid-session-id" };
    }

    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (!workPath) {
      return { success: true, written: false, reason: "no-active-work-session" };
    }

    const [meta, signals] = await Promise.all([
      readWorkMeta(workPath),
      readSummarySignals(workPath),
    ]);

    if (!isSignificantCompletion(signals)) {
      return { success: true, written: false, reason: "insignificant-work" };
    }

    const summaryText = buildWorkCompletionSummaryText(meta, signals);
    const category = getLearningCategory(summaryText, meta.title);
    const yearMonth = deriveWorkYearMonth(meta, workPath);
    const stableWorkId = firstValid(meta.workId, sessionId) || sessionId;
    const stableStartedAt = firstValid(meta.startedAt, meta.completedAt, "unknown-started-at") || "unknown-started-at";
    const fingerprint = fingerprintForWorkCompletionSummary(
      sessionId,
      stableWorkId,
      stableStartedAt,
      yearMonth,
    );

    const learningDir = getLearningDir();
    const existingCategoryDriftFile = await findExistingCategoryDriftMatch(
      learningDir,
      yearMonth,
      fingerprint,
    );
    if (existingCategoryDriftFile) {
      return {
        success: true,
        written: false,
        filePath: existingCategoryDriftFile,
        reason: "already-exists",
      };
    }

    const categoryDir = path.join(learningDir, category, yearMonth);
    const prefix = toDeterministicPrefix(firstValid(meta.workId, sessionId) || sessionId);
    const filePath = path.join(categoryDir, `${prefix}_work_completion_learning_${fingerprint}.md`);

    const content = `# Work Completion Learning

**Session:** ${sessionId}
**Category:** ${category}
**Source:** WORK_COMPLETION

## What Was Done

${summaryText}

---

*Auto-captured from completed significant work*
`;

    const written = await writeFileAtomicOnce(filePath, content);
    return {
      success: true,
      written,
      filePath,
      ...(written ? {} : { reason: "already-exists" }),
    };
  } catch (error) {
    fileLogError("Failed to capture work completion summary", error);
    return {
      success: false,
      written: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function extractLearningsFromWork(sessionIdRaw: string): Promise<CaptureLearningResult> {
  try {
    if (!isEnvFlagEnabled("PAI_ENABLE_FINE_GRAIN_LEARNINGS", false)) {
      return { success: true, learnings: [] };
    }

    const sessionId = normalizeSessionId(sessionIdRaw);
    if (!sessionId) return { success: true, learnings: [] };

    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (!workPath) {
      fileLog("No active work session for learning extraction", "debug");
      return { success: true, learnings: [] };
    }

    const learnings: LearningEntry[] = [];

    // 1. Check THREAD.md for learning patterns
    const threadPath = path.join(workPath, "THREAD.md");
    try {
      const threadContent = await fs.promises.readFile(threadPath, "utf-8");

      // Prefer deterministic extraction from explicit LEARN phases.
      const learnChunks = extractLearnPhasesFromThread(threadContent);
      for (const chunk of learnChunks) {
        learnings.push({
          title: "LEARN Phase Notes",
          content: chunk,
          category: detectCategory(chunk),
          source: "THREAD.md:LEARN",
          timestamp: new Date().toISOString(),
        });
      }

      // Also scan for explicit marker patterns (lower signal, but can catch
      // ad-hoc learnings outside the LEARN phase).
      const threadLearnings = extractLearningsFromText(stripToolOutputNoise(threadContent), "THREAD.md");
      learnings.push(...threadLearnings);
    } catch {
      // THREAD.md might not exist
    }

    // 2. Check ISC.json for completed criteria
    const iscPath = path.join(workPath, "ISC.json");
    try {
      const iscContent = await fs.promises.readFile(iscPath, "utf-8");
      const isc = JSON.parse(iscContent);

      // Extract learnings from completed criteria
      if (Array.isArray(isc.criteria)) {
        const completed = isc.criteria.filter((c: unknown) => {
          const status = getStringProp(c, "status")?.toUpperCase();
          return status === "DONE" || status === "VERIFIED";
        });

        if (completed.length > 0) {
          const iscLearning: LearningEntry = {
            title: "ISC Completion Summary",
            content: `Completed ${completed.length} criteria:\n\n${completed
              .map((c: unknown) => {
                const description =
                  getStringProp(c, "text") ?? getStringProp(c, "description") ?? "(no description)";
                const status = getStringProp(c, "status") ?? "UNKNOWN";
                return `- ${description}: ${status}`;
              })
              .join("\n")}`,
            category: CATEGORIES.ALGORITHM,
            source: "ISC.json",
            timestamp: new Date().toISOString(),
          };
          learnings.push(iscLearning);
        }
      }
    } catch {
      // ISC.json might not exist or be invalid
    }

    // 3. Check scratch/ for markdown files with insights
    const scratchDir = path.join(workPath, "scratch");
    try {
      const scratchFiles = await fs.promises.readdir(scratchDir);
      for (const file of scratchFiles.filter((f) => f.endsWith(".md"))) {
        try {
          const content = await fs.promises.readFile(
            path.join(scratchDir, file),
            "utf-8"
          );
          const scratchLearnings = extractLearningsFromText(stripToolOutputNoise(content), `scratch/${file}`);
          learnings.push(...scratchLearnings);
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // scratch/ might not exist
    }

    // Persist learnings
    for (const learning of learnings) {
      await persistLearning(learning, sessionId);
    }

    fileLog(`Extracted ${learnings.length} learnings from work session`, "info");
    return { success: true, learnings };
  } catch (error) {
    fileLogError("Failed to extract learnings", error);
    return {
      success: false,
      learnings: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extract learnings from text content
 */
function extractLearningsFromText(
  content: string,
  source: string
): LearningEntry[] {
  const learnings: LearningEntry[] = [];

  // Pattern: "Learning: ..." or "Learned: ..." or "Key insight: ..."
  const patterns = [
    /(?:Learning|Learned|Key insight|Insight|Takeaway):\s*(.+?)(?:\n\n|\n(?=[A-Z#*-]))/gis,
    /## (?:Learning|Learned|Key insight|Insight|Takeaway)[^\n]*\n\n(.+?)(?:\n##|\n---|$)/gis,
  ];

  for (const pattern of patterns) {
    for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
      const learningContent = match[1].trim();
      if (learningContent.length > 20) {
        // Skip very short matches
        learnings.push({
          title: learningContent.split("\n")[0].slice(0, 80),
          content: learningContent,
          category: detectCategory(learningContent),
          source,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return learnings;
}

/**
 * Persist learning to MEMORY/LEARNING/
 */
function fingerprintForLearning(learning: LearningEntry, sessionId?: string): string {
  const norm = learning.content.replace(/\s+/g, " ").trim();
  const base = [sessionId || "", learning.category, learning.source, learning.title, norm].join("|");
  return createHash("sha1").update(base).digest("hex").slice(0, 10);
}

async function persistLearning(learning: LearningEntry, sessionId?: string): Promise<string | null> {
  try {
    const learningDir = getLearningDir();
    const yearMonth = getYearMonth();
    const timestamp = getTimestamp();

    const categoryDir = path.join(learningDir, learning.category, yearMonth);
    await ensureDir(categoryDir);

    const slug = slugify(learning.title.slice(0, 30));
    const fp = fingerprintForLearning(learning, sessionId);
    const filename = `${timestamp}_work_${slug}_${fp}.md`;
    const filepath = path.join(categoryDir, filename);

    // Best-effort de-dupe: avoid creating multiple files for the same learning.
    try {
      const existing = await fs.promises.readdir(categoryDir);
      const already = existing.find((n) => n.endsWith(`_${fp}.md`));
      if (already) return path.join(categoryDir, already);
    } catch {
      // ignore
    }

    const content = `# ${learning.title}

**Timestamp:** ${learning.timestamp}
**Session:** ${sessionId || "unknown"}
**Category:** ${learning.category}
**Source:** ${learning.source}
**Score:** ${learning.score || 50}

---

${learning.content}

---

*Auto-extracted from work session*
`;

    await fs.promises.writeFile(filepath, content);
    fileLog(`Learning persisted: ${filename}`, "debug");
    return filepath;
  } catch (error) {
    fileLogError("Failed to persist learning", error);
    return null;
  }
}

/**
 * Create manual learning entry
 */
export async function createLearning(
  title: string,
  content: string,
  category?: string
): Promise<string | null> {
  const learning: LearningEntry = {
    title,
    content,
    category: category || detectCategory(content),
    source: "manual",
    timestamp: new Date().toISOString(),
  };

  return persistLearning(learning);
}

/**
 * Get recent learnings
 */
export async function getRecentLearnings(limit = 10): Promise<LearningEntry[]> {
  try {
    const learningDir = getLearningDir();
    const yearMonth = getYearMonth();

    const learnings: LearningEntry[] = [];

    for (const category of Object.values(CATEGORIES)) {
      const categoryDir = path.join(learningDir, category, yearMonth);

      try {
        const files = await fs.promises.readdir(categoryDir);
        const mdFiles = files
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse()
          .slice(0, limit);

        for (const file of mdFiles) {
          try {
            const content = await fs.promises.readFile(
              path.join(categoryDir, file),
              "utf-8"
            );

            // Parse title
            const titleMatch = content.match(/^# (.+)/m);
            const title = titleMatch ? titleMatch[1] : file;

            learnings.push({
              title,
              content,
              category,
              source: file,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Category dir might not exist
      }
    }

    return learnings.slice(0, limit);
  } catch {
    return [];
  }
}
