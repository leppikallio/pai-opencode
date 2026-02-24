import fs from "node:fs";
import path from "node:path";

import { getCurrentWorkPathForSession } from "../../plugins/lib/paths";
import { getConversationTextFromThread } from "../../plugins/pai-cc-hooks/shared/thread-projections";

const DEFAULT_MAX_CODE_POINTS = 2400;
const DEFAULT_TAIL_LINES = 8;

function readStdinBestEffort(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readSessionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const primary = record.session_id;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }

  const fallback = record.sessionId;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  return null;
}

function parseStdinPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function takeLastLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-Math.max(1, maxLines)).join("\n").trim();
}

function formatMarkdownEntry(excerpt: string): string {
  const fixedTimestamp = process.env.PAI_HOOK_FIXED_TIME_ISO;
  const timestamp =
    typeof fixedTimestamp === "string" &&
      fixedTimestamp.trim().length > 0 &&
      Number.isFinite(Date.parse(fixedTimestamp))
      ? fixedTimestamp
      : new Date().toISOString();
  return [`## ${timestamp}`, "", "```md", excerpt, "```", ""].join("\n");
}

export async function appendThreadExcerptEntry(args: {
  sessionId: string;
  outputFileName: string;
  maxCodePoints?: number;
  tailLines?: number;
}): Promise<void> {
  const workDir = await getCurrentWorkPathForSession(args.sessionId);
  if (!workDir) {
    return;
  }

  const excerptWindow = await getConversationTextFromThread({
    sessionId: args.sessionId,
    maxChars: args.maxCodePoints ?? DEFAULT_MAX_CODE_POINTS,
  });
  if (!excerptWindow.trim()) {
    return;
  }

  const excerpt = takeLastLines(excerptWindow, args.tailLines ?? DEFAULT_TAIL_LINES);
  if (!excerpt) {
    return;
  }

  const outputPath = path.join(workDir, args.outputFileName);
  await fs.promises.appendFile(outputPath, formatMarkdownEntry(excerpt), "utf8");
}

export async function runThreadProjectionHook(args: { outputFileName: string }): Promise<void> {
  try {
    const payload = parseStdinPayload(readStdinBestEffort());
    const sessionId = readSessionIdFromPayload(payload);
    if (sessionId) {
      await appendThreadExcerptEntry({ sessionId, outputFileName: args.outputFileName });
    }
  } catch {
    // no-op by contract
  }

  process.stdout.write('{"continue": true}\n');
}
