export type PromptDepth = "MINIMAL" | "ITERATION" | "FULL";
export type ReasoningProfile = "light" | "standard" | "deep";
export type Verbosity = "minimal" | "standard" | "detailed";

export type HintSource = "heuristic" | "openai";
export type HintProducerId = "runtime_heuristic" | "runtime_carrier_openai";
export type HintProducerMode = "runtime_default" | "runtime_shadow" | "utility";

export type CarrierHintMode = "disabled" | "shadow" | "active";

export type HintToast = {
  message: string;
  variant: "info" | "warning";
  durationMs?: number;
};

export type AdvisoryHint = {
  depth: PromptDepth;
  reasoning_profile: ReasoningProfile;
  verbosity: Verbosity;
  capabilities: string[];
  thinking_tools: string[];
  confidence: number;
};

export type AdvisoryHintCandidate = {
  producer: HintProducerId;
  source: HintSource;
  mode: HintProducerMode;
  advisory: AdvisoryHint;
  toast?: HintToast;
};

export type AdvisoryHintProvenance = {
  producer: HintProducerId;
  source: HintSource;
  mode: HintProducerMode;
  confidence: number;
  selected: boolean;
};

export type AdvisoryHintEnvelope = {
  v: "1.0";
  kind: "pai.advisory_hint";
  ts: string;
  userMessageId: string;
  source: HintSource;
  advisory: AdvisoryHint;
  confidence: number;
  toast?: HintToast;
  provenance: AdvisoryHintProvenance[];
  reducer: {
    strategy: "confidence_desc_then_registry_rank";
    selectedProducer: HintProducerId;
  };
  carrier_mode: CarrierHintMode;
};

type HintProducerRegistryEntry = {
  id: HintProducerId;
  source: HintSource;
  rank: number;
  defaultRuntime: boolean;
  shadowCapable: boolean;
  utilityCapable: boolean;
};

export const HINT_PRODUCER_REGISTRY: Record<HintProducerId, HintProducerRegistryEntry> = {
  runtime_heuristic: {
    id: "runtime_heuristic",
    source: "heuristic",
    rank: 10,
    defaultRuntime: true,
    shadowCapable: false,
    utilityCapable: true,
  },
  runtime_carrier_openai: {
    id: "runtime_carrier_openai",
    source: "openai",
    rank: 20,
    defaultRuntime: false,
    shadowCapable: true,
    utilityCapable: true,
  },
};

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

const IMPERATIVE_FIELD_DENYLIST = new Set([
  "model",
  "spawn",
  "run_in_background",
  "subagent_type",
]);

const VALID_DEPTH: PromptDepth[] = ["MINIMAL", "ITERATION", "FULL"];
const VALID_REASONING: ReasoningProfile[] = ["light", "standard", "deep"];
const VALID_VERBOSITY: Verbosity[] = ["minimal", "standard", "detailed"];

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeEnvValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function candidateFingerprint(candidate: AdvisoryHintCandidate): string {
  const advisory = candidate.advisory;
  return [
    candidate.producer,
    candidate.source,
    candidate.mode,
    advisory.depth,
    advisory.reasoning_profile,
    advisory.verbosity,
    advisory.capabilities.join("|"),
    advisory.thinking_tools.join("|"),
    advisory.confidence.toFixed(6),
  ].join("#");
}

function compareCandidates(
  a: AdvisoryHintCandidate,
  b: AdvisoryHintCandidate,
  forcedProducer?: HintProducerId,
): number {
  if (forcedProducer) {
    const aForced = a.producer === forcedProducer;
    const bForced = b.producer === forcedProducer;
    if (aForced !== bForced) return aForced ? -1 : 1;
  }

  if (a.advisory.confidence !== b.advisory.confidence) {
    return b.advisory.confidence - a.advisory.confidence;
  }

  const rankA = HINT_PRODUCER_REGISTRY[a.producer]?.rank ?? Number.MAX_SAFE_INTEGER;
  const rankB = HINT_PRODUCER_REGISTRY[b.producer]?.rank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  const sourceOrder = a.source.localeCompare(b.source);
  if (sourceOrder !== 0) return sourceOrder;

  return candidateFingerprint(a).localeCompare(candidateFingerprint(b));
}

function mergeDuplicateProducerCandidates(
  candidates: AdvisoryHintCandidate[],
): AdvisoryHintCandidate[] {
  const bestByProducer = new Map<HintProducerId, AdvisoryHintCandidate>();

  for (const candidate of candidates) {
    const existing = bestByProducer.get(candidate.producer);
    if (!existing) {
      bestByProducer.set(candidate.producer, candidate);
      continue;
    }

    const pick = compareCandidates(candidate, existing) < 0 ? candidate : existing;
    bestByProducer.set(candidate.producer, pick);
  }

  return [...bestByProducer.values()];
}

function normalizePromptDepth(value: unknown): PromptDepth {
  return VALID_DEPTH.includes(value as PromptDepth)
    ? (value as PromptDepth)
    : "FULL";
}

function normalizeReasoningProfile(value: unknown): ReasoningProfile {
  return VALID_REASONING.includes(value as ReasoningProfile)
    ? (value as ReasoningProfile)
    : "standard";
}

function normalizeVerbosity(value: unknown): Verbosity {
  return VALID_VERBOSITY.includes(value as Verbosity)
    ? (value as Verbosity)
    : "standard";
}

function createHintToast(advisory: AdvisoryHint): HintToast {
  const bits: string[] = [];
  bits.push(`depth=${advisory.depth}`);
  if (advisory.reasoning_profile !== "standard") {
    bits.push(`reasoning=${advisory.reasoning_profile}`);
  }
  if (advisory.thinking_tools.length > 0) {
    bits.push(`tools=${advisory.thinking_tools.slice(0, 2).join("+")}`);
  }

  return {
    message: `Hint: ${bits.join(" ")}`,
    variant: "info",
    durationMs: 5000,
  };
}

export function normalizeAdvisoryHint(value: Partial<AdvisoryHint> | undefined): AdvisoryHint {
  return {
    depth: normalizePromptDepth(value?.depth),
    reasoning_profile: normalizeReasoningProfile(value?.reasoning_profile),
    verbosity: normalizeVerbosity(value?.verbosity),
    capabilities:
      uniqueStrings(value?.capabilities).length > 0
        ? uniqueStrings(value?.capabilities)
        : ["Engineer"],
    thinking_tools: uniqueStrings(value?.thinking_tools),
    confidence: clampConfidence(value?.confidence, 0.5),
  };
}

export function createAdvisoryHintCandidate(args: {
  producer: HintProducerId;
  mode: HintProducerMode;
  source?: HintSource;
  advisory: Partial<AdvisoryHint>;
  toast?: HintToast;
}): AdvisoryHintCandidate {
  return {
    producer: args.producer,
    source: args.source ?? HINT_PRODUCER_REGISTRY[args.producer].source,
    mode: args.mode,
    advisory: normalizeAdvisoryHint(args.advisory),
    toast: args.toast,
  };
}

export function listDefaultRuntimeHintProducers(): HintProducerId[] {
  return Object.values(HINT_PRODUCER_REGISTRY)
    .filter((entry) => entry.defaultRuntime)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.id);
}

export function resolveCarrierHintMode(
  env: Record<string, string | undefined> = process.env,
): CarrierHintMode {
  const explicitMode = normalizeEnvValue(env.PAI_PROMPT_HINT_CARRIER_MODE);
  if (explicitMode === "shadow") return "shadow";
  if (explicitMode === "active") return "active";
  if (explicitMode === "disabled") return "disabled";
  if (TRUE_VALUES.has(explicitMode)) return "active";
  if (FALSE_VALUES.has(explicitMode)) return "disabled";

  const legacyFlag = normalizeEnvValue(env.PAI_ENABLE_CARRIER_PROMPT_HINTS);
  if (TRUE_VALUES.has(legacyFlag)) return "active";
  if (FALSE_VALUES.has(legacyFlag)) return "disabled";

  return "disabled";
}

export function containsImperativeHintField(value: unknown): boolean {
  const visited = new Set<unknown>();

  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    if (visited.has(node)) return false;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (walk(item)) return true;
      }
      return false;
    }

    const record = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (IMPERATIVE_FIELD_DENYLIST.has(key)) return true;
      if (walk(child)) return true;
    }
    return false;
  };

  return walk(value);
}

export function reduceAdvisoryHintCandidates(args: {
  userMessageId: string;
  candidates: AdvisoryHintCandidate[];
  carrierMode?: CarrierHintMode;
  forceProducer?: HintProducerId;
  now?: () => string;
}): AdvisoryHintEnvelope {
  const now = args.now ?? (() => new Date().toISOString());
  const carrierMode = args.carrierMode ?? "disabled";

  const inputCandidates = args.candidates
    .map((candidate) => ({
      ...candidate,
      advisory: normalizeAdvisoryHint(candidate.advisory),
      toast: candidate.toast,
    }))
    .filter((candidate) => !containsImperativeHintField(candidate));

  const fallback = createAdvisoryHintCandidate({
    producer: "runtime_heuristic",
    mode: "runtime_default",
    advisory: {
      depth: "FULL",
      reasoning_profile: "standard",
      verbosity: "standard",
      capabilities: ["Engineer"],
      thinking_tools: [],
      confidence: 0.5,
    },
  });

  const deduped = mergeDuplicateProducerCandidates(
    inputCandidates.length > 0 ? inputCandidates : [fallback],
  );

  const sorted = [...deduped].sort((a, b) =>
    compareCandidates(a, b, args.forceProducer),
  );
  const selected = sorted[0] ?? fallback;

  return {
    v: "1.0",
    kind: "pai.advisory_hint",
    ts: now(),
    userMessageId: args.userMessageId,
    source: selected.source,
    advisory: selected.advisory,
    confidence: selected.advisory.confidence,
    toast: selected.toast ?? createHintToast(selected.advisory),
    provenance: sorted.map((candidate, index) => ({
      producer: candidate.producer,
      source: candidate.source,
      mode: candidate.mode,
      confidence: candidate.advisory.confidence,
      selected: index === 0,
    })),
    reducer: {
      strategy: "confidence_desc_then_registry_rank",
      selectedProducer: selected.producer,
    },
    carrier_mode: carrierMode,
  };
}

export type ExplicitRoutingPrecedenceResult = {
  hasExplicitRoutingCue: boolean;
  advisorySuppressed: boolean;
  precedence: "explicit_routing" | "advisory";
  effectiveCapabilities: string[];
};

export function applyExplicitRoutingPrecedence(args: {
  hasExplicitRoutingCue: boolean;
  advisoryCapabilities: readonly string[];
}): ExplicitRoutingPrecedenceResult {
  const effectiveCapabilities = uniqueStrings(args.advisoryCapabilities);
  if (args.hasExplicitRoutingCue) {
    return {
      hasExplicitRoutingCue: true,
      advisorySuppressed: true,
      precedence: "explicit_routing",
      effectiveCapabilities: [],
    };
  }

  return {
    hasExplicitRoutingCue: false,
    advisorySuppressed: false,
    precedence: "advisory",
    effectiveCapabilities,
  };
}
