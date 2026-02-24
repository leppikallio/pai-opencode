/**
 * Rating Capture Handler
 *
 * Equivalent to PAI v2.4 ExplicitRatingCapture hook.
 * Detects user ratings (1-10) and persists to MEMORY/LEARNING/
 *
 * @module rating-capture
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import {
  getLearningDir,
  getYearMonth,
  getTimestamp,
  ensureDir,
  slugify,
} from "../lib/paths";

/**
 * Rating entry structure
 */
export interface RatingEntry {
  // Upstream parity field
  rating: number;

  // Back-compat alias
  score?: number;

  // Upstream parity fields
  session_id?: string;
  sentiment_summary?: string;
  confidence?: number;

  comment: string;
  timestamp: string;
  source: "explicit";
  context?: string;
}

/**
 * Capture rating result
 */
export interface CaptureRatingResult {
  success: boolean;
  rating?: RatingEntry;
  learned?: boolean;
  error?: string;
}

/**
 * Rating patterns to detect
 *
 * Matches patterns like:
 * - "8" (just a number)
 * - "8/10"
 * - "8 - good work"
 * - "7: needs improvement"
 * - "9 excellent"
 * - "10!"
 */
const RATING_PATTERNS = [
  // "8" or "8!" or "10!"
  /^(\d{1,2})!*$/,
  // "8/10" or "9/10"
  /^(\d{1,2})\/10/,
  // "8 - comment" or "8: comment" or "8, comment"
  /^(\d{1,2})\s*[-:,]\s*(.+)$/,
  // "8 word word" (number followed by text)
  /^(\d{1,2})\s+(\w.*)$/,
];

const EXPLICIT_DEDUPE_WINDOW_MS = 5000;
const EXPLICIT_DEDUPE_SCAN_LIMIT = 50;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeComment(value: string | undefined): string {
  return value?.trim() ?? "";
}

function parseTimestampMs(value: unknown): number | null {
  const raw = readString(value);
  if (!raw) return null;

  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

function readExplicitComment(entry: Record<string, unknown>): string {
  return normalizeComment(readString(entry.comment) ?? readString(entry.sentiment_summary));
}

async function hasRecentExplicitDuplicate(ratingsFile: string, rating: RatingEntry): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(ratingsFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const targetComment = normalizeComment(rating.comment || rating.sentiment_summary);
    const now = Date.now();

    let scanned = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (scanned >= EXPLICIT_DEDUPE_SCAN_LIMIT) {
        break;
      }
      scanned += 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[index]);
      } catch {
        continue;
      }

      if (typeof parsed !== "object" || parsed === null) {
        continue;
      }

      const entry = parsed as Record<string, unknown>;
      if (entry.source !== "explicit") {
        continue;
      }

      if (typeof entry.rating !== "number" || entry.rating !== rating.rating) {
        continue;
      }

      if (readExplicitComment(entry) !== targetComment) {
        continue;
      }

      const timestampMs = parseTimestampMs(entry.timestamp);
      if (timestampMs === null) {
        continue;
      }

      const ageMs = now - timestampMs;
      if (ageMs >= 0 && ageMs <= EXPLICIT_DEDUPE_WINDOW_MS) {
        return true;
      }

      if (ageMs > EXPLICIT_DEDUPE_WINDOW_MS) {
        break;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Detect rating in user message
 *
 * Returns null if no rating detected
 */
export function detectRating(message: string): RatingEntry | null {
  const trimmed = message.trim();

  // Skip if message is too long (likely not a rating)
  if (trimmed.length > 200) return null;

  // Skip if message starts with common non-rating patterns
  if (/^(the|a|an|i|we|it|this|that|please|can|could|would|should|let)/i.test(trimmed)) {
    return null;
  }

  for (const pattern of RATING_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const score = parseInt(match[1], 10);

      // Valid score range: 1-10
      if (score >= 1 && score <= 10) {
        const comment = match[2]?.trim() || "";
        return {
          rating: score,
          score,
          sentiment_summary: comment,
          confidence: 1,
          comment,
          timestamp: new Date().toISOString(),
          source: "explicit",
        };
      }
    }
  }

  return null;
}

/**
 * Capture and persist rating
 *
 * Writes to:
 * - MEMORY/LEARNING/SIGNALS/ratings.jsonl (all ratings)
 * - MEMORY/LEARNING/FAILURES/{YYYY-MM}/*.md (for low ratings, learnings)
 */
export async function captureRating(
  message: string,
  context?: string
): Promise<CaptureRatingResult> {
  try {
    const rating = detectRating(message);

    if (!rating) {
      return { success: true, rating: undefined };
    }

    rating.context = context;

    // Ensure directories exist
    const learningDir = getLearningDir();
    const signalsDir = path.join(learningDir, "SIGNALS");
    await ensureDir(signalsDir);

    // Append to ratings.jsonl
    const ratingsFile = path.join(signalsDir, "ratings.jsonl");
    if (await hasRecentExplicitDuplicate(ratingsFile, rating)) {
      fileLog(`Skipping duplicate explicit rating: ${rating.rating}/10`, "info");
      return { success: true, rating, learned: false };
    }

    const line = `${JSON.stringify(rating)}\n`;
    await fs.promises.appendFile(ratingsFile, line);

    fileLog(`Rating captured: ${rating.rating}/10`, "info");

    // For low ratings (< 7), create a learning file
    let learned = false;
    if (rating.rating < 7 && rating.comment) {
      learned = await createLearningFromRating(rating);
    }

    return { success: true, rating, learned };
  } catch (error) {
    fileLogError("Failed to capture rating", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create learning file from low rating
 */
async function createLearningFromRating(rating: RatingEntry): Promise<boolean> {
  try {
    const learningDir = getLearningDir();
    const yearMonth = getYearMonth();
    const timestamp = getTimestamp();

    const failuresDir = path.join(learningDir, "FAILURES", yearMonth);
    await ensureDir(failuresDir);

    const slug = slugify(rating.comment.slice(0, 30));
    const filename = `${timestamp}_rating_${slug}.md`;
    const filepath = path.join(failuresDir, filename);

    const content = `# Learning from Rating: ${rating.rating}/10

**Timestamp:** ${rating.timestamp}
**Score:** ${rating.rating}/10
**Feedback:** ${rating.comment}
**Source:** explicit rating

---

## Context

${rating.context || "No context available"}

---

## What to Improve

Based on this feedback, consider:
- ${rating.comment}

---

*Auto-generated from explicit rating capture*
`;

    await fs.promises.writeFile(filepath, content);
    fileLog(`Learning created from low rating: ${filename}`, "info");
    return true;
  } catch (error) {
    fileLogError("Failed to create learning from rating", error);
    return false;
  }
}

/**
  * NOTE: We intentionally store all low-rating learnings under FAILURES.
  */

/**
 * Get recent ratings
 */
export async function getRecentRatings(limit = 10): Promise<RatingEntry[]> {
  try {
    const signalsDir = path.join(getLearningDir(), "SIGNALS");
    const ratingsFile = path.join(signalsDir, "ratings.jsonl");

    const content = await fs.promises.readFile(ratingsFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines
      .slice(-limit)
      .map((line) => JSON.parse(line) as RatingEntry)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Calculate average rating
 */
export async function getAverageRating(): Promise<number | null> {
  const ratings = await getRecentRatings(100);
  if (ratings.length === 0) return null;

  const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
  return sum / ratings.length;
}
