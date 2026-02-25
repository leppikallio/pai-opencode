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
  });

  // Prompt-time voice (upstream parity): when inference yields a clean working title,
  // nudge the assistant to call the voice_notify tool.
  if (inferredWorkingTitle) {
    const voiceMessage = stripTrailingPeriod(inferredWorkingTitle);
    if (voiceMessage) {
      const reminder = `<system-reminder>\nCall tool voice_notify with: {"message": ${JSON.stringify(
        voiceMessage,
      )}}\n</system-reminder>`;
      throw Object.assign(new Error("__PAI_UPDATE_TAB_TITLE_SYSTEM_MESSAGE__"), {
        __paiSystemMessage: reminder,
      });
    }
  }
}

async function main(): Promise<void> {
  let systemMessage: string | undefined;
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
  } catch (error) {
    // Never throw from hooks.
    const maybeMsg = error && typeof error === "object" ? (error as any).__paiSystemMessage : undefined;
    if (typeof maybeMsg === "string" && maybeMsg.trim()) {
      systemMessage = maybeMsg;
    }
  } finally {
    process.stdout.write(JSON.stringify({ continue: true, systemMessage }) + "\n");
    process.exit(0);
  }
}

await main();
