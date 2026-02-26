#!/usr/bin/env bun
import { readStdinWithTimeout } from "./lib/stdin";
import { getSessionOneWord, readTabState, setTabState } from "./lib/tab-state";
import {
  extractCarryForwardTitle,
  extractPromptTitle,
  isLowSignalPrompt,
  isTitleRelevantToPrompt,
  isValidWorkingTitle,
  summarizePromptViaInference,
} from "./lib/update-tab-title";

type JsonRecord = Record<string, unknown>;
const PURE_RATING_RE = /^(?:10|[1-9])$/;
const MIN_PROMPT_LENGTH = 3;

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.+$/, "").trim();
}

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

function renderPromptTimeVoiceReminder(message: string): string {
  return `<user-prompt-submit-hook>\n<system-reminder>\nCall tool voice_notify with: {"message": ${JSON.stringify(
    message,
  )}}\n</system-reminder>\n</user-prompt-submit-hook>\n`;
}

async function updateTabTitle(payload: JsonRecord): Promise<string | null> {
  const sessionId = readSessionId(payload);
  if (!sessionId || sessionId === "unknown-session") {
    return null;
  }

  const prompt = readPrompt(payload);
  if (!prompt || prompt.length < MIN_PROMPT_LENGTH || isPureRating(prompt)) {
    return null;
  }

  const currentSnapshot = readTabState(sessionId);
  const carryForwardTitle = currentSnapshot?.title ? extractCarryForwardTitle(currentSnapshot.title) : null;
  const lowSignalPrompt = isLowSignalPrompt(prompt);

  let thinkingTitle = extractPromptTitle(prompt);
  if ((!thinkingTitle || lowSignalPrompt) && carryForwardTitle) {
    thinkingTitle = carryForwardTitle;
  }

  if (!thinkingTitle) {
    return null;
  }

  const prefix = thinkingTitle === carryForwardTitle ? "" : titlePrefix(sessionId);

  await setTabState({
    title: `🧠 ${prefix}${thinkingTitle}`,
    state: "thinking",
    sessionId,
    phaseToken: "THINK",
  });

  let finalTitle = thinkingTitle;
  let inferredWorkingTitle: string | null = null;
  const inferredTitle = await summarizePromptViaInference(prompt);
  if (
    inferredTitle &&
    isValidWorkingTitle(inferredTitle) &&
    isTitleRelevantToPrompt(inferredTitle, prompt)
  ) {
    finalTitle = inferredTitle;
    inferredWorkingTitle = inferredTitle;
  }

  await setTabState({
    title: `⚙️ ${prefix}${finalTitle}`,
    state: "working",
    sessionId,
    phaseToken: "WORK",
  });

  // Prompt-time voice (upstream parity): when inference yields a clean working title,
  // nudge the assistant to call the voice_notify tool.
  if (inferredWorkingTitle) {
    const voiceMessage = stripTrailingPeriod(inferredWorkingTitle);
    if (voiceMessage) {
      return renderPromptTimeVoiceReminder(voiceMessage);
    }
  }

  return null;
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

    const reminder = await updateTabTitle(payload);
    if (reminder) {
      process.stdout.write(reminder);
    }
  } catch {
    // Never throw from hooks.
  } finally {
    process.exit(0);
  }
}

await main();
