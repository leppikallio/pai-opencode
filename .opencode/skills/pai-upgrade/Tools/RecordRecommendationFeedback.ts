#!/usr/bin/env bun

import { parseArgs } from "node:util";
import {
  appendRecommendationFeedback,
  buildRecommendationFeedbackEntry,
  getDefaultRecommendationHistoryPath,
} from "./RankRecommendations";

function printHelp(programName = "RecordRecommendationFeedback.ts"): void {
  console.log(`
Record recommendation outcome feedback (V2)

Usage:
  bun ${programName} --decision <accepted|ignored|deferred> --helpfulness <helpful|neutral|harmful> [options]

Target selectors (at least one required):
  --recommendation-id <id>
  --source-id <id>
  --category <category>
  --tags <comma-separated-tags>

Options:
  --confidence <0..1>      Feedback confidence (default: 0.85)
  --notes <text>           Optional rationale
  --run-id <id>            Optional monitor run id
  --history-path <path>    Override ledger path
  --timestamp <iso>        Override event timestamp
  --help, -h               Show help

Examples:
  bun ${programName} --recommendation-id blog-main-news:blog:17f285b0fba4 --decision accepted --helpfulness helpful --confidence 0.9
  bun ${programName} --source-id blog-main-news --category blog --tags monitoring,verification --decision ignored --helpfulness neutral
`);
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 16);
}

function parseConfidence(raw: string | undefined): number {
  if (!raw) return 0.85;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0.85;
  return Math.max(0, Math.min(1, parsed));
}

function main(): void {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "recommendation-id": { type: "string" },
      "source-id": { type: "string" },
      category: { type: "string" },
      tags: { type: "string" },
      decision: { type: "string" },
      helpfulness: { type: "string" },
      confidence: { type: "string" },
      notes: { type: "string" },
      "run-id": { type: "string" },
      "history-path": { type: "string" },
      timestamp: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const recommendation_id = parsed.values["recommendation-id"]?.trim();
  const source_id = parsed.values["source-id"]?.trim();
  const category = parsed.values.category?.trim();
  const tags = parseTags(parsed.values.tags);
  const decisionRaw = parsed.values.decision?.trim();
  const helpfulnessRaw = parsed.values.helpfulness?.trim();

  const hasTarget = Boolean(recommendation_id || source_id || category || tags.length > 0);
  if (!hasTarget) {
    console.error("❌ Feedback requires at least one selector: recommendation-id, source-id, category, or tags");
    printHelp();
    process.exit(1);
  }

  if (!decisionRaw || !["accepted", "ignored", "deferred"].includes(decisionRaw)) {
    console.error("❌ --decision must be accepted|ignored|deferred");
    process.exit(1);
  }

  if (!helpfulnessRaw || !["helpful", "neutral", "harmful"].includes(helpfulnessRaw)) {
    console.error("❌ --helpfulness must be helpful|neutral|harmful");
    process.exit(1);
  }

  const decision = decisionRaw as "accepted" | "ignored" | "deferred";
  const helpfulness = helpfulnessRaw as "helpful" | "neutral" | "harmful";

  const feedback = buildRecommendationFeedbackEntry({
    recommendation_id,
    source_id,
    category,
    tags,
    decision,
    helpfulness,
    confidence: parseConfidence(parsed.values.confidence),
    notes: parsed.values.notes,
    run_id: parsed.values["run-id"],
    timestamp: parsed.values.timestamp,
  });

  const historyPath = parsed.values["history-path"] || getDefaultRecommendationHistoryPath();
  appendRecommendationFeedback(feedback, historyPath);

  process.stdout.write(`${JSON.stringify({ ok: true, historyPath, feedback }, null, 2)}\n`);
}

if (import.meta.main) {
  main();
}
