#!/usr/bin/env bun
/**
 * PromptClassifier.ts
 *
 * Canonical advisory prompt-hint producer for utility/testing workflows.
 *
 * - Uses `openai/gpt-5.2` via the OpenCode carrier (`Inference.ts`) when enabled.
 * - Falls back to deterministic heuristics.
 * - Emits canonical advisory envelope JSON.
 */

import { inference } from "./Inference";
import {
  type AdvisoryHintCandidate,
  type AdvisoryHintEnvelope,
  type CarrierHintMode,
  type PromptDepth,
  type ReasoningProfile,
  type Verbosity,
  createAdvisoryHintCandidate,
  reduceAdvisoryHintCandidates,
} from "../../../plugins/shared/hint-envelope";
import {
  PROMPT_CLASSIFIER_SYSTEM_PROMPT,
  createHeuristicPromptHintCandidate,
} from "../../../plugins/shared/prompt-classifier-contract";

export type PromptHint = AdvisoryHintEnvelope;

type PromptClassifierOptions = {
  carrierMode?: CarrierHintMode;
};

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

function usage(): string {
  return [
    "Usage:",
    '  bun PromptClassifier.ts [--carrier-mode active|shadow|disabled] "<user prompt>"',
    "",
    "Inference preset (when carrier mode is not disabled):",
    "  - level: fast",
    "  - timeout: 2000ms (intentional quick-pass budget)",
    "  - model: openai/gpt-5.2 (explicit override)",
    "  - reasoningEffort/textVerbosity/steps: not set by this classifier; OpenCode/provider defaults apply",
    "",
    "Carrier modes:",
    "  - active   (default): heuristic + carrier candidate through deterministic reducer",
    "  - shadow: heuristic remains selected; carrier candidate kept in provenance",
    "  - disabled: heuristic only (useful for parity tests)",
    "",
    "Notes:",
    "  - Advisory-only schema: no imperative fields (model/spawn/run_in_background/subagent_type).",
    "  - Emits canonical envelope with reducer metadata + provenance.",
  ].join("\n");
}

function parseCarrierMode(raw: string | undefined): CarrierHintMode | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "active" || TRUE_VALUES.has(normalized)) return "active";
  if (normalized === "shadow") return "shadow";
  if (normalized === "disabled" || FALSE_VALUES.has(normalized)) return "disabled";
  return null;
}

function resolveClassifierCarrierMode(
  options?: PromptClassifierOptions,
): CarrierHintMode {
  const fromOptions = parseCarrierMode(options?.carrierMode);
  if (fromOptions) return fromOptions;

  const fromEnv = parseCarrierMode(process.env.PAI_PROMPT_CLASSIFIER_CARRIER_MODE);
  if (fromEnv) return fromEnv;

  return "active";
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function openAiClassifyCandidate(
  prompt: string,
  carrierMode: CarrierHintMode,
): Promise<AdvisoryHintCandidate | null> {
  const systemPrompt = PROMPT_CLASSIFIER_SYSTEM_PROMPT;

  const result = await inference({
    systemPrompt,
    userPrompt: prompt,
    level: "fast",
    expectJson: true,
    timeout: 2000,
    model: "openai/gpt-5.2",
  });

  if (!result.success) {
    return null;
  }

  const parsed = parseObject(result.parsed);
  if (!parsed) {
    return null;
  }

  return createAdvisoryHintCandidate({
    producer: "runtime_carrier_openai",
    mode: carrierMode === "shadow" ? "runtime_shadow" : "utility",
    advisory: {
      depth: parsed.depth as PromptDepth,
      reasoning_profile: parsed.reasoning_profile as ReasoningProfile,
      verbosity: parsed.verbosity as Verbosity,
      capabilities: Array.isArray(parsed.capabilities)
        ? (parsed.capabilities.filter((value) => typeof value === "string") as string[])
        : [],
      thinking_tools: Array.isArray(parsed.thinking_tools)
        ? (parsed.thinking_tools.filter((value) => typeof value === "string") as string[])
        : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
    },
  });
}

export async function classifyPromptToHintEnvelope(
  prompt: string,
  options?: PromptClassifierOptions,
): Promise<PromptHint> {
  const carrierMode = resolveClassifierCarrierMode(options);
  const candidates: AdvisoryHintCandidate[] = [
    createHeuristicPromptHintCandidate(prompt, "utility"),
  ];

  if (carrierMode !== "disabled") {
    const carrierCandidate = await openAiClassifyCandidate(prompt, carrierMode);
    if (carrierCandidate) {
      candidates.push(carrierCandidate);
    }
  }

  return reduceAdvisoryHintCandidates({
    userMessageId: "utility:prompt-classifier",
    candidates,
    carrierMode,
    forceProducer: carrierMode === "shadow" ? "runtime_heuristic" : undefined,
  });
}

function parseCliArgs(argv: string[]): {
  carrierMode: CarrierHintMode | undefined;
  prompt: string;
  help: boolean;
} {
  const queue = [...argv];
  let carrierMode: CarrierHintMode | undefined;
  const promptParts: string[] = [];
  let help = false;

  while (queue.length > 0) {
    const token = queue.shift() ?? "";
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }

    if (token === "--carrier-mode") {
      const mode = parseCarrierMode(queue.shift());
      if (mode) {
        carrierMode = mode;
      }
      continue;
    }

    promptParts.push(token);
  }

  return {
    carrierMode,
    prompt: promptParts.join(" ").trim(),
    help,
  };
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    return;
  }

  if (!parsed.prompt) {
    console.error(usage());
    process.exit(1);
  }

  const hint = await classifyPromptToHintEnvelope(parsed.prompt, {
    carrierMode: parsed.carrierMode,
  });
  console.log(JSON.stringify(hint));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
