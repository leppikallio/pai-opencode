#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { getPaiRuntimeInfo } from "../../../../pai-tools/PaiRuntime";

export interface AlgorithmReflectionTheme {
  theme: string;
  frequency: number;
  signal_score: number;
  signal: "LOW" | "MEDIUM" | "HIGH";
  root_cause_hypothesis: string;
  supporting_quotes: string[];
}

export interface AlgorithmReflectionAnalysis {
  schema: "pai-upgrade.algorithm-reflections.v1";
  generated_at: string;
  source_file: string;
  entries_analyzed: number;
  invalid_lines: number;
  date_range: { earliest: string; latest: string } | null;
  themes: AlgorithmReflectionTheme[];
  execution_warnings: string[];
  aspirational_insights: string[];
  note?: string;
}

type ParsedEntry = {
  timestamp: string;
  signalScore: number;
  q1: string;
  q2: string;
  q3: string;
};

const SCHEMA = "pai-upgrade.algorithm-reflections.v1" as const;
const ZERO_NOTE = "No reflections found yet — reflections accumulate after Standard+ Algorithm runs";

const THEME_ORDER = [
  "isc_quality",
  "verification",
  "planning",
  "capability_selection",
  "timing_budget",
  "documentation",
  "tooling",
  "other",
] as const;

const Q1_WARNING_ORDER = [
  "read_before_modify",
  "verify_earlier",
  "ask_better_questions",
  "use_capabilities_earlier",
  "simplify_approach",
  "other",
] as const;

const Q3_INSIGHT_ORDER = [
  "better_planning",
  "better_tooling",
  "better_parallelization",
  "better_memory",
  "better_verification",
  "other",
] as const;

const ROOT_CAUSE_HYPOTHESIS: Record<(typeof THEME_ORDER)[number], string> = {
  isc_quality: "Ideal State Criteria quality or decomposition is too weak to prevent recurring execution errors.",
  verification: "Verification guardrails are not strong enough to catch recurring failures before completion claims.",
  planning: "Planning depth or prerequisite analysis is insufficient for the task complexity encountered.",
  capability_selection: "Capability selection is under-specified or delayed, causing missed leverage during execution.",
  timing_budget: "Effort budgeting or phase time discipline is insufficiently enforced.",
  documentation: "Documentation or plan context is incomplete, causing repeated interpretation gaps.",
  tooling: "Existing tooling or automation is insufficient for the recurring problem pattern.",
  other: "Recurring reflection pattern exists but does not map cleanly to a predefined structural bucket.",
};

type ThemeBucket = (typeof THEME_ORDER)[number];
type Q1Bucket = (typeof Q1_WARNING_ORDER)[number];
type Q3Bucket = (typeof Q3_INSIGHT_ORDER)[number];

const Q2_THEME_RULES: Array<{ bucket: ThemeBucket; regex: RegExp }> = [
  {
    bucket: "isc_quality",
    regex:
      /\b(isc|ideal state criteria|criteria quality|decomposition|compound criteria|atomic criteria|splitting test|criteria decomposition)\b/i,
  },
  {
    bucket: "verification",
    regex: /\b(verify|verification|validate|validation|test|testing|proof|evidence|guardrail|checklist)\b/i,
  },
  {
    bucket: "planning",
    regex: /\b(plan|planning|prerequisite|premortem|strategy|scope|architectur(?:e|al))\b/i,
  },
  {
    bucket: "capability_selection",
    regex: /\b(capabilit(?:y|ies)|skill selection|tool selection|capability selection|invoke skills?|use skills?)\b/i,
  },
  {
    bucket: "timing_budget",
    regex: /\b(time|timing|budget|deadline|over[- ]?budget|phase time|slow|latency|hours?|minutes?)\b/i,
  },
  {
    bucket: "documentation",
    regex: /\b(documentation|docs?|readme|spec|write[- ]?up|plan context|notes?)\b/i,
  },
  {
    bucket: "tooling",
    regex: /\b(tool|tooling|automation|script|cli|command)\b/i,
  },
];

const Q1_WARNING_RULES: Array<{ bucket: Q1Bucket; regex: RegExp }> = [
  {
    bucket: "read_before_modify",
    regex: /\b(read|understand).*(before|prior).*(modify|edit|change)|before modifying\b/i,
  },
  {
    bucket: "verify_earlier",
    regex: /\b(verify|verification|test|validation|check).*(earlier|before completion|before claiming)\b/i,
  },
  {
    bucket: "ask_better_questions",
    regex: /\b(ask|asking).*(question|questions)|\bclarify|clarifying\b/i,
  },
  {
    bucket: "use_capabilities_earlier",
    regex: /\b(capabilit(?:y|ies)|skills?|tools?).*(earlier)|\binvoke.*(skills?|tools?)\b/i,
  },
  {
    bucket: "simplify_approach",
    regex: /\b(simplif(?:y|ied|ication)|over-?engineer(?:ing)?|too complex|minimal)\b/i,
  },
];

const Q3_INSIGHT_RULES: Array<{ bucket: Q3Bucket; regex: RegExp }> = [
  { bucket: "better_planning", regex: /\b(plan|planning|prerequisite|premortem|strategy)\b/i },
  { bucket: "better_tooling", regex: /\b(tool|tooling|automation|script|cli|command)\b/i },
  { bucket: "better_parallelization", regex: /\b(parallel(?:ization)?|concurrent|delegate|delegation|agent|batch)\b/i },
  { bucket: "better_memory", regex: /\b(memory|context|state|recall|history)\b/i },
  { bucket: "better_verification", regex: /\b(verify|verification|test|validation|evidence|check)\b/i },
];

function toString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function resolveSourceFile(filePath?: string): string {
  if (filePath?.trim()) return path.resolve(filePath.trim());
  return path.join(getPaiRuntimeInfo().memoryDir, "LEARNING", "REFLECTIONS", "algorithm-reflections.jsonl");
}

function classifyByRules<TBucket extends string>(
  text: string,
  rules: Array<{ bucket: TBucket; regex: RegExp }>,
  fallback: TBucket,
): TBucket {
  for (const rule of rules) {
    if (rule.regex.test(text)) return rule.bucket;
  }
  return fallback;
}

function scoreEntry(entry: Record<string, unknown>): number {
  let score = 0;

  const impliedSentiment = toNumber(entry.implied_sentiment);
  if (impliedSentiment !== null) {
    if (impliedSentiment <= 5) score += 2;
    else if (impliedSentiment >= 6 && impliedSentiment <= 7) score += 1;
  }

  const criteriaFailed = toNumber(entry.criteria_failed);
  if (criteriaFailed !== null && criteriaFailed > 0) score += 1;

  const withinBudget = toBoolean(entry.within_budget);
  if (withinBudget === false) score += 1;

  const reworkCount = toNumber(entry.rework_count);
  if (reworkCount !== null && reworkCount > 0) score += 1;

  return score;
}

function scoreToSignal(signalScore: number): AlgorithmReflectionTheme["signal"] {
  if (signalScore >= 5) return "HIGH";
  if (signalScore >= 3) return "MEDIUM";
  return "LOW";
}

function formatCountSummary(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([label, count]) => `${label} — seen ${count} times`);
}

function getDateRange(entries: ParsedEntry[]): { earliest: string; latest: string } | null {
  const stamped = entries
    .map((entry) => ({
      timestamp: entry.timestamp,
      ms: Date.parse(entry.timestamp),
    }))
    .filter((entry) => Number.isFinite(entry.ms));

  if (stamped.length === 0) return null;

  stamped.sort((a, b) => {
    if (a.ms !== b.ms) return a.ms - b.ms;
    return a.timestamp.localeCompare(b.timestamp);
  });

  return {
    earliest: stamped[0].timestamp,
    latest: stamped[stamped.length - 1].timestamp,
  };
}

function buildZeroResult(sourceFile: string): AlgorithmReflectionAnalysis {
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    source_file: sourceFile,
    entries_analyzed: 0,
    invalid_lines: 0,
    date_range: null,
    themes: [],
    execution_warnings: [],
    aspirational_insights: [],
    note: ZERO_NOTE,
  };
}

export function mineAlgorithmReflections(args: {
  filePath?: string;
  maxThemes?: number;
} = {}): AlgorithmReflectionAnalysis {
  const sourceFile = resolveSourceFile(args.filePath);
  if (!fs.existsSync(sourceFile)) {
    return buildZeroResult(sourceFile);
  }

  const content = fs.readFileSync(sourceFile, "utf-8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return buildZeroResult(sourceFile);
  }

  const parsedEntries: ParsedEntry[] = [];
  const warningCounts = new Map<string, number>();
  const insightCounts = new Map<string, number>();

  const themeEntries = new Map<
    ThemeBucket,
    Array<{
      signalScore: number;
      timestamp: string;
      q2: string;
    }>
  >();

  let invalidLines = 0;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalidLines += 1;
      continue;
    }

    const entry = parsed as Record<string, unknown>;
    const timestamp = toString(entry.timestamp);
    const q1 = toString(entry.reflection_q1);
    const q2 = toString(entry.reflection_q2);
    const q3 = toString(entry.reflection_q3);
    const signalScore = scoreEntry(entry);

    parsedEntries.push({
      timestamp,
      signalScore,
      q1,
      q2,
      q3,
    });

    if (q1) {
      const warningBucket = classifyByRules(q1, Q1_WARNING_RULES, "other");
      warningCounts.set(warningBucket, (warningCounts.get(warningBucket) ?? 0) + 1);
    }

    if (q2) {
      const themeBucket = classifyByRules(q2, Q2_THEME_RULES, "other");
      const bucketEntries = themeEntries.get(themeBucket) ?? [];
      bucketEntries.push({ signalScore, timestamp, q2 });
      themeEntries.set(themeBucket, bucketEntries);
    }

    if (q3) {
      const insightBucket = classifyByRules(q3, Q3_INSIGHT_RULES, "other");
      insightCounts.set(insightBucket, (insightCounts.get(insightBucket) ?? 0) + 1);
    }
  }

  const allThemes: AlgorithmReflectionTheme[] = [...themeEntries.entries()].map(([theme, rows]) => {
    const frequency = rows.length;
    const signal_score = rows.reduce((sum, row) => sum + row.signalScore, 0);
    const signal = scoreToSignal(signal_score);

    const supporting_quotes = rows
      .filter((row) => row.q2.length > 0)
      .sort((a, b) => {
        if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
        return a.timestamp.localeCompare(b.timestamp);
      })
      .slice(0, 3)
      .map((row) => row.q2);

    return {
      theme,
      frequency,
      signal_score,
      signal,
      root_cause_hypothesis: ROOT_CAUSE_HYPOTHESIS[theme],
      supporting_quotes,
    };
  });

  allThemes.sort((a, b) => {
    if (b.signal_score !== a.signal_score) return b.signal_score - a.signal_score;
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return a.theme.localeCompare(b.theme);
  });

  const maxThemes =
    typeof args.maxThemes === "number" && Number.isFinite(args.maxThemes) && args.maxThemes > 0
      ? Math.floor(args.maxThemes)
      : undefined;

  const themes = maxThemes ? allThemes.slice(0, maxThemes) : allThemes;
  const dateRange = getDateRange(parsedEntries);

  const result: AlgorithmReflectionAnalysis = {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    source_file: sourceFile,
    entries_analyzed: parsedEntries.length,
    invalid_lines: invalidLines,
    date_range: dateRange,
    themes,
    execution_warnings: formatCountSummary(warningCounts),
    aspirational_insights: formatCountSummary(insightCounts),
  };

  if (parsedEntries.length === 0 && invalidLines === 0) {
    result.note = ZERO_NOTE;
  }

  return result;
}

function main(): void {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: "string" },
      "max-themes": { type: "string" },
      pretty: { type: "boolean", default: true },
    },
  });

  const analysis = mineAlgorithmReflections({
    filePath: parsed.values.file,
    maxThemes: parsed.values["max-themes"] ? Number(parsed.values["max-themes"]) : undefined,
  });

  const json = parsed.values.pretty ? JSON.stringify(analysis, null, 2) : JSON.stringify(analysis);
  process.stdout.write(`${json}\n`);
}

if (import.meta.main) {
  main();
}
