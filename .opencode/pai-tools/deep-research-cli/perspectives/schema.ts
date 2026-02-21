import { throwWithCode } from "../cli/errors";

export const PERSPECTIVES_DRAFT_SCHEMA_VERSION = "perspectives-draft-output.v1" as const;
const PERSPECTIVE_TRACKS = ["standard", "independent", "contrarian"] as const;
const PERSPECTIVE_DOMAINS = ["social_media", "academic", "technical", "multimodal", "security", "news", "unknown"] as const;

export type PerspectiveTrack = (typeof PERSPECTIVE_TRACKS)[number];
export type PerspectiveDomain = (typeof PERSPECTIVE_DOMAINS)[number];

export type PerspectivesDraftOutputV1 = {
  schema_version: "perspectives-draft-output.v1";
  run_id: string;
  source: {
    agent_type: string;
    label: string;
  };
  candidates: Array<{
    title: string;
    questions: string[];
    track: PerspectiveTrack;
    recommended_agent_type: string;
    domain: PerspectiveDomain;
    confidence: number;
    rationale: string;
    platform_requirements: Array<{ name: string; reason: string }>;
    tool_policy: {
      primary: string[];
      secondary: string[];
      forbidden: string[];
    };
    flags: {
      human_review_required: boolean;
      missing_platform_requirements: boolean;
      missing_tool_policy: boolean;
    };
  }>;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmptyStringAt(value: unknown, fieldPath: string): string {
  const out = asNonEmptyString(value);
  if (!out) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath} must be a non-empty string`);
  }
  return out;
}

function requireStringArrayAt(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath} must be an array of non-empty strings`);
  }

  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const normalized = asNonEmptyString(value[index]);
    if (!normalized) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath}[${index}] must be a non-empty string`);
    }
    out.push(normalized);
  }
  return out;
}

function normalizePerspectivesDraftFlags(value: unknown, fieldPath: string): {
  human_review_required: boolean;
  missing_platform_requirements: boolean;
  missing_tool_policy: boolean;
} {
  if (value === undefined) {
    return {
      human_review_required: false,
      missing_platform_requirements: false,
      missing_tool_policy: false,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath} must be an object`);
  }

  const flags = value as Record<string, unknown>;
  const bool = (entry: unknown): boolean => (typeof entry === "boolean" ? entry : false);
  return {
    human_review_required: bool(flags.human_review_required),
    missing_platform_requirements: bool(flags.missing_platform_requirements),
    missing_tool_policy: bool(flags.missing_tool_policy),
  };
}

function normalizePlatformRequirements(value: unknown, fieldPath: string): {
  requirements: Array<{ name: string; reason: string }>;
  missing: boolean;
} {
  if (value === undefined) {
    return { requirements: [], missing: true };
  }
  if (!Array.isArray(value)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath} must be an array`);
  }

  const requirements: Array<{ name: string; reason: string }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath}[${index}] must be an object`);
    }
    const requirement = item as Record<string, unknown>;
    requirements.push({
      name: requireNonEmptyStringAt(requirement.name, `${fieldPath}[${index}].name`),
      reason: requireNonEmptyStringAt(requirement.reason, `${fieldPath}[${index}].reason`),
    });
  }

  return {
    requirements,
    missing: requirements.length === 0,
  };
}

function normalizeToolPolicy(value: unknown, fieldPath: string): {
  toolPolicy: {
    primary: string[];
    secondary: string[];
    forbidden: string[];
  };
  missing: boolean;
} {
  if (value === undefined) {
    return {
      toolPolicy: { primary: [], secondary: [], forbidden: [] },
      missing: true,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `${fieldPath} must be an object`);
  }

  const policy = value as Record<string, unknown>;
  const primary = policy.primary === undefined
    ? []
    : requireStringArrayAt(policy.primary, `${fieldPath}.primary`);
  const secondary = policy.secondary === undefined
    ? []
    : requireStringArrayAt(policy.secondary, `${fieldPath}.secondary`);
  const forbidden = policy.forbidden === undefined
    ? []
    : requireStringArrayAt(policy.forbidden, `${fieldPath}.forbidden`);

  return {
    toolPolicy: { primary, secondary, forbidden },
    missing: primary.length === 0 && secondary.length === 0 && forbidden.length === 0,
  };
}

export function normalizePerspectivesDraftOutputV1(args: {
  value: unknown;
  expectedRunId: string;
}): PerspectivesDraftOutputV1 {
  if (!args.value || typeof args.value !== "object" || Array.isArray(args.value)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", "payload must be an object");
  }

  const root = args.value as Record<string, unknown>;
  if (root.schema_version !== PERSPECTIVES_DRAFT_SCHEMA_VERSION) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", "schema_version must be perspectives-draft-output.v1");
  }

  const runId = requireNonEmptyStringAt(root.run_id, "run_id");
  if (runId !== args.expectedRunId) {
    throwWithCode(
      "PERSPECTIVES_DRAFT_RUN_ID_MISMATCH",
      `run_id mismatch: expected ${args.expectedRunId}, got ${runId}`,
    );
  }

  const sourceRaw = root.source;
  if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", "source must be an object");
  }
  const source = sourceRaw as Record<string, unknown>;

  const candidatesRaw = root.candidates;
  if (!Array.isArray(candidatesRaw)) {
    throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", "candidates must be an array");
  }

  const candidates = candidatesRaw.map((candidateRaw, index) => {
    if (!candidateRaw || typeof candidateRaw !== "object" || Array.isArray(candidateRaw)) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `candidates[${index}] must be an object`);
    }

    const candidate = candidateRaw as Record<string, unknown>;
    const trackValue = asNonEmptyString(candidate.track);
    const missingTrack = !trackValue;
    const track = missingTrack
      ? "standard"
      : (trackValue as PerspectiveTrack);
    if (!missingTrack && !PERSPECTIVE_TRACKS.includes(track)) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `candidates[${index}].track must be standard|independent|contrarian`);
    }

    const domain = requireNonEmptyStringAt(candidate.domain, `candidates[${index}].domain`);
    if (!PERSPECTIVE_DOMAINS.includes(domain as PerspectiveDomain)) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `candidates[${index}].domain is invalid`);
    }

    const confidenceRaw = candidate.confidence;
    if (typeof confidenceRaw !== "number" || !Number.isInteger(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 100) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `candidates[${index}].confidence must be an integer between 0 and 100`);
    }
    const confidence = confidenceRaw;

    const { requirements, missing: missingPlatformRequirements } = normalizePlatformRequirements(
      candidate.platform_requirements,
      `candidates[${index}].platform_requirements`,
    );
    const { toolPolicy, missing: missingToolPolicy } = normalizeToolPolicy(
      candidate.tool_policy,
      `candidates[${index}].tool_policy`,
    );

    const flags = normalizePerspectivesDraftFlags(candidate.flags, `candidates[${index}].flags`);
    const humanReviewRequired = flags.human_review_required || missingTrack || missingPlatformRequirements || missingToolPolicy;

    return {
      title: requireNonEmptyStringAt(candidate.title, `candidates[${index}].title`),
      questions: requireStringArrayAt(candidate.questions, `candidates[${index}].questions`),
      track,
      recommended_agent_type: requireNonEmptyStringAt(
        candidate.recommended_agent_type,
        `candidates[${index}].recommended_agent_type`,
      ),
      domain: domain as PerspectiveDomain,
      confidence,
      rationale: requireNonEmptyStringAt(candidate.rationale, `candidates[${index}].rationale`),
      platform_requirements: requirements,
      tool_policy: toolPolicy,
      flags: {
        human_review_required: humanReviewRequired,
        missing_platform_requirements: flags.missing_platform_requirements || missingPlatformRequirements,
        missing_tool_policy: flags.missing_tool_policy || missingToolPolicy,
      },
    };
  });

  return {
    schema_version: PERSPECTIVES_DRAFT_SCHEMA_VERSION,
    run_id: runId,
    source: {
      agent_type: requireNonEmptyStringAt(source.agent_type, "source.agent_type"),
      label: requireNonEmptyStringAt(source.label, "source.label"),
    },
    candidates,
  };
}
