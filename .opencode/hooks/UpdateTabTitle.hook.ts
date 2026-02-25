#!/usr/bin/env bun
import { readStdinWithTimeout } from "./lib/stdin";
import { getSessionOneWord, setTabState } from "./lib/tab-state";
import {
  extractPromptTitle,
  isTitleRelevantToPrompt,
  isValidWorkingTitle,
  summarizePromptViaInference,
} from "./lib/update-tab-title";

type JsonRecord = Record<string, unknown>;
const PURE_RATING_RE = /^(?:10|[1-9])$/;
const MIN_PROMPT_LENGTH = 3;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSessionId(payload: JsonRecord): string {
  return asString(payload.session_id) ?? asString(payload.sessionId) ?? "unknown-session";
}

function readPrompt(payload: JsonRecord): string {
  return asString(payload.prompt) ?? asString(payload.user_prompt) ?? "";
}

function isPureRating(prompt: string): boolean {
  return PURE_RATING_RE.test(prompt.trim());
}

function titlePrefix(sessionId: string): string {
  const oneWord = getSessionOneWord(sessionId);
  return oneWord ? `${oneWord}: ` : "";
}

async function updateTabTitle(payload: JsonRecord): Promise<void> {
  const sessionId = readSessionId(payload);
  if (!sessionId || sessionId === "unknown-session") {
    return;
  }

  const prompt = readPrompt(payload);
  if (!prompt || prompt.length < MIN_PROMPT_LENGTH || isPureRating(prompt)) {
    return;
  }

  const thinkingTitle = extractPromptTitle(prompt);
  if (!thinkingTitle) {
    return;
  }

  const prefix = titlePrefix(sessionId);
  await setTabState({
    title: `🧠 ${prefix}${thinkingTitle}`,
    state: "thinking",
    sessionId,
  });

  let finalTitle = thinkingTitle;
  const inferredTitle = await summarizePromptViaInference(prompt);
  if (
    inferredTitle &&
    isValidWorkingTitle(inferredTitle) &&
    isTitleRelevantToPrompt(inferredTitle, prompt)
  ) {
    finalTitle = inferredTitle;
  }

  await setTabState({
    title: `⚙️ ${prefix}${finalTitle}`,
    state: "working",
    sessionId,
  });
}

async function main(): Promise<void> {
  try {
    const stdin = await readStdinWithTimeout({ timeoutMs: 1500 });
    if (!stdin.trim()) {
      return;
    }

    const payload = asRecord(JSON.parse(stdin));
    if (!payload) {
      return;
    }

    await updateTabTitle(payload);
  } catch {
    // Never throw from hooks.
  } finally {
    process.stdout.write('{"continue": true}\n');
    process.exit(0);
  }
}

await main();
