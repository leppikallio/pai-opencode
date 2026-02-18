#!/usr/bin/env bun
// @ts-nocheck

import * as fs from "node:fs";
import * as path from "node:path";
import { buildLearningContext, type LearningContext, type PatternCount } from "./BuildLearningContext";

const RECOMMENDATION_HISTORY_SCHEMA_LEGACY = "pai-upgrade.recommendation-history.v1";
export const RECOMMENDATION_HISTORY_SCHEMA = "pai-upgrade.recommendation-history.v2";

export type RecommendationPriority = "critical" | "high" | "medium" | "low";
export type RecommendationFeedbackDecision = "accepted" | "ignored" | "deferred";
export type RecommendationFeedbackHelpfulness = "helpful" | "neutral" | "harmful";

export interface RecommendationCandidate {
  id: string;
  title: string;
  summary?: string;
  priority?: RecommendationPriority;
  score?: number;
  tags?: string[];
  category?: string;
  source_id?: string;
  source_name?: string;
  update_type?: string;
}

export interface RankedRecommendation extends RecommendationCandidate {
  base_priority: RecommendationPriority;
  adjusted_priority: RecommendationPriority;
  base_score: number;
  adjusted_score: number;
  score_delta: number;
  matched_patterns: string[];
  reasons: string[];
  feedback_delta: number;
  feedback_matches: number;
}

export interface RecommendationHistorySeedRecord {
  schema: typeof RECOMMENDATION_HISTORY_SCHEMA | typeof RECOMMENDATION_HISTORY_SCHEMA_LEGACY;
  type: "seed";
  timestamp: string;
  note: string;
}

export interface RecommendationHistoryEntry {
  schema: typeof RECOMMENDATION_HISTORY_SCHEMA | typeof RECOMMENDATION_HISTORY_SCHEMA_LEGACY;
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
  candidate_category?: string;
  candidate_tags?: string[];
  candidate_source_id?: string;
  candidate_source_name?: string;
  candidate_update_type?: string;
  learning_snapshot: {
    trend_direction: LearningContext["trend"]["direction"];
    average_rating: number;
    top_failure_patterns: string[];
  };
}

export interface RecommendationFeedbackEntry {
  schema: typeof RECOMMENDATION_HISTORY_SCHEMA;
  type: "feedback";
  timestamp: string;
  recommendation_id?: string;
  source_id?: string;
  category?: string;
  tags?: string[];
  decision: RecommendationFeedbackDecision;
  helpfulness: RecommendationFeedbackHelpfulness;
  confidence: number;
  notes?: string;
  run_id?: string;
}

export type RecommendationHistoryRecord =
  | RecommendationHistorySeedRecord
  | RecommendationHistoryEntry
  | RecommendationFeedbackEntry;

export interface RankRecommendationsOptions {
  historyPath?: string;
  persistHistory?: boolean;
  timestamp?: string;
  applyFeedback?: boolean;
}

export interface BuildRecommendationFeedbackInput {
  recommendation_id?: string;
  source_id?: string;
  category?: string;
  tags?: string[];
  decision: RecommendationFeedbackDecision;
  helpfulness: RecommendationFeedbackHelpfulness;
  confidence?: number;
  notes?: string;
  run_id?: string;
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

function isSupportedHistorySchema(value: unknown): boolean {
  return value === RECOMMENDATION_HISTORY_SCHEMA || value === RECOMMENDATION_HISTORY_SCHEMA_LEGACY;
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
    .filter((entry) => isSupportedHistorySchema(entry.schema));
}

export function appendRecommendationHistory(
  entries: RecommendationHistoryRecord | RecommendationHistoryRecord[],
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
  return `${candidate.title} ${candidate.summary ?? ""} ${(candidate.tags ?? []).join(" ")} ${candidate.category ?? ""} ${candidate.source_name ?? ""}`
    .toLowerCase();
}

function collectFailurePatterns(context: LearningContext): PatternCount[] {
  const fromFailures = context.patterns.failures;
  const fromRatings = context.patterns.rating.filter((pattern) => pattern.label !== "simplicity");
  return [...fromFailures, ...fromRatings]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.8;
  return clamp(Number(value.toFixed(3)), 0.2, 1);
}

function normalizeDecision(value: string | undefined): RecommendationFeedbackDecision {
  if (value === "accepted" || value === "ignored" || value === "deferred") {
    return value;
  }
  return "deferred";
}

function normalizeHelpfulness(value: string | undefined): RecommendationFeedbackHelpfulness {
  if (value === "helpful" || value === "neutral" || value === "harmful") {
    return value;
  }
  return "neutral";
}

function readFeedbackEntries(records: RecommendationHistoryRecord[]): RecommendationFeedbackEntry[] {
  return records
    .filter((entry): entry is RecommendationFeedbackEntry => entry.type === "feedback")
    .map((entry) => ({
      ...entry,
      schema: RECOMMENDATION_HISTORY_SCHEMA,
      decision: normalizeDecision(entry.decision),
      helpfulness: normalizeHelpfulness(entry.helpfulness),
      confidence: normalizeConfidence(entry.confidence),
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
    }));
}

function feedbackOutcomeScore(entry: RecommendationFeedbackEntry): number {
  const helpfulnessScore = entry.helpfulness === "helpful" ? 1 : entry.helpfulness === "harmful" ? -1 : 0;
  const decisionScore = entry.decision === "accepted" ? 0.35 : entry.decision === "ignored" ? -0.25 : 0.05;
  return helpfulnessScore + decisionScore;
}

function recencyWeight(timestamp: string): number {
  const ts = new Date(timestamp).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return 0.65;
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 45);
}

function feedbackMatchStrength(entry: RecommendationFeedbackEntry, candidate: RecommendationCandidate): number {
  let strength = 0;
  if (entry.recommendation_id && candidate.id && entry.recommendation_id === candidate.id) {
    strength += 1;
  }
  if (entry.source_id && candidate.source_id && entry.source_id === candidate.source_id) {
    strength += 0.75;
  }
  if (entry.category && candidate.category && entry.category === candidate.category) {
    strength += 0.3;
  }

  const entryTags = new Set((entry.tags ?? []).map((tag) => String(tag).toLowerCase()));
  const candidateTags = (candidate.tags ?? []).map((tag) => String(tag).toLowerCase());
  const sharedTags = candidateTags.filter((tag) => entryTags.has(tag));
  if (sharedTags.length > 0) {
    strength += Math.min(0.35, sharedTags.length * 0.08);
  }

  return Number(strength.toFixed(3));
}

function computeFeedbackAdjustment(
  candidate: RecommendationCandidate,
  feedbackEntries: RecommendationFeedbackEntry[],
): { delta: number; matched: number; reason?: string } {
  if (feedbackEntries.length === 0) {
    return { delta: 0, matched: 0 };
  }

  let matched = 0;
  let weightedSignal = 0;
  let totalWeight = 0;

  for (const entry of feedbackEntries) {
    const matchStrength = feedbackMatchStrength(entry, candidate);
    if (matchStrength <= 0) continue;

    matched += 1;
    const confidence = normalizeConfidence(entry.confidence);
    const recency = recencyWeight(entry.timestamp);
    const weight = matchStrength * confidence * recency;
    totalWeight += weight;
    weightedSignal += feedbackOutcomeScore(entry) * weight;
  }

  if (totalWeight <= 0 || matched === 0) {
    return { delta: 0, matched: 0 };
  }

  const signal = weightedSignal / totalWeight;
  let delta = signal * 1.6;

  // Shrink feedback influence when evidence is sparse.
  if (matched < 3) {
    delta *= 0.6;
  }

  delta = clamp(delta, -2, 2);
  delta = Number(delta.toFixed(3));

  if (Math.abs(delta) < 0.05) {
    return { delta: 0, matched };
  }

  const direction = delta > 0 ? "up" : "down";
  return {
    delta,
    matched,
    reason: `Adjusted ${direction} by feedback outcomes (${matched} matched signals)`
  };
}

function scoreCandidateWithLearningContext(
  candidate: RecommendationCandidate,
  context: LearningContext,
  feedbackEntries: RecommendationFeedbackEntry[],
): Omit<RankedRecommendation, "id" | "title" | "summary" | "priority" | "score" | "tags" | "category" | "source_id" | "source_name" | "update_type"> {
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

  const feedback = computeFeedbackAdjustment(candidate, feedbackEntries);
  if (feedback.delta !== 0) {
    score_delta += feedback.delta;
    if (feedback.reason) reasons.push(feedback.reason);
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
    feedback_delta: feedback.delta,
    feedback_matches: feedback.matched,
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
    candidate_category: item.category,
    candidate_tags: item.tags ?? [],
    candidate_source_id: item.source_id,
    candidate_source_name: item.source_name,
    candidate_update_type: item.update_type,
    learning_snapshot: {
      trend_direction: context.trend.direction,
      average_rating: context.stats.average_rating,
      top_failure_patterns: context.patterns.failures.slice(0, 3).map((entry) => entry.label),
    },
  }));
}

export function buildRecommendationFeedbackEntry(input: BuildRecommendationFeedbackInput): RecommendationFeedbackEntry {
  return {
    schema: RECOMMENDATION_HISTORY_SCHEMA,
    type: "feedback",
    timestamp: input.timestamp ?? new Date().toISOString(),
    recommendation_id: input.recommendation_id,
    source_id: input.source_id,
    category: input.category,
    tags: input.tags ?? [],
    decision: normalizeDecision(input.decision),
    helpfulness: normalizeHelpfulness(input.helpfulness),
    confidence: normalizeConfidence(input.confidence),
    notes: input.notes,
    run_id: input.run_id,
  };
}

export function appendRecommendationFeedback(
  entries: RecommendationFeedbackEntry | RecommendationFeedbackEntry[],
  historyPath = getDefaultRecommendationHistoryPath(),
): void {
  appendRecommendationHistory(entries, historyPath);
}

export function rankRecommendations(
  candidates: RecommendationCandidate[],
  learningContext: LearningContext,
  options: RankRecommendationsOptions = {},
): RankedRecommendation[] {
  const historyPath = options.historyPath ?? getDefaultRecommendationHistoryPath();
  const history = readRecommendationHistory(historyPath);
  const feedbackEntries = options.applyFeedback === false ? [] : readFeedbackEntries(history);

  const ranked = candidates
    .map((candidate) => {
      const scoring = scoreCandidateWithLearningContext(candidate, learningContext, feedbackEntries);
      return {
        ...candidate,
        ...scoring,
      } satisfies RankedRecommendation;
    })
    .sort((a, b) => b.adjusted_score - a.adjusted_score);

  if (options.persistHistory) {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const historyEntries = buildRecommendationHistoryEntries(ranked, learningContext, timestamp);
    appendRecommendationHistory(historyEntries, historyPath);
  }

  return ranked;
}

if (import.meta.main) {
  const context = buildLearningContext();
  const demoCandidates: RecommendationCandidate[] = [
    {
      id: "add-validation",
      title: "Strengthen verification and test gates",
      priority: "high",
      tags: ["verification", "quality"],
      category: "docs",
      source_id: "demo-source",
    },
    {
      id: "new-experimental-flow",
      title: "Introduce experimental migration workflow",
      priority: "medium",
      tags: ["experimental", "migration"],
      category: "github",
      source_id: "demo-source",
    },
    {
      id: "perf-investigation",
      title: "Investigate slow update checks",
      priority: "medium",
      tags: ["performance", "tooling"],
      category: "changelog",
      source_id: "demo-source",
    },
  ];

  const ranked = rankRecommendations(demoCandidates, context, {
    persistHistory: false,
  });

  process.stdout.write(`${JSON.stringify(ranked, null, 2)}\n`);
}
