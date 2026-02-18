#!/usr/bin/env bun
// @ts-nocheck

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { getPaiRuntimeInfo } from "../../../pai-tools/PaiRuntime";

export const LEARNING_CONTEXT_SCHEMA = "pai-upgrade.learning-context.v1";

export interface LearningContextPaths {
  memory_root: string;
  learning_root: string;
  ratings_file: string;
  failures_root: string;
}

export interface LearningContextOptions {
  memoryRoot?: string;
  learningRoot?: string;
  ratingsPath?: string;
  failuresRoot?: string;
  lookbackDays?: number;
  maxLearningFiles?: number;
  maxFailureFiles?: number;
  maxPatterns?: number;
}

export interface PatternCount {
  label: string;
  count: number;
}

export interface RatingSignal {
  timestamp: string;
  rating: number;
  source: "explicit" | "implicit" | "unknown";
  summary: string;
  confidence: number;
  session_id?: string;
}

export interface LearningDocumentSignal {
  path: string;
  category: string;
  title: string;
  timestamp: string;
  pattern_hits: string[];
}

export interface LearningTrend {
  direction: "improving" | "stable" | "declining" | "insufficient_data";
  baseline_average: number;
  recent_average: number;
  delta: number;
  sample_size: number;
}

export interface LearningContext {
  schema: typeof LEARNING_CONTEXT_SCHEMA;
  generated_at: string;
  lookback_days: number;
  paths: LearningContextPaths;
  stats: {
    total_ratings: number;
    explicit_ratings: number;
    implicit_ratings: number;
    average_rating: number;
    low_rating_count: number;
    high_rating_count: number;
    failure_documents: number;
    learning_documents: number;
  };
  trend: LearningTrend;
  patterns: {
    rating: PatternCount[];
    learning_docs: PatternCount[];
    failures: PatternCount[];
    recurring_terms: PatternCount[];
  };
  samples: {
    ratings: RatingSignal[];
    learning_docs: LearningDocumentSignal[];
    failures: LearningDocumentSignal[];
  };
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "were",
  "have",
  "your",
  "about",
  "into",
  "than",
  "then",
  "them",
  "they",
  "when",
  "what",
  "where",
  "while",
  "would",
  "could",
  "should",
  "there",
  "their",
  "been",
  "also",
  "very",
  "just",
  "more",
  "most",
  "some",
  "only",
  "still",
]);

const PATTERN_RULES: Array<{ label: string; regex: RegExp }> = [
  { label: "time_performance", regex: /time|slow|delay|hang|wait|latency|minutes|hours/i },
  { label: "wrong_approach", regex: /wrong|incorrect|misunderstand|mistake|not what/i },
  { label: "incomplete_work", regex: /incomplete|missing|partial|didn't finish|not done/i },
  { label: "tooling_failures", regex: /error|broken|crash|fail|exception|timeout/i },
  { label: "communication", regex: /unclear|confusing|didn't ask|assumption|clarify/i },
  { label: "simplicity", regex: /simple|clean|minimal|over-?engineer|complex/i },
  { label: "verification", regex: /test|verify|validation|proof|evidence|check/i },
];

function resolveLearningPaths(options: LearningContextOptions = {}): LearningContextPaths {
  const runtime = getPaiRuntimeInfo();
  const memory_root = path.resolve(options.memoryRoot ?? runtime.memoryDir);
  const learning_root = path.resolve(options.learningRoot ?? path.join(memory_root, "LEARNING"));
  const ratings_file = path.resolve(options.ratingsPath ?? path.join(learning_root, "SIGNALS", "ratings.jsonl"));
  const failures_root = path.resolve(options.failuresRoot ?? path.join(learning_root, "FAILURES"));
  return { memory_root, learning_root, ratings_file, failures_root };
}

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function parseRatingLine(line: string): RatingSignal | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : null;
  const rawRating = typeof parsed.rating === "number" ? parsed.rating : typeof parsed.score === "number" ? parsed.score : null;

  if (!timestamp || rawRating === null || Number.isNaN(rawRating)) {
    return null;
  }

  const rating = Math.max(1, Math.min(10, Math.round(rawRating)));
  const source = parsed.source === "implicit" ? "implicit" : parsed.source === "explicit" ? "explicit" : "unknown";
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 1;
  const summary =
    typeof parsed.sentiment_summary === "string"
      ? parsed.sentiment_summary
      : typeof parsed.comment === "string"
        ? parsed.comment
        : "";

  return {
    timestamp,
    rating,
    source,
    summary,
    confidence,
    session_id: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
  };
}

function collectPatternHits(text: string): string[] {
  return PATTERN_RULES.filter((rule) => rule.regex.test(text)).map((rule) => rule.label);
}

function extractTerms(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? [];
  return matches.filter((term) => !STOP_WORDS.has(term));
}

function countPatterns(labels: string[], maxPatterns: number): PatternCount[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxPatterns);
}

function getRecentMarkdownFiles(rootDir: string, lookbackDays: number): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const files: Array<{ path: string; mtime: number }> = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      try {
        const stat = fs.statSync(entryPath);
        if (stat.mtimeMs >= cutoff) {
          files.push({ path: entryPath, mtime: stat.mtimeMs });
        }
      } catch {
        // Skip unreadable file
      }
    }
  }

  return files.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
}

function normalizeDocSignal(filePath: string, learningRoot: string): LearningDocumentSignal {
  const content = safeReadFile(filePath);
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || path.basename(filePath);
  const categoryPath = path.relative(learningRoot, filePath).split(path.sep);
  const category = categoryPath[0] ?? "UNKNOWN";
  const timestamp = fs.existsSync(filePath) ? fs.statSync(filePath).mtime.toISOString() : new Date().toISOString();
  const pattern_hits = collectPatternHits(content);

  return {
    path: filePath,
    category,
    title,
    timestamp,
    pattern_hits,
  };
}

function computeTrend(ratings: RatingSignal[]): LearningTrend {
  if (ratings.length < 4) {
    const avg = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : 0;
    return {
      direction: "insufficient_data",
      baseline_average: avg,
      recent_average: avg,
      delta: 0,
      sample_size: ratings.length,
    };
  }

  const ordered = [...ratings].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const midpoint = Math.floor(ordered.length / 2);
  const baseline = ordered.slice(0, midpoint);
  const recent = ordered.slice(midpoint);

  const baseline_average = baseline.reduce((sum, r) => sum + r.rating, 0) / baseline.length;
  const recent_average = recent.reduce((sum, r) => sum + r.rating, 0) / recent.length;
  const delta = Number((recent_average - baseline_average).toFixed(3));

  let direction: LearningTrend["direction"] = "stable";
  if (delta >= 0.35) direction = "improving";
  if (delta <= -0.35) direction = "declining";

  return {
    direction,
    baseline_average: Number(baseline_average.toFixed(3)),
    recent_average: Number(recent_average.toFixed(3)),
    delta,
    sample_size: ratings.length,
  };
}

export function buildLearningContext(options: LearningContextOptions = {}): LearningContext {
  const lookbackDays = options.lookbackDays ?? 30;
  const maxLearningFiles = options.maxLearningFiles ?? 24;
  const maxFailureFiles = options.maxFailureFiles ?? 24;
  const maxPatterns = options.maxPatterns ?? 12;

  const paths = resolveLearningPaths(options);

  const ratingsContent = safeReadFile(paths.ratings_file);
  const allRatings = ratingsContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRatingLine)
    .filter((value): value is RatingSignal => value !== null)
    .filter((value) => new Date(value.timestamp).getTime() >= Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const allLearningFiles = getRecentMarkdownFiles(paths.learning_root, lookbackDays).filter((filePath) => {
    const rel = path.relative(paths.learning_root, filePath).split(path.sep);
    return rel[0] !== "SIGNALS" && rel[0] !== "FAILURES";
  });
  const allFailureFiles = getRecentMarkdownFiles(paths.failures_root, lookbackDays);

  const learningDocs = allLearningFiles.slice(0, maxLearningFiles).map((filePath) => normalizeDocSignal(filePath, paths.learning_root));
  const failures = allFailureFiles.slice(0, maxFailureFiles).map((filePath) => normalizeDocSignal(filePath, paths.learning_root));

  const ratingPatternLabels = allRatings.flatMap((rating) => collectPatternHits(rating.summary));
  const learningPatternLabels = learningDocs.flatMap((doc) => doc.pattern_hits);
  const failurePatternLabels = failures.flatMap((doc) => doc.pattern_hits);

  const recurringTerms = countPatterns(
    [
      ...allRatings.flatMap((rating) => extractTerms(rating.summary)),
      ...learningDocs.flatMap((doc) => extractTerms(doc.title)),
      ...failures.flatMap((doc) => extractTerms(`${doc.title} ${doc.pattern_hits.join(" ")}`)),
    ],
    maxPatterns,
  );

  const explicit_ratings = allRatings.filter((entry) => entry.source === "explicit").length;
  const implicit_ratings = allRatings.filter((entry) => entry.source === "implicit").length;
  const average_rating =
    allRatings.length > 0
      ? Number((allRatings.reduce((sum, entry) => sum + entry.rating, 0) / allRatings.length).toFixed(3))
      : 0;

  return {
    schema: LEARNING_CONTEXT_SCHEMA,
    generated_at: new Date().toISOString(),
    lookback_days: lookbackDays,
    paths,
    stats: {
      total_ratings: allRatings.length,
      explicit_ratings,
      implicit_ratings,
      average_rating,
      low_rating_count: allRatings.filter((entry) => entry.rating <= 4).length,
      high_rating_count: allRatings.filter((entry) => entry.rating >= 8).length,
      failure_documents: failures.length,
      learning_documents: learningDocs.length,
    },
    trend: computeTrend(allRatings),
    patterns: {
      rating: countPatterns(ratingPatternLabels, maxPatterns),
      learning_docs: countPatterns(learningPatternLabels, maxPatterns),
      failures: countPatterns(failurePatternLabels, maxPatterns),
      recurring_terms: recurringTerms,
    },
    samples: {
      ratings: allRatings.slice(0, 12),
      learning_docs: learningDocs.slice(0, 10),
      failures: failures.slice(0, 10),
    },
  };
}

function main(): void {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "memory-root": { type: "string" },
      "lookback-days": { type: "string" },
      "max-learning-files": { type: "string" },
      "max-failure-files": { type: "string" },
      output: { type: "string" },
      pretty: { type: "boolean", default: true },
    },
  });

  const context = buildLearningContext({
    memoryRoot: parsed.values["memory-root"],
    lookbackDays: parsed.values["lookback-days"] ? Number(parsed.values["lookback-days"]) : undefined,
    maxLearningFiles: parsed.values["max-learning-files"] ? Number(parsed.values["max-learning-files"]) : undefined,
    maxFailureFiles: parsed.values["max-failure-files"] ? Number(parsed.values["max-failure-files"]) : undefined,
  });

  const json = parsed.values.pretty ? JSON.stringify(context, null, 2) : JSON.stringify(context);
  if (parsed.values.output) {
    const outputPath = path.resolve(parsed.values.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${json}\n`, "utf-8");
    return;
  }

  process.stdout.write(`${json}\n`);
}

if (import.meta.main) {
  main();
}

export { resolveLearningPaths };
