/**
 * Enforcement Gate (v2.5 OpenCode port)
 *
 * Provides a deterministic, loop-safe validation and fallback wrapper for
 * enforcing the PAI response contract.
 */

import { parseIscResponse } from "./isc-parser";
import { classifyFormatHint } from "./format-reminder";
import { detectRating } from "./rating-capture";

export type EnforcementMode = "MINIMAL" | "FULL";

export type ValidationDetails = {
  ok: boolean;
  mode: EnforcementMode;
  reasons: string[];
  criteriaCount?: number;
};

function isPureSocialUserText(userText: string): boolean {
  const t = userText.trim();
  if (!t) return true;
  if (t.length > 200) return false;

  // Explicit ratings (1-10) are treated as minimal.
  if (detectRating(t)) return true;

  // Common acknowledgements/greetings.
  if (/^(ok|okay|k|kk|thanks|thank you|thx|ty|cool|nice|great|awesome)[.!]?$/i.test(t)) return true;
  if (/^(hi|hey|hello|yo|sup|morning|good morning|good evening)[.!]?$/i.test(t)) return true;
  return false;
}

export function detectEnforcementMode(opts: {
  userText: string;
  toolUsed: boolean;
  assistantText: string;
}): EnforcementMode {
  if (opts.toolUsed) return "FULL";
  if (!isPureSocialUserText(opts.userText)) return "FULL";
  // If the assistant output is already long/complex, prefer FULL wrapper.
  if (opts.assistantText.trim().length >= 600) return "FULL";
  return "MINIMAL";
}

export function looksLikeJsonOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

export function validateMinimalFormat(text: string): boolean {
  const hasVoiceLine = /^🗣️\s*[^:\n]{1,40}:/m.test(text);
  const hasSummaryLine = /^📋 SUMMARY:/m.test(text);
  return hasVoiceLine && hasSummaryLine;
}

export function validateFullFormatDetailed(text: string): {
  ok: boolean;
  criteriaCount: number;
  reasons: string[];
} {
  const hint = classifyFormatHint(text, "");
  const reasons: string[] = [];

  if (!hint.features.hasPaiAlgorithmHeader) reasons.push("missing_pai_algorithm_header");
  if (!hint.features.hasVoiceLine) reasons.push("missing_voice_line");
  if (!hint.features.hasSummaryLine) reasons.push("missing_summary_line");
  if (!hint.features.hasIscTracker) reasons.push("missing_isc_tracker");
  if (hint.features.phaseCount < 5) reasons.push("missing_phases");

  const parsed = parseIscResponse(text);
  const criteriaCount = parsed.criteria.length;
  if (parsed.attempted && criteriaCount === 0) reasons.push("empty_isc_criteria");

  return { ok: reasons.length === 0, criteriaCount, reasons };
}

export function validateFullFormat(text: string): boolean {
  return validateFullFormatDetailed(text).ok;
}

export function validateOutput(text: string, mode: EnforcementMode): ValidationDetails {
  if (mode === "MINIMAL") {
    const ok = validateMinimalFormat(text);
    return { ok, mode, reasons: ok ? [] : ["missing_minimal_markers"] };
  }
  const details = validateFullFormatDetailed(text);
  return { ok: details.ok, mode, reasons: details.reasons, criteriaCount: details.criteriaCount };
}

export function buildFallbackFullWrapper(opts: {
  task: string;
  userText: string;
  assistantText: string;
}): string {
  const original = opts.assistantText.trim();
  const clipped = original.length > 4000 ? `${original.slice(0, 4000)}\n\n[truncated]` : original;

  return [
    "🤖 PAI ALGORITHM ══════════════════════════════════════════════════════════════",
    `   Task: ${opts.task}`,
    "   [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0% → IDEAL STATE",
    "",
    "━━━ 👁️  O B S E R V E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1/7",
    "",
    "**Observations:**",
    "- What exists now: assistant output failed contract validation",
    "- What you explicitly asked: see user message below",
    "- Relevant context: original assistant output preserved in OUTPUT",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ 🧠  T H I N K ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2/7",
    "",
    "**Analysis:**",
    "- Goal: enforce required response contract deterministically",
    "- Approach: wrap original output in required structure",
    "- Constraint: do not invent tool results or evidence",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ 📋  P L A N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 3/7",
    "",
    "**IDEAL:** Output conforms to required PAI response structure.",
    "",
    "🎯 ISC TRACKER ════════════════════════════════════════════════════════════════",
    "│ # │ Criterion (exactly 8 words)                 │ Status          │ Δ      │",
    "├───┼─────────────────────────────────────────────┼─────────────────┼────────┤",
    "│ 1 │ All required response format fields are present now │ ✅ VERIFIED     │ ★ ADDED │",
    "├───┴─────────────────────────────────────────────┴─────────────────┴────────┤",
    "│ ⚠️ ANTI-CRITERIA                                                          │",
    "├───┬─────────────────────────────────────────────┬──────────────────────────┤",
    "│ ! │ No tool results invented in wrapper output ever │ ✅ AVOIDED               │",
    "└───┴─────────────────────────────────────────────┴──────────────────────────┘",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ 🔨  B U I L D ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 4/7",
    "",
    "**Building:**",
    "- This wrapper around original assistant output",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ ⚡  E X E C U T E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 5/7",
    "",
    "**Actions:**",
    "- Wrapped non-compliant assistant output",
    "",
    "🎯 ISC UPDATE ═════════════════════════════════════════════════════════════════",
    "│ # │ Criterion                          │ Status          │ Δ              │",
    "├───┼────────────────────────────────────┼─────────────────┼────────────────┤",
    "│ 1 │ All required response format fields are present now │ ✅ VERIFIED     │ ▲ VERIFIED     │",
    "└───┴────────────────────────────────────┴─────────────────┴────────────────┘",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ ✅  V E R I F Y ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/7",
    "",
    "🎯 FINAL ISC STATE ════════════════════════════════════════════════════════════",
    "│ # │ Criterion                          │ Status          │ Evidence       │",
    "├───┼────────────────────────────────────┼─────────────────┼────────────────┤",
    "│ 1 │ All required response format fields are present now │ ✅ VERIFIED     │ wrapper inserted │",
    "└───┴────────────────────────────────────┴─────────────────┴────────────────┘",
    "",
    "**🔧 Capabilities:** direct",
    "",
    "━━━ 📤  O U T P U T ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6.5/7",
    "",
    "Original user message:",
    "```",
    opts.userText.trim(),
    "```",
    "",
    "Original assistant output (preserved):",
    "```",
    clipped,
    "```",
    "",
    "━━━ 📚  L E A R N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7/7",
    "",
    "📋 SUMMARY: I wrapped the prior assistant output into the required contract.",
    "➡️ NEXT: Respond again in FULL format without needing a wrapper.",
    "",
    "🗣️ Marvin: I enforced the response contract by wrapping the original output.",
  ].join("\n");
}

export function buildFallbackMinimalWrapper(opts: {
  task: string;
  assistantText: string;
}): string {
  const original = opts.assistantText.trim();
  const clipped = original.length > 400 ? `${original.slice(0, 400)}…` : original;
  return [
    "🤖 PAI ALGORITHM ══════════════════════════════════════════════════════════════",
    `   Task: ${opts.task}`,
    "",
    "📋 SUMMARY: Wrapped prior output into minimal contract.",
    "",
    `🗣️ Marvin: ${clipped || "Acknowledged."}`,
  ].join("\n");
}
