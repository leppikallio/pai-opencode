#!/usr/bin/env bun
// @ts-nocheck

import * as fs from "node:fs";
import * as path from "node:path";
import { buildLearningContext, type LearningContext, type PatternCount } from "./BuildLearningContext";

export const RECOMMENDATION_HISTORY_SCHEMA = "pai-upgrade.recommendation-history.v1";

export type RecommendationPriority = "critical" | "high" | "medium" | "low";

export interface RecommendationCandidate {
  id: string;
  title: string;
  summary?: string;
  priority?: RecommendationPriority;
  score?: number;
  tags?: string[];
  category?: string;
}

export interface RankedRecommendation extends RecommendationCandidate {
  base_priority: RecommendationPriority;
  adjusted_priority: RecommendationPriority;
  base_score: number;
  adjusted_score: number;
  score_delta: number;
  matched_patterns: string[];
  reasons: string[];
}

export interface RecommendationHistorySeedRecord {
  schema: typeof RECOMMENDATION_HISTORY_SCHEMA;
  type: "seed";
  timestamp: string;
  note: string;
}

export interface RecommendationHistoryEntry {
  schema: typeof RECOMMENDATION_HISTORY_SCHEMA;
  type: "ranking";
  timestamp: string;
  recommendation_id: string;
  title: string;
  base_priority: RecommendationPriority;
  adjusted_priority: RecommendationPriority;
  base_score: number;
  adjusted_score: number;
  score_delta: number;
  matched_patterns: string[];
  reasons: string[];
  learning_snapshot: {
    trend_direction: LearningContext["trend"]["direction"];
    average_rating: number;
    top_failure_patterns: string[];
  };
}

export type RecommendationHistoryRecord = RecommendationHistorySeedRecord | RecommendationHistoryEntry;

export interface RankRecommendationsOptions {
  historyPath?: string;
  persistHistory?: boolean;
  timestamp?: string;
}

const PRIORITY_SCORE: Record<RecommendationPriority, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 2,
};

const TREND_FOCUS_KEYWORDS = ["quality", "test", "verify", "reliability", "regression", "monitor", "validation"];
const LOW_RATING_KEYWORDS = ["performance", "latency", "speed", "feedback", "clarity", "simple", "tool", "error", "failure"];
const EXPERIMENTAL_KEYWORDS = ["experimental", "rewrite", "breaking", "migration"]; 

function skillRootFromModule(): string {
  return path.resolve(path.join(import.meta.dir, ".."));
}

export function getDefaultRecommendationHistoryPath(): string {
  return path.join(skillRootFromModule(), "State", "recommendation-history.jsonl");
}

export function ensureRecommendationHistoryLedger(historyPath = getDefaultRecommendationHistoryPath()): string {
  const resolved = path.resolve(historyPath);
  if (fs.existsSync(resolved)) return resolved;

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const seed: RecommendationHistorySeedRecord = {
    schema: RECOMMENDATION_HISTORY_SCHEMA,
    type: "seed",
    timestamp: "2026-01-01T00:00:00.000Z",
    note: "recommendation history ledger initialized",
  };
  fs.writeFileSync(resolved, `${JSON.stringify(seed)}\n`, "utf-8");
  return resolved;
}

export function readRecommendationHistory(historyPath = getDefaultRecommendationHistoryPath()): RecommendationHistoryRecord[] {
  if (!fs.existsSync(historyPath)) return [];

  const content = fs.readFileSync(historyPath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RecommendationHistoryRecord;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is RecommendationHistoryRecord => entry !== null)
    .filter((entry) => entry.schema === RECOMMENDATION_HISTORY_SCHEMA);
}

export function appendRecommendationHistory(
  entries: RecommendationHistoryEntry | RecommendationHistoryEntry[],
  historyPath = getDefaultRecommendationHistoryPath(),
): void {
  const resolved = ensureRecommendationHistoryLedger(historyPath);
  const payload = (Array.isArray(entries) ? entries : [entries]).map((entry) => JSON.stringify(entry)).join("\n");
  if (!payload) return;
  fs.appendFileSync(resolved, `${payload}\n`, "utf-8");
}

function normalizePriority(value?: string): RecommendationPriority {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function priorityFromScore(score: number): RecommendationPriority {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function candidateText(candidate: RecommendationCandidate): string {
  return `${candidate.title} ${candidate.summary ?? ""} ${(candidate.tags ?? []).join(" ")} ${candidate.category ?? ""}`.toLowerCase();
}

function collectFailurePatterns(context: LearningContext): PatternCount[] {
  const fromFailures = context.patterns.failures;
  const fromRatings = context.patterns.rating.filter((pattern) => pattern.label !== "simplicity");
  return [...fromFailures, ...fromRatings]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function scoreCandidateWithLearningContext(candidate: RecommendationCandidate, context: LearningContext): Omit<RankedRecommendation, "id" | "title" | "summary" | "priority" | "score" | "tags" | "category"> {
  const base_priority = normalizePriority(candidate.priority);
  const base_score = typeof candidate.score === "number" ? candidate.score : PRIORITY_SCORE[base_priority];

  const text = candidateText(candidate);
  const reasons: string[] = [];
  const matched_patterns: string[] = [];
  let score_delta = 0;

  const failurePatterns = collectFailurePatterns(context);
  for (const pattern of failurePatterns) {
    const token = pattern.label.replace(/_/g, " ");
    const parts = token.split(/\s+/).filter((part) => part.length > 3);
    const matched = parts.some((part) => text.includes(part));
    if (matched) {
      matched_patterns.push(pattern.label);
      score_delta += Math.min(2.25, 0.6 + pattern.count * 0.15);
    }
  }

  if (matched_patterns.length > 0) {
    reasons.push(`Matches recurring failure patterns: ${matched_patterns.slice(0, 3).join(", ")}`);
  }

  const hasTrendFocus = TREND_FOCUS_KEYWORDS.some((keyword) => text.includes(keyword));
  const hasLowRatingFocus = LOW_RATING_KEYWORDS.some((keyword) => text.includes(keyword));
  const isExperimental = EXPERIMENTAL_KEYWORDS.some((keyword) => text.includes(keyword));

  if (context.trend.direction === "declining" && hasTrendFocus) {
    score_delta += 1.5;
    reasons.push("Boosted because rating trend is declining and recommendation improves reliability/verification");
  }

  if (context.stats.average_rating > 0 && context.stats.average_rating < 7 && hasLowRatingFocus) {
    score_delta += 1.25;
    reasons.push("Boosted because recent average rating is below target and recommendation addresses known pain areas");
  }

  if (context.trend.direction === "improving" && isExperimental) {
    score_delta -= 0.75;
    reasons.push("Slightly de-prioritized because trend is improving and this change is higher-risk/experimental");
  }

  const adjusted_score = Number((base_score + score_delta).toFixed(3));
  const adjusted_priority = priorityFromScore(adjusted_score);

  if (reasons.length === 0) {
    reasons.push("No strong learning signal match; kept near baseline priority");
  }

  return {
    base_priority,
    adjusted_priority,
    base_score,
    adjusted_score,
    score_delta: Number(score_delta.toFixed(3)),
    matched_patterns: [...new Set(matched_patterns)].slice(0, 5),
    reasons,
  };
}

export function buildRecommendationHistoryEntries(
  ranked: RankedRecommendation[],
  context: LearningContext,
  timestamp = new Date().toISOString(),
): RecommendationHistoryEntry[] {
  return ranked.map((item) => ({
    schema: RECOMMENDATION_HISTORY_SCHEMA,
    type: "ranking",
    timestamp,
    recommendation_id: item.id,
    title: item.title,
    base_priority: item.base_priority,
    adjusted_priority: item.adjusted_priority,
    base_score: item.base_score,
    adjusted_score: item.adjusted_score,
    score_delta: item.score_delta,
    matched_patterns: item.matched_patterns,
    reasons: item.reasons,
    learning_snapshot: {
      trend_direction: context.trend.direction,
      average_rating: context.stats.average_rating,
      top_failure_patterns: context.patterns.failures.slice(0, 3).map((entry) => entry.label),
    },
  }));
}

export function rankRecommendations(
  candidates: RecommendationCandidate[],
  learningContext: LearningContext,
  options: RankRecommendationsOptions = {},
): RankedRecommendation[] {
  const ranked = candidates
    .map((candidate) => {
      const scoring = scoreCandidateWithLearningContext(candidate, learningContext);
      return {
        ...candidate,
        ...scoring,
      } satisfies RankedRecommendation;
    })
    .sort((a, b) => b.adjusted_score - a.adjusted_score);

  if (options.persistHistory) {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const historyEntries = buildRecommendationHistoryEntries(ranked, learningContext, timestamp);
    appendRecommendationHistory(historyEntries, options.historyPath ?? getDefaultRecommendationHistoryPath());
  }

  return ranked;
}

if (import.meta.main) {
  const context = buildLearningContext();
  const demoCandidates: RecommendationCandidate[] = [
    { id: "add-validation", title: "Strengthen verification and test gates", priority: "high", tags: ["verification", "quality"] },
    { id: "new-experimental-flow", title: "Introduce experimental migration workflow", priority: "medium", tags: ["experimental", "migration"] },
    { id: "perf-investigation", title: "Investigate slow update checks", priority: "medium", tags: ["performance", "tooling"] },
  ];

  const ranked = rankRecommendations(demoCandidates, context, {
    persistHistory: false,
  });

  process.stdout.write(`${JSON.stringify(ranked, null, 2)}\n`);
}
