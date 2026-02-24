#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync } from "node:fs";

import { paiPath } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";
import { getISOTimestamp } from "./lib/time";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

const ALGORITHM_REMINDER = `<user-prompt-submit-hook>
ALGORITHM FORMAT REQUIRED.
Start with: 🤖 PAI ALGORITHM (...)
End with: 🗣️ Marvin: [8-24 word spoken summary]
Use ISC criteria and evidence-backed verification.
</user-prompt-submit-hook>
`;

type HookInput = {
  session_id?: string;
  prompt?: string;
  user_prompt?: string;
  transcript_path?: string;
};

type ExplicitRating = {
  rating: number;
  comment?: string;
};

type RatingEntry = {
  timestamp: string;
  rating: number;
  session_id: string;
  source: "explicit";
  comment?: string;
};

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      session_id: asString(parsed.session_id),
      prompt: asString(parsed.prompt),
      user_prompt: asString(parsed.user_prompt),
      transcript_path: asString(parsed.transcript_path),
    };
  } catch {
    return {};
  }
}

function parseExplicitRating(prompt: string): ExplicitRating | null {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return null;
  }

  const parseCandidate = (ratingText: string, commentRaw?: string): ExplicitRating | null => {
    const rating = Number.parseInt(ratingText, 10);
    if (rating < 1 || rating > 10) {
      return null;
    }

    const comment = commentRaw?.trim() || undefined;
    if (comment) {
      const sentenceStarters = /^(items?|things?|steps?|files?|lines?|bugs?|issues?|errors?|times?|minutes?|hours?|days?|seconds?|percent|%|th\b|st\b|nd\b|rd\b|of\b|in\b|at\b|to\b|the\b|a\b|an\b)/i;
      if (sentenceStarters.test(comment)) {
        return null;
      }
    }

    return { rating, comment };
  };

  const plainOrBangMatch = trimmed.match(/^(10|[1-9])(?:!+)?$/);
  if (plainOrBangMatch) {
    return parseCandidate(plainOrBangMatch[1]);
  }

  const slashTenMatch = trimmed.match(/^(10|[1-9])\s*\/\s*10(?:\s+(.*))?$/);
  if (slashTenMatch) {
    return parseCandidate(slashTenMatch[1], slashTenMatch[2]);
  }

  const separatedCommentMatch = trimmed.match(/^(10|[1-9])\s*[-:]\s*(.+)$/);
  if (separatedCommentMatch) {
    return parseCandidate(separatedCommentMatch[1], separatedCommentMatch[2]);
  }

  const spacedCommentMatch = trimmed.match(/^(10|[1-9])\s+(.+)$/);
  if (spacedCommentMatch) {
    return parseCandidate(spacedCommentMatch[1], spacedCommentMatch[2]);
  }

  return null;
}

function implicitSentimentDisabled(): boolean {
  return process.env.PAI_DISABLE_IMPLICIT_SENTIMENT === "1" || process.env.PAI_NO_NETWORK === "1";
}

function writeExplicitRating(entry: RatingEntry): void {
  const signalsDir = paiPath("MEMORY", "LEARNING", "SIGNALS");
  const ratingsFile = paiPath("MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl");

  if (!existsSync(signalsDir)) {
    mkdirSync(signalsDir, { recursive: true });
  }

  appendFileSync(ratingsFile, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function main(): Promise<void> {
  process.stdout.write(ALGORITHM_REMINDER);

  const rawInput = await readStdinWithTimeout({ timeoutMs: 5000 });
  const payload = parseHookInput(rawInput);
  const prompt = payload.prompt ?? payload.user_prompt ?? "";

  const explicitRating = parseExplicitRating(prompt);
  if (explicitRating) {
    writeExplicitRating({
      timestamp: getISOTimestamp(),
      rating: explicitRating.rating,
      session_id: payload.session_id ?? "unknown-session",
      source: "explicit",
      ...(explicitRating.comment ? { comment: explicitRating.comment } : {}),
    });
    return;
  }

  if (implicitSentimentDisabled()) {
    return;
  }

  // Implicit sentiment inference intentionally omitted in this parity stub.
}

try {
  await main();
} catch {
  // Never throw from hooks.
} finally {
  process.exit(0);
}
