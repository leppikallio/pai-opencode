import * as path from "node:path";

import {
  MANIFEST_STAGE,
  STAGE_TIMEOUT_SECONDS_V1,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  isInteger,
  isPlainObject,
  readJson,
} from "./lifecycle_lib";

export const RUN_POLICY_SCHEMA_VERSION = "run_policy.v1";

export type CitationsLadderPolicyV1 = {
  direct_fetch_timeout_ms: number;
  endpoint_timeout_ms: number;
  max_redirects: number;
  max_body_bytes: number;
  direct_fetch_max_attempts: number;
  bright_data_max_attempts: number;
  apify_max_attempts: number;
  backoff_initial_ms: number;
  backoff_multiplier: number;
  backoff_max_ms: number;
};

export type RunPolicyV1 = {
  schema_version: "run_policy.v1";
  stage_timeouts_seconds_v1: Record<string, number>;
  citations_ladder_policy_v1: CitationsLadderPolicyV1;
  run_lock_policy_v1?: {
    lease_seconds: number;
    heartbeat_interval_ms: number;
    heartbeat_max_failures: number;
  };
};

export type RunPolicySource =
  | "policy"
  | "default_missing"
  | "default_invalid_json"
  | "default_invalid_schema";

export type ResolvedRunPolicy = {
  policy_path: string;
  source: RunPolicySource;
  policy: RunPolicyV1;
};

const DEFAULT_CITATIONS_LADDER_POLICY_V1: CitationsLadderPolicyV1 = {
  direct_fetch_timeout_ms: 5000,
  endpoint_timeout_ms: 5000,
  max_redirects: 5,
  max_body_bytes: 2 * 1024 * 1024,
  direct_fetch_max_attempts: 1,
  bright_data_max_attempts: 1,
  apify_max_attempts: 1,
  backoff_initial_ms: 100,
  backoff_multiplier: 2,
  backoff_max_ms: 1000,
};

function defaultStageTimeoutsV1(): Record<string, number> {
  return { ...STAGE_TIMEOUT_SECONDS_V1 };
}

export function defaultRunPolicyV1(): RunPolicyV1 {
  return {
    schema_version: RUN_POLICY_SCHEMA_VERSION,
    stage_timeouts_seconds_v1: defaultStageTimeoutsV1(),
    citations_ladder_policy_v1: { ...DEFAULT_CITATIONS_LADDER_POLICY_V1 },
  };
}

export function runPolicyPathFromRunRoot(runRoot: string): string {
  return path.join(runRoot, "run-config", "policy.json");
}

function coercePositiveInt(value: unknown, fallback: number): number {
  if (!isInteger(value) || value <= 0) return fallback;
  return value;
}

function coercePositiveFinite(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function sanitizeStageTimeouts(value: unknown): Record<string, number> {
  const defaults = defaultStageTimeoutsV1();
  if (!isPlainObject(value)) return defaults;

  const out: Record<string, number> = { ...defaults };
  for (const stage of MANIFEST_STAGE) {
    out[stage] = coercePositiveInt((value as Record<string, unknown>)[stage], defaults[stage]);
  }
  return out;
}

function sanitizeCitationsLadderPolicy(value: unknown): CitationsLadderPolicyV1 {
  const base = { ...DEFAULT_CITATIONS_LADDER_POLICY_V1 };
  if (!isPlainObject(value)) return base;

  return {
    direct_fetch_timeout_ms: coercePositiveInt(value.direct_fetch_timeout_ms, base.direct_fetch_timeout_ms),
    endpoint_timeout_ms: coercePositiveInt(value.endpoint_timeout_ms, base.endpoint_timeout_ms),
    max_redirects: coercePositiveInt(value.max_redirects, base.max_redirects),
    max_body_bytes: coercePositiveInt(value.max_body_bytes, base.max_body_bytes),
    direct_fetch_max_attempts: coercePositiveInt(value.direct_fetch_max_attempts, base.direct_fetch_max_attempts),
    bright_data_max_attempts: coercePositiveInt(value.bright_data_max_attempts, base.bright_data_max_attempts),
    apify_max_attempts: coercePositiveInt(value.apify_max_attempts, base.apify_max_attempts),
    backoff_initial_ms: coercePositiveInt(value.backoff_initial_ms, base.backoff_initial_ms),
    backoff_multiplier: coercePositiveFinite(value.backoff_multiplier, base.backoff_multiplier),
    backoff_max_ms: coercePositiveInt(value.backoff_max_ms, base.backoff_max_ms),
  };
}

function sanitizeRunPolicy(value: unknown): RunPolicyV1 | null {
  if (!isPlainObject(value)) return null;
  if (value.schema_version !== RUN_POLICY_SCHEMA_VERSION) return null;

  return {
    schema_version: RUN_POLICY_SCHEMA_VERSION,
    stage_timeouts_seconds_v1: sanitizeStageTimeouts(value.stage_timeouts_seconds_v1),
    citations_ladder_policy_v1: sanitizeCitationsLadderPolicy(value.citations_ladder_policy_v1),
  };
}

export async function readRunPolicyForRunRoot(runRoot: string): Promise<ResolvedRunPolicy> {
  const policyPath = runPolicyPathFromRunRoot(runRoot);
  const defaults = defaultRunPolicyV1();

  try {
    const raw = await readJson(policyPath);
    const policy = sanitizeRunPolicy(raw);
    if (!policy) {
      return {
        policy_path: policyPath,
        source: "default_invalid_schema",
        policy: defaults,
      };
    }
    return {
      policy_path: policyPath,
      source: "policy",
      policy,
    };
  } catch (e) {
    if (errorCode(e) === "ENOENT") {
      return {
        policy_path: policyPath,
        source: "default_missing",
        policy: defaults,
      };
    }
    if (e instanceof SyntaxError) {
      return {
        policy_path: policyPath,
        source: "default_invalid_json",
        policy: defaults,
      };
    }
    throw e;
  }
}

export async function readRunPolicyFromManifest(args: {
  manifest_path: string;
  manifest: Record<string, unknown>;
}): Promise<ResolvedRunPolicy> {
  const artifacts = getManifestArtifacts(args.manifest);
  const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(args.manifest_path));
  return readRunPolicyForRunRoot(runRoot);
}
