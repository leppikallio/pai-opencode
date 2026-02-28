export type PromptClassificationType = "work" | "question" | "conversational";
export type PromptEffort = "low" | "standard" | "high";

export type PromptClassification = {
  v: "0.1";
  ts: string;
  type: PromptClassificationType;
  title: string;
  effort: PromptEffort;
  is_new_topic: boolean;
  source: "heuristic";
};

const QUESTION_START = /^(what|why|how|when|where|who|which|does|do|did|is|are|can|could|should|would|will)\b/i;
const CONVERSATIONAL_SHORT = /^(ok|okay|k|thanks|thank you|thx|cool|nice|great|yep|yes|no|sure|hi|hello|hey|got it|sounds good)[.!?]*$/i;
const WORK_CUE = /\b(implement|build|create|fix|add|update|write|refactor|optimize|debug|test|design|migrate|configure|set up|setup|integrate|modify|change)\b/i;
const CONTINUATION_CUE = /\b(continue|again|next|same|that|it|follow up|follow-up|as above)\b/i;
const TRIVIAL_PROMPTS = new Set([
  "ok",
  "okay",
  "k",
  "thanks",
  "thank you",
  "thx",
  "cool",
  "nice",
  "great",
  "yep",
  "yes",
  "no",
  "sure",
  "hi",
  "hello",
  "hey",
  "got it",
  "sounds good",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferTitle(prompt: string): string {
  const normalized = normalizeWhitespace(prompt.replace(/[\r\n]+/g, " "));
  if (!normalized) return "work-session";

  const cleaned = normalized.replace(/^["']+|["']+$/g, "").replace(/[?!.]+$/, "");
  const words = cleaned.split(/\s+/).slice(0, 8);
  if (words.length === 0) return "work-session";
  return words.join(" ");
}

function inferEffort(prompt: string): PromptEffort {
  const lower = prompt.toLowerCase();
  if (/\b(thorough|comprehensive|deep|full audit|architecture|end-to-end)\b/.test(lower)) {
    return "high";
  }
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 14) {
    return "high";
  }
  if (words <= 5) {
    return "low";
  }
  return "standard";
}

function normalizePromptForTrivialCheck(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/[\p{P}]+$/gu, "").trim();
}

export function isTrivialPrompt(prompt: string): boolean {
  const normalized = normalizePromptForTrivialCheck(prompt);
  if (!normalized) {
    return false;
  }

  return TRIVIAL_PROMPTS.has(normalized);
}

export function classifyPrompt(prompt: string): PromptClassification {
  const normalized = normalizeWhitespace(prompt);
  const lower = normalized.toLowerCase();

  let type: PromptClassificationType = "conversational";
  if (!normalized) {
    type = "conversational";
  } else if (normalized.endsWith("?") || QUESTION_START.test(lower)) {
    type = "question";
  } else if (CONVERSATIONAL_SHORT.test(lower)) {
    type = "conversational";
  } else {
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (WORK_CUE.test(lower) && wordCount >= 4) {
      type = "work";
    }
  }

  const effort: PromptEffort = type === "work" ? inferEffort(normalized) : "low";

  return {
    v: "0.1",
    ts: new Date().toISOString(),
    type,
    title: inferTitle(normalized),
    effort,
    is_new_topic: !CONTINUATION_CUE.test(lower),
    source: "heuristic",
  };
}
