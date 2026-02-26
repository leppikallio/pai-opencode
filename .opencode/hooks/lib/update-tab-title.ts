import { inference } from "../../skills/PAI/Tools/Inference";

const SYSTEM_PROMPT = `Create a concise working title for a coding task.

Rules:
- Output title text only.
- Use 2-5 words.
- Keep title under 60 characters.
- Do not use quotes, punctuation, or markdown.
- Keep wording relevant to the prompt; no new topics.`;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "help",
  "i",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "please",
  "that",
  "the",
  "this",
  "to",
  "with",
  "you",
]);

const GENERIC_TITLES = new Set(["session", "task", "working", "chat", "conversation"]);

const PURE_RATING_RE = /^(?:10|[1-9])$/;
const MAX_WORDS = 5;
const MAX_TITLE_LENGTH = 60;
const LEADING_PHASE_LABEL_RE = /^(?:OBSERVE|THINK|PLAN|BUILD|WORK|EXECUTE|QUESTION|LEARN|DONE|COMPLETE|IDLE)\s*:\s*/i;
const LOW_SIGNAL_PROMPT_PATTERNS: RegExp[] = [
  /^continue$/i,
  /^go on$/i,
  /^next(?:\s+steps?)?$/i,
  /^what(?:\s+are)?\s+next\s+steps\??$/i,
  /^keep going$/i,
  /^proceed$/i,
  /^status\??$/i,
  /^update\??$/i,
  /^what did we do(?:\s+so far)?\??$/i,
];

function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
}

function toTitleCase(token: string): string {
  if (!token) {
    return "";
  }

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function normalizeGeneratedTitle(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  const cleaned = firstLine
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  const tokens = tokenize(cleaned).slice(0, MAX_WORDS);
  if (tokens.length === 0) {
    return null;
  }

  const title = tokens.map(toTitleCase).join(" ");
  return isValidWorkingTitle(title) ? title : null;
}

export function extractPromptTitle(prompt: string): string | null {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned || PURE_RATING_RE.test(cleaned)) {
    return null;
  }

  const tokens = tokenize(cleaned);
  if (tokens.length === 0) {
    return null;
  }

  const meaningful = tokens.filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  const selected = (meaningful.length > 0 ? meaningful : tokens).slice(0, 3);
  if (selected.length === 0) {
    return null;
  }

  const title = selected.map(toTitleCase).join(" ");
  return isValidWorkingTitle(title) ? title : null;
}

export function isValidWorkingTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length > MAX_TITLE_LENGTH || PURE_RATING_RE.test(trimmed)) {
    return false;
  }

  if (/\r|\n/.test(trimmed) || !/[\p{L}]/u.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) {
    return false;
  }

  return !GENERIC_TITLES.has(trimmed.toLowerCase());
}

export function isTitleRelevantToPrompt(title: string, prompt: string): boolean {
  if (!isValidWorkingTitle(title)) {
    return false;
  }

  const promptTokens = new Set(tokenize(cleanPrompt(prompt)));
  if (promptTokens.size === 0) {
    return false;
  }

  const titleTokens = tokenize(title).filter((token) => !STOP_WORDS.has(token));
  if (titleTokens.length === 0) {
    return false;
  }

  return titleTokens.some((token) => promptTokens.has(token));
}

export function isLowSignalPrompt(prompt: string): boolean {
  const cleaned = normalizeWhitespace(cleanPrompt(prompt).toLowerCase());
  if (!cleaned) {
    return true;
  }

  return LOW_SIGNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function extractCarryForwardTitle(previousTitle: string): string | null {
  const withoutEmojiPrefix = normalizeWhitespace(previousTitle.replace(/^(?:[\p{Extended_Pictographic}]|\uFE0F|\u200D)+\s*/u, ""));
  if (!withoutEmojiPrefix) {
    return null;
  }

  const withoutLeadingPhase = normalizeWhitespace(withoutEmojiPrefix.replace(LEADING_PHASE_LABEL_RE, ""));
  if (!withoutLeadingPhase) {
    return null;
  }

  const tokens = tokenize(withoutLeadingPhase).slice(0, MAX_WORDS);
  if (tokens.length === 0) {
    return null;
  }

  const title = tokens.map(toTitleCase).join(" ");
  return isValidWorkingTitle(title) ? title : null;
}

export async function summarizePromptViaInference(prompt: string): Promise<string | null> {
  if (process.env.PAI_DISABLE_UPDATE_TAB_TITLE_INFERENCE === "1") {
    return null;
  }

  const cleaned = cleanPrompt(prompt);
  if (!cleaned || PURE_RATING_RE.test(cleaned)) {
    return null;
  }

  try {
    const result = await inference({
      level: "fast",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: cleaned.slice(0, 800),
      timeout: 10_000,
    });

    if (!result.success || !result.output) {
      return null;
    }

    const normalized = normalizeGeneratedTitle(result.output);
    if (!normalized) {
      return null;
    }

    return isTitleRelevantToPrompt(normalized, cleaned) ? normalized : null;
  } catch {
    return null;
  }
}
