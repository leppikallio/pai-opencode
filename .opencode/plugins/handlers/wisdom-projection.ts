import * as fs from "node:fs";
import * as path from "node:path";

import { fileLogError } from "../lib/file-logger";
import { isEnvFlagEnabled, isMemoryParityEnabled } from "../lib/env-flags";
import { getLearningDir, getStateDir } from "../lib/paths";

const LEARNING_DIGEST_FILE_NAME = "digest.md";
export const WISDOM_PROJECTION_FILE_NAME = "wisdom-projection.md";

const WISDOM_MAX_SOURCE_FILES = 96;
const WISDOM_MAX_REFLECTION_RECORDS = 80;
const WISDOM_MAX_ITEMS = 4;
const WISDOM_MAX_ITEM_CHARS = 220;
const WISDOM_MAX_BYTES = 8000;

const DELEGATION_KEYWORDS = [
  "delegation",
  "delegate",
  "handoff",
  "failed",
  "stale",
  "cancelled",
  "background task",
] as const;

const COMPLETION_KEYWORDS = [
  "verified isc",
  "verification",
  "verify",
  "criteria",
  "progress",
  "completion",
  "pass",
] as const;

const COMPACTION_KEYWORDS = [
  "compaction",
  "continuation",
  "rehydrate",
  "restore",
  "recovery",
] as const;

const PARALLELISM_KEYWORDS = [
  "parallel",
  "concurrency",
  "fan-in",
  "queue",
  "worktree",
  "background",
] as const;

type UnknownRecord = Record<string, unknown>;

type LearningSignals = {
  totalEntries: number;
  workCompletionEntries: number;
  delegationMentions: number;
  completionMentions: number;
  compactionMentions: number;
  parallelMentions: number;
};

type ReflectionSignals = {
  totalEntries: number;
  delegationMentions: number;
  completionMentions: number;
  compactionMentions: number;
  parallelMentions: number;
  negativeSentimentEntries: number;
  positiveSentimentEntries: number;
};

type BackgroundTaskSignals = {
  totalTasks: number;
  terminalTasks: number;
  completedTasks: number;
  failedTasks: number;
  staleTasks: number;
  cancelledTasks: number;
  launchErrors: number;
  concurrencyGroupCount: number;
};

type CompactionSignals = {
  totalSessions: number;
  restoredSessions: number;
  restoreTotal: number;
  topHints: string[];
};

type WisdomCandidate = {
  topic:
    | "delegation-failure-patterns"
    | "reliable-completion-heuristics"
    | "compaction-recovery-guidance"
    | "parallelism-concurrency-heuristics";
  score: number;
  insight: string;
  evidence: string;
};

export interface WisdomProjectionSummary {
  generatedAt: string;
  sourceCoverage: {
    learningEntries: number;
    reflections: number;
    workCompletionLearningEntries: number;
    backgroundTaskOutcomes: number;
    compactionRecoveryOutcomes: number;
  };
  wisdom: WisdomCandidate[];
}

export interface WisdomProjectionWriteResult {
  success: boolean;
  written: boolean;
  filePath: string;
  reason?: string;
  error?: string;
  summary?: WisdomProjectionSummary;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compactWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function capText(input: string, maxChars: number): string {
  const compact = compactWhitespace(input);
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeFingerprint(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function countKeywordHits(haystackLower: string, keywords: readonly string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (haystackLower.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

async function listLearningMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (entry.name === LEARNING_DIGEST_FILE_NAME) continue;
      if (entry.name === WISDOM_PROJECTION_FILE_NAME) continue;
      out.push(full);
    }
  };

  await walk(root);
  return out.sort((a, b) => b.localeCompare(a)).slice(0, WISDOM_MAX_SOURCE_FILES);
}

function isWorkCompletionLearning(filePath: string, contentLower: string): boolean {
  return (
    filePath.includes("_work_completion_learning_")
    || contentLower.includes("**source:** work_completion")
  );
}

async function collectLearningSignals(learningDir: string): Promise<LearningSignals> {
  const files = await listLearningMarkdownFiles(learningDir);

  const signals: LearningSignals = {
    totalEntries: 0,
    workCompletionEntries: 0,
    delegationMentions: 0,
    completionMentions: 0,
    compactionMentions: 0,
    parallelMentions: 0,
  };

  for (const filePath of files) {
    let raw = "";
    try {
      raw = await fs.promises.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const lower = raw.toLowerCase();
    signals.totalEntries += 1;
    if (isWorkCompletionLearning(filePath, lower)) {
      signals.workCompletionEntries += 1;
    }
    signals.delegationMentions += countKeywordHits(lower, DELEGATION_KEYWORDS);
    signals.completionMentions += countKeywordHits(lower, COMPLETION_KEYWORDS);
    signals.compactionMentions += countKeywordHits(lower, COMPACTION_KEYWORDS);
    signals.parallelMentions += countKeywordHits(lower, PARALLELISM_KEYWORDS);
  }

  return signals;
}

async function collectReflectionSignals(learningDir: string): Promise<ReflectionSignals> {
  const reflectionsPath = path.join(learningDir, "REFLECTIONS", "algorithm-reflections.jsonl");

  const signals: ReflectionSignals = {
    totalEntries: 0,
    delegationMentions: 0,
    completionMentions: 0,
    compactionMentions: 0,
    parallelMentions: 0,
    negativeSentimentEntries: 0,
    positiveSentimentEntries: 0,
  };

  let raw = "";
  try {
    raw = await fs.promises.readFile(reflectionsPath, "utf8");
  } catch {
    return signals;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-WISDOM_MAX_REFLECTION_RECORDS);

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    const text = compactWhitespace([
      asString(parsed.task_description) ?? "",
      asString(parsed.reflection_q1) ?? "",
      asString(parsed.reflection_q2) ?? "",
      asString(parsed.reflection_q3) ?? "",
    ].join(" "));
    if (!text) continue;

    const lower = text.toLowerCase();
    signals.totalEntries += 1;
    signals.delegationMentions += countKeywordHits(lower, DELEGATION_KEYWORDS);
    signals.completionMentions += countKeywordHits(lower, COMPLETION_KEYWORDS);
    signals.compactionMentions += countKeywordHits(lower, COMPACTION_KEYWORDS);
    signals.parallelMentions += countKeywordHits(lower, PARALLELISM_KEYWORDS);

    const sentiment = asFiniteNumber(parsed.implied_sentiment);
    if (sentiment !== undefined) {
      if (sentiment <= 4) signals.negativeSentimentEntries += 1;
      if (sentiment >= 8) signals.positiveSentimentEntries += 1;
    }
  }

  return signals;
}

async function collectBackgroundTaskSignals(stateDir: string): Promise<BackgroundTaskSignals> {
  const statePath = path.join(stateDir, "background-tasks.json");

  const signals: BackgroundTaskSignals = {
    totalTasks: 0,
    terminalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    staleTasks: 0,
    cancelledTasks: 0,
    launchErrors: 0,
    concurrencyGroupCount: 0,
  };

  let raw = "";
  try {
    raw = await fs.promises.readFile(statePath, "utf8");
  } catch {
    return signals;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return signals;
  }

  if (!isRecord(parsed)) {
    return signals;
  }

  const backgroundTasks = isRecord(parsed.backgroundTasks) ? parsed.backgroundTasks : null;
  if (!backgroundTasks) {
    return signals;
  }

  const concurrencyGroups = new Set<string>();

  for (const record of Object.values(backgroundTasks)) {
    if (!isRecord(record)) continue;
    signals.totalTasks += 1;

    const status = asString(record.status)?.trim().toLowerCase() ?? "";
    const terminalReason = asString(record.terminal_reason)?.trim().toLowerCase() ?? "";
    const launchError = asString(record.launch_error)?.trim();
    const concurrencyGroup = asString(record.concurrency_group)?.trim();

    if (concurrencyGroup) {
      concurrencyGroups.add(concurrencyGroup);
    }
    if (launchError) {
      signals.launchErrors += 1;
    }

    const terminal = status === "completed"
      || status === "failed"
      || status === "cancelled"
      || status === "stale"
      || terminalReason === "completed"
      || terminalReason === "failed"
      || terminalReason === "cancelled"
      || terminalReason === "stale";
    if (terminal) {
      signals.terminalTasks += 1;
    }

    if (status === "completed" || terminalReason === "completed") {
      signals.completedTasks += 1;
    }
    if (status === "failed" || terminalReason === "failed") {
      signals.failedTasks += 1;
    }
    if (status === "stale" || terminalReason === "stale") {
      signals.staleTasks += 1;
    }
    if (status === "cancelled" || terminalReason === "cancelled") {
      signals.cancelledTasks += 1;
    }
  }

  signals.concurrencyGroupCount = concurrencyGroups.size;
  return signals;
}

async function collectCompactionSignals(stateDir: string): Promise<CompactionSignals> {
  const statePath = path.join(stateDir, "compaction-continuity.json");

  const signals: CompactionSignals = {
    totalSessions: 0,
    restoredSessions: 0,
    restoreTotal: 0,
    topHints: [],
  };

  let raw = "";
  try {
    raw = await fs.promises.readFile(statePath, "utf8");
  } catch {
    return signals;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return signals;
  }

  if (!isRecord(parsed) || !isRecord(parsed.sessions)) {
    return signals;
  }

  const hintCounts = new Map<string, number>();

  for (const entry of Object.values(parsed.sessions)) {
    if (!isRecord(entry)) continue;
    signals.totalSessions += 1;

    const restoreCount = Math.max(0, Math.floor(asFiniteNumber(entry.restoreCount) ?? 0));
    signals.restoreTotal += restoreCount;
    if (restoreCount > 0) {
      signals.restoredSessions += 1;
    }

    const derived = isRecord(entry.derived) ? entry.derived : null;
    const continuationHints = Array.isArray(derived?.continuationHints)
      ? derived.continuationHints
      : [];

    for (const rawHint of continuationHints) {
      if (typeof rawHint !== "string") continue;
      const hint = capText(rawHint, 120);
      if (!hint) continue;
      hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
    }
  }

  signals.topHints = [...hintCounts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 2)
    .map(([hint]) => hint);

  return signals;
}

function buildDelegationFailureCandidate(args: {
  learning: LearningSignals;
  reflections: ReflectionSignals;
  background: BackgroundTaskSignals;
}): WisdomCandidate | null {
  const failureCount =
    args.background.failedTasks
    + args.background.staleTasks
    + args.background.cancelledTasks
    + args.background.launchErrors;
  const mentionCount = args.learning.delegationMentions + args.reflections.delegationMentions;

  if (failureCount === 0 && mentionCount === 0) {
    return null;
  }

  const terminalBase = Math.max(1, args.background.terminalTasks);
  const failureRatio = failureCount / terminalBase;
  const score = clamp(
    42 + failureCount * 8 + mentionCount * 2 + Math.round(failureRatio * 18),
    1,
    99,
  );

  const insight = failureRatio >= 0.35
    ? "Recurring delegation failures cluster around stale/failed child tasks; cap fan-out and require explicit terminal-state reconciliation before parent completion."
    : "Delegation failures recur intermittently; keep parent fan-in checks and stale-timeout safeguards active for each delegated task lineage.";

  return {
    topic: "delegation-failure-patterns",
    score,
    insight: capText(insight, WISDOM_MAX_ITEM_CHARS),
    evidence: `failure_count=${failureCount}, terminal_tasks=${args.background.terminalTasks}, signal_mentions=${mentionCount}`,
  };
}

function buildReliableCompletionCandidate(args: {
  learning: LearningSignals;
  reflections: ReflectionSignals;
  background: BackgroundTaskSignals;
}): WisdomCandidate | null {
  const completionSignals =
    args.learning.workCompletionEntries
    + args.learning.completionMentions
    + args.reflections.completionMentions
    + args.background.completedTasks;

  if (completionSignals === 0) {
    return null;
  }

  const score = clamp(
    36
      + args.learning.workCompletionEntries * 7
      + args.background.completedTasks * 4
      + args.reflections.positiveSentimentEntries * 2
      + args.reflections.completionMentions,
    1,
    99,
  );

  const insight = "Reliable completion is strongest when ISC verification, progress reconciliation, and final status checks are completed before closing the work session.";

  return {
    topic: "reliable-completion-heuristics",
    score,
    insight: capText(insight, WISDOM_MAX_ITEM_CHARS),
    evidence: `work_completion_entries=${args.learning.workCompletionEntries}, completed_tasks=${args.background.completedTasks}, completion_mentions=${args.learning.completionMentions + args.reflections.completionMentions}`,
  };
}

function buildCompactionRecoveryCandidate(args: {
  learning: LearningSignals;
  reflections: ReflectionSignals;
  compaction: CompactionSignals;
}): WisdomCandidate | null {
  const evidenceSignals =
    args.compaction.restoreTotal
    + args.compaction.restoredSessions
    + args.learning.compactionMentions
    + args.reflections.compactionMentions;

  if (evidenceSignals === 0) {
    return null;
  }

  const score = clamp(
    38
      + args.compaction.restoreTotal * 6
      + args.compaction.restoredSessions * 8
      + args.learning.compactionMentions
      + args.reflections.compactionMentions,
    1,
    99,
  );

  const topHintSuffix = args.compaction.topHints[0]
    ? ` Primary continuation hint: ${args.compaction.topHints[0]}.`
    : "";

  const insight = `Compaction recovery stays reliable when continuation hints and next unfinished ISC pointers are snapshotted before compaction and rehydrated on parent turn.${topHintSuffix}`;

  return {
    topic: "compaction-recovery-guidance",
    score,
    insight: capText(insight, WISDOM_MAX_ITEM_CHARS),
    evidence: `restored_sessions=${args.compaction.restoredSessions}, restore_total=${args.compaction.restoreTotal}, compaction_mentions=${args.learning.compactionMentions + args.reflections.compactionMentions}`,
  };
}

function buildParallelismCandidate(args: {
  learning: LearningSignals;
  reflections: ReflectionSignals;
  background: BackgroundTaskSignals;
}): WisdomCandidate | null {
  const signalCount = args.background.totalTasks + args.learning.parallelMentions + args.reflections.parallelMentions;
  if (signalCount === 0) {
    return null;
  }

  const failurePressure =
    args.background.failedTasks + args.background.staleTasks + args.background.cancelledTasks;
  const score = clamp(
    34
      + args.background.totalTasks * 3
      + args.background.concurrencyGroupCount * 4
      + args.learning.parallelMentions
      + args.reflections.parallelMentions
      + Math.max(0, args.background.completedTasks - failurePressure),
    1,
    99,
  );

  const insight = failurePressure > args.background.completedTasks
    ? "Parallelism needs tighter bounds when stale/failure pressure rises: reduce concurrent delegations and enforce deterministic parent fan-in before starting new batches."
    : "Parallelism remains reliable when work is split into bounded concurrency groups and child sessions are terminalized before parent fan-in reconciliation.";

  return {
    topic: "parallelism-concurrency-heuristics",
    score,
    insight: capText(insight, WISDOM_MAX_ITEM_CHARS),
    evidence: `total_tasks=${args.background.totalTasks}, concurrency_groups=${args.background.concurrencyGroupCount}, completed=${args.background.completedTasks}, failure_pressure=${failurePressure}`,
  };
}

function rankAndDedupeCandidates(candidates: WisdomCandidate[]): WisdomCandidate[] {
  const deduped = new Map<string, WisdomCandidate>();

  for (const candidate of candidates) {
    const fingerprint = normalizeFingerprint(candidate.insight);
    if (!fingerprint) continue;

    const existing = deduped.get(fingerprint);
    if (!existing) {
      deduped.set(fingerprint, candidate);
      continue;
    }

    if (candidate.score > existing.score) {
      deduped.set(fingerprint, candidate);
      continue;
    }

    if (candidate.score === existing.score && candidate.topic.localeCompare(existing.topic) < 0) {
      deduped.set(fingerprint, candidate);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.topic.localeCompare(right.topic);
    })
    .slice(0, WISDOM_MAX_ITEMS);
}

function capMarkdownContent(lines: string[]): string {
  let capped = [...lines];

  while (capped.length > 0) {
    const candidate = `${capped.join("\n").trimEnd()}\n`;
    if (Buffer.byteLength(candidate, "utf8") <= WISDOM_MAX_BYTES) {
      return candidate;
    }
    capped = capped.slice(0, -1);
  }

  return "# Orchestration Wisdom Projection\n";
}

function renderProjectionMarkdown(summary: WisdomProjectionSummary): string {
  const lines: string[] = [
    "# Orchestration Wisdom Projection",
    "",
    "Derived from existing PAI memory/state artifacts only.",
    "",
    "## Policy",
    "- ranking: recurrence + reliability + risk pressure (bounded deterministic score)",
    "- dedupe: normalized insight fingerprint; keep highest-scoring duplicate",
    "- max injection budget: 4 lines / 720 chars at context load",
    "- retrieval triggers: feature flag ON + active work session + non-empty wisdom bullets",
    "",
    "## Source Coverage",
    `- learning_entries: ${summary.sourceCoverage.learningEntries}`,
    `- reflections: ${summary.sourceCoverage.reflections}`,
    `- work_completion_learning_entries: ${summary.sourceCoverage.workCompletionLearningEntries}`,
    `- background_task_outcomes: ${summary.sourceCoverage.backgroundTaskOutcomes}`,
    `- compaction_recovery_outcomes: ${summary.sourceCoverage.compactionRecoveryOutcomes}`,
    "",
    "## Wisdom",
  ];

  if (summary.wisdom.length === 0) {
    lines.push("- _No orchestration wisdom signals met threshold yet._");
  } else {
    for (const item of summary.wisdom) {
      lines.push(`- [score:${item.score}] ${item.insight} (evidence: ${item.evidence})`);
    }
  }

  lines.push(
    "",
    "---",
    "",
    `*Generated at ${summary.generatedAt} from existing MEMORY/LEARNING + MEMORY/STATE sources.*`,
  );

  return capMarkdownContent(lines);
}

async function writeFileAtomicIfChanged(filePath: string, content: string): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  let existingContent: string | null = null;
  try {
    existingContent = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  if (existingContent === content) {
    return false;
  }

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.promises.writeFile(tempPath, content, "utf8");
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (cleanupError) {
      if (!isMissingPathError(cleanupError)) {
        throw cleanupError;
      }
    }
    throw error;
  }

  return true;
}

export function getWisdomProjectionPath(): string {
  return path.join(getLearningDir(), WISDOM_PROJECTION_FILE_NAME);
}

export async function deriveWisdomProjectionSummary(): Promise<WisdomProjectionSummary> {
  const learningDir = getLearningDir();
  const stateDir = getStateDir();

  const [learning, reflections, background, compaction] = await Promise.all([
    collectLearningSignals(learningDir),
    collectReflectionSignals(learningDir),
    collectBackgroundTaskSignals(stateDir),
    collectCompactionSignals(stateDir),
  ]);

  const candidates = rankAndDedupeCandidates(
    [
      buildDelegationFailureCandidate({ learning, reflections, background }),
      buildReliableCompletionCandidate({ learning, reflections, background }),
      buildCompactionRecoveryCandidate({ learning, reflections, compaction }),
      buildParallelismCandidate({ learning, reflections, background }),
    ].filter((candidate): candidate is WisdomCandidate => candidate !== null),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      learningEntries: learning.totalEntries,
      reflections: reflections.totalEntries,
      workCompletionLearningEntries: learning.workCompletionEntries,
      backgroundTaskOutcomes: background.totalTasks,
      compactionRecoveryOutcomes: compaction.totalSessions,
    },
    wisdom: candidates,
  };
}

export async function updateWisdomProjection(): Promise<WisdomProjectionWriteResult> {
  const filePath = getWisdomProjectionPath();

  try {
    if (!isMemoryParityEnabled()) {
      return {
        success: true,
        written: false,
        filePath,
        reason: "memory-parity-disabled",
      };
    }

    if (!isEnvFlagEnabled("PAI_ORCHESTRATION_WISDOM_PROJECTION_ENABLED", false)) {
      return {
        success: true,
        written: false,
        filePath,
        reason: "wisdom-projection-disabled",
      };
    }

    const summary = await deriveWisdomProjectionSummary();
    const content = renderProjectionMarkdown(summary);
    const written = await writeFileAtomicIfChanged(filePath, content);

    return {
      success: true,
      written,
      filePath,
      ...(written ? {} : { reason: "unchanged" }),
      summary,
    };
  } catch (error) {
    fileLogError("Failed to update wisdom projection", error);
    return {
      success: false,
      written: false,
      filePath,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
