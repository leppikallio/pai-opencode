#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import type { Type } from "cmd-ts";
import {
  runSafely,
  subcommands,
} from "cmd-ts";

import {
  fixture_bundle_capture,
  manifest_write,
  orchestrator_tick_fixture,
  orchestrator_tick_live,
  orchestrator_tick_post_pivot,
  orchestrator_tick_post_summaries,
  type OrchestratorLiveRunAgentInput,
  type OrchestratorLiveRunAgentResult,
  type OrchestratorTickFixtureResult,
  type OrchestratorTickLiveResult,
  type OrchestratorTickPostPivotResult,
  type OrchestratorTickPostSummariesResult,
  perspectives_write,
  run_init,
  stage_advance,
  watchdog_check,
  wave1_plan,
} from "../tools/deep_research.ts";
import {
  resolveDeepResearchFlagsV1,
  sha256HexLowerUtf8,
} from "../tools/deep_research/lifecycle_lib";
import { sha256DigestForJson } from "../tools/deep_research/wave_tools_shared";
import { createAgentResultCmd } from "./deep-research-option-c/cmd/agent-result";
import { createCancelCmd } from "./deep-research-option-c/cmd/cancel";
import { createCaptureFixturesCmd } from "./deep-research-option-c/cmd/capture-fixtures";
import { createInitCmd } from "./deep-research-option-c/cmd/init";
import { createInspectCmd } from "./deep-research-option-c/cmd/inspect";
import { createPauseCmd } from "./deep-research-option-c/cmd/pause";
import { createPerspectivesDraftCmd } from "./deep-research-option-c/cmd/perspectives-draft";
import { createResumeCmd } from "./deep-research-option-c/cmd/resume";
import { createRerunCmd } from "./deep-research-option-c/cmd/rerun";
import { createRunCmd } from "./deep-research-option-c/cmd/run";
import { createStageAdvanceCmd } from "./deep-research-option-c/cmd/stage-advance";
import { createStatusCmd } from "./deep-research-option-c/cmd/status";
import { createTickCmd } from "./deep-research-option-c/cmd/tick";
import { createTriageCmd } from "./deep-research-option-c/cmd/triage";
import {
  configureStdoutForJsonMode,
  emitJson,
  getCliArgv,
  isJsonModeRequested,
} from "./deep-research-option-c/cli/json-mode";
import { emitContractCommandJson } from "./deep-research-option-c/cli/contract-json";
import {
  assertWithinRoot,
  isSafeSegment,
  normalizeOptional,
  requireAbsolutePath,
  safeResolveManifestPath,
} from "./deep-research-option-c/lib/paths";
import {
  asObject,
  readJsonObject,
} from "./deep-research-option-c/lib/io-json";
import {
  gateStatusesSummaryRecord,
  parseGateStatuses,
  printContract,
  readGateStatusesSummary,
  resolveGatesPathFromManifest,
  resolveLogsDirFromManifest,
  resolvePerspectivesPathFromManifest,
  resolveRunHandle,
  resolveRunRoot,
  summarizeManifest,
  withRunLock,
  type ManifestSummary,
} from "./deep-research-option-c/lib/run-handle";
import {
  resultErrorDetails,
  throwWithCode,
  throwWithCodeAndDetails,
  toolErrorDetails,
} from "./deep-research-option-c/cli/errors";
import {
  beginTickObservability,
  finalizeTickObservability,
} from "./deep-research-option-c/observability/tick-observability";
import { makeToolContext } from "./deep-research-option-c/runtime/tool-context";
import {
  callTool,
  parseToolEnvelope,
  type ToolEnvelope,
  type ToolWithExecute,
} from "./deep-research-option-c/runtime/tool-envelope";

type InitCliArgs = {
  query: string;
  runId?: string;
  runsRoot?: string;
  sensitivity: "normal" | "restricted" | "no_web";
  mode: "quick" | "standard" | "deep";
  writePerspectives: boolean;
  force: boolean;
  json?: boolean;
};

type RunHandleCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

type TickCliArgs = RunHandleCliArgs & {
  reason: string;
  driver: "fixture" | "live" | "task";
  json?: boolean;
};

type RunCliArgs = TickCliArgs & {
  maxTicks: number;
  until?: string;
};

type PauseResumeCliArgs = RunHandleCliArgs & {
  reason: string;
  json?: boolean;
};

type RunStatusInspectTriageCliArgs = RunHandleCliArgs & {
  json: boolean;
};

type StageAdvanceCliArgs = {
  manifest: string;
  gates?: string;
  requestedNext?: string;
  reason: string;
  json: boolean;
};

type PerspectivesDraftCliArgs = {
  manifest: string;
  reason: string;
  driver: "task";
  json: boolean;
};

type RerunWave1CliArgs = {
  manifest: string;
  perspective: string;
  reason: string;
};

type AgentResultCliArgs = {
  manifest: string;
  stage: "perspectives" | "wave1" | "wave2" | "summaries" | "synthesis";
  perspective: string;
  input: string;
  agentRunId: string;
  reason: string;
  force: boolean;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  json?: boolean;
};

type TaskDriverMissingPerspective = {
  perspectiveId: string;
  promptPath: string;
  outputPath: string;
  metaPath: string;
  promptDigest: string;
};

type PerspectivesDraftStatus = "awaiting_agent_results" | "merging" | "awaiting_human_review" | "promoted";

type PerspectivesDraftStateArtifactV1 = {
  schema_version: "perspectives-draft-state.v1";
  run_id: string;
  status: PerspectivesDraftStatus;
  policy_path: string;
  inputs_digest: string;
  draft_digest: string | null;
  promoted_digest: string | null;
};

type PerspectivesDraftMergeReportV1 = {
  schema_version: "perspectives-draft-merge-report.v1";
  run_id: string;
  generated_from: string[];
  candidate_count_in: number;
  candidate_count_out: number;
  review_required: boolean;
  dedupe_keys: string[];
};

type PerspectivesV1Payload = {
  schema_version: "perspectives.v1";
  run_id: string;
  created_at: string;
  perspectives: Array<{
    id: string;
    title: string;
    track: "standard" | "independent" | "contrarian";
    agent_type: string;
    prompt_contract: {
      max_words: number;
      max_sources: number;
      tool_budget: {
        search_calls: number;
        fetch_calls: number;
      };
      must_include_sections: string[];
    };
    platform_requirements: Array<{ name: string; reason: string }>;
    tool_policy: {
      primary: string[];
      secondary: string[];
      forbidden: string[];
    };
  }>;
};

type PerspectivesPolicyArtifactV1 = {
  schema_version: "perspectives-policy.v1";
  thresholds: {
    ensemble_threshold: 80;
    backup_threshold: 85;
    match_bonus: 10;
    mismatch_penalty: -25;
    threshold_operator: ">=";
    confidence: {
      type: "integer";
      min: 0;
      max: 100;
    };
  };
  track_allocation: {
    standard: 0.5;
    independent: 0.25;
    contrarian: 0.25;
    rounding: "largest_remainder_method";
  };
  partial_failure_policy: {
    mode: "fail_closed";
    on_partial_failure: "awaiting_agent_results";
  };
};

type TriageBlockers = {
  from: string;
  to: string;
  errorCode: string | null;
  errorMessage: string | null;
  missingArtifacts: Array<{ name: string; path: string | null }>;
  blockedGates: Array<{ gate: string; status: string | null }>;
  failedChecks: Array<{ kind: string; name: string }>;
  allowed: boolean;
};

type HaltRelatedPaths = {
  manifest_path: string;
  gates_path: string;
  retry_directives_path?: string;
  blocked_urls_path?: string;
  online_fixtures_latest_path?: string;
};

type HaltArtifactV1 = {
  schema_version: "halt.v1";
  created_at: string;
  run_id: string;
  run_root: string;
  tick_index: number;
  stage_current: string;
  blocked_transition: { from: string; to: string };
  error: { code: string; message: string; details?: Record<string, unknown> };
  blockers: {
    missing_artifacts: Array<{ name: string; path?: string }>;
    blocked_gates: Array<{ gate: string; status?: string }>;
    failed_checks: Array<{ kind: string; name: string }>;
  };
  related_paths: HaltRelatedPaths;
  next_commands: string[];
  notes: string;
};

type BlockedUrlsInspectSummary = {
  artifactPath: string;
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
};

type TickResult =
  | OrchestratorTickFixtureResult
  | OrchestratorTickLiveResult
  | OrchestratorTickPostPivotResult
  | OrchestratorTickPostSummariesResult;

const CLI_ARGV = getCliArgv();
const JSON_MODE_REQUESTED = isJsonModeRequested(CLI_ARGV);

function nextStepCliInvocation(): string {
  return 'bun "pai-tools/deep-research-option-c.ts"';
}

configureStdoutForJsonMode(JSON_MODE_REQUESTED);

function stableDigest(value: Record<string, unknown>): string {
  return `sha256:${sha256HexLowerUtf8(JSON.stringify(value))}`;
}

async function nextHaltTickIndex(haltDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(haltDir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return 1;
    throw error;
  }

  let maxTick = 0;
  for (const entry of entries) {
    const match = /^tick-(\d+)\.json$/u.exec(entry);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > maxTick) maxTick = value;
  }
  return maxTick + 1;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}
function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

async function writeCheckpoint(args: {
  logsDirAbs: string;
  filename: string;
  content: string;
}): Promise<string> {
  const outPath = path.join(args.logsDirAbs, args.filename);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${args.content.trim()}\n`, "utf8");
  return outPath;
}

function promptDigestFromPromptMarkdown(promptMd: string): string {
  return `sha256:${sha256HexLowerUtf8(promptMd)}`;
}

function normalizePromptDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^sha256:[a-f0-9]{64}$/u.test(trimmed)) return trimmed;
  if (/^[a-f0-9]{64}$/u.test(trimmed)) return `sha256:${trimmed}`;
  return null;
}

const PERSPECTIVES_DRAFT_SCHEMA_VERSION = "perspectives-draft-output.v1" as const;
const PERSPECTIVE_TRACKS = ["standard", "independent", "contrarian"] as const;
const PERSPECTIVE_DOMAINS = ["social_media", "academic", "technical", "multimodal", "security", "news", "unknown"] as const;

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

function normalizePerspectivesDraftOutputV1(args: {
  value: unknown;
  expectedRunId: string;
}): {
  schema_version: "perspectives-draft-output.v1";
  run_id: string;
  source: {
    agent_type: string;
    label: string;
  };
  candidates: Array<{
    title: string;
    questions: string[];
    track: "standard" | "independent" | "contrarian";
    recommended_agent_type: string;
    domain: "social_media" | "academic" | "technical" | "multimodal" | "security" | "news" | "unknown";
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
} {
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
      : (trackValue as "standard" | "independent" | "contrarian");
    if (!missingTrack && !PERSPECTIVE_TRACKS.includes(track)) {
      throwWithCode("PERSPECTIVES_DRAFT_SCHEMA_INVALID", `candidates[${index}].track must be standard|independent|contrarian`);
    }

    const domain = requireNonEmptyStringAt(candidate.domain, `candidates[${index}].domain`);
    if (!PERSPECTIVE_DOMAINS.includes(domain as (typeof PERSPECTIVE_DOMAINS)[number])) {
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
      domain: domain as "social_media" | "academic" | "technical" | "multimodal" | "security" | "news" | "unknown",
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

function buildPerspectivesDraftPromptMarkdown(args: {
  runId: string;
  queryText: string;
}): string {
  const query = args.queryText.trim() || "(query missing)";
  return [
    "# Perspectives Draft Request",
    "",
    `Run ID: ${args.runId}`,
    "Stage: perspectives",
    "",
    "## Query",
    query,
    "",
    "## Output Contract",
    "Return a single JSON object (no surrounding markdown) matching schema `perspectives-draft-output.v1`.",
    "",
    "Required shape:",
    "```json",
    "{",
    "  \"schema_version\": \"perspectives-draft-output.v1\",",
    "  \"run_id\": \"<run_id>\",",
    "  \"source\": { \"agent_type\": \"<agent_type>\", \"label\": \"<label>\" },",
    "  \"candidates\": [",
    "    {",
    "      \"title\": \"...\",",
    "      \"questions\": [\"...\"],",
    "      \"track\": \"standard|independent|contrarian\",",
    "      \"recommended_agent_type\": \"...\",",
    "      \"domain\": \"social_media|academic|technical|multimodal|security|news|unknown\",",
    "      \"confidence\": 0,",
    "      \"rationale\": \"...\",",
    "      \"platform_requirements\": [{ \"name\": \"...\", \"reason\": \"...\" }],",
    "      \"tool_policy\": {",
    "        \"primary\": [\"...\"],",
    "        \"secondary\": [\"...\"],",
    "        \"forbidden\": [\"...\"]",
    "      },",
    "      \"flags\": {",
    "        \"human_review_required\": false,",
    "        \"missing_platform_requirements\": false,",
    "        \"missing_tool_policy\": false",
    "      }",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Constraints:",
    "- confidence MUST be an integer 0..100",
    "- candidates must be mutually distinct and actionable",
  ].join("\n");
}

async function writeTaskDriverPerspectiveDraftPrompt(args: {
  runRoot: string;
  runId: string;
  queryText: string;
}): Promise<TaskDriverMissingPerspective> {
  const perspectiveId = "primary";
  const promptPath = path.join(args.runRoot, "operator", "prompts", "perspectives", `${perspectiveId}.md`);
  const outputPath = path.join(args.runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.json`);
  const metaPath = path.join(args.runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.meta.json`);

  const promptMd = buildPerspectivesDraftPromptMarkdown({
    runId: args.runId,
    queryText: args.queryText,
  });
  const promptFileText = `${promptMd.trim()}\n`;
  const promptDigest = promptDigestFromPromptMarkdown(promptFileText);

  await fs.mkdir(path.dirname(promptPath), { recursive: true });
  await fs.writeFile(promptPath, promptFileText, "utf8");

  return {
    perspectiveId,
    promptPath,
    outputPath,
    metaPath,
    promptDigest,
  };
}

async function writeJsonFileIfChanged(filePath: string, payload: Record<string, unknown>): Promise<boolean> {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing === serialized) return false;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialized, "utf8");
  return true;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizePlatformRequirementEntry(requirement: { name: string; reason: string }): { name: string; reason: string } {
  return {
    name: normalizeWhitespace(requirement.name),
    reason: normalizeWhitespace(requirement.reason),
  };
}

function stableSortPlatformRequirements(requirements: Array<{ name: string; reason: string }>): Array<{ name: string; reason: string }> {
  const deduped = new Map<string, { name: string; reason: string }>();

  for (const requirement of requirements) {
    const normalized = normalizePlatformRequirementEntry(requirement);
    if (!normalized.name || !normalized.reason) continue;
    const key = `${normalized.name}\u0000${normalized.reason}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.reason.localeCompare(b.reason);
  });
}

function stableSortToolPolicyList(values: string[]): string[] {
  return Array.from(new Set(values
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0))).sort((a, b) => a.localeCompare(b));
}

function normalizeToolPolicyValue(value: { primary: string[]; secondary: string[]; forbidden: string[] }): {
  primary: string[];
  secondary: string[];
  forbidden: string[];
} {
  return {
    primary: stableSortToolPolicyList(value.primary),
    secondary: stableSortToolPolicyList(value.secondary),
    forbidden: stableSortToolPolicyList(value.forbidden),
  };
}

function mergeToolPolicyValues(
  current: { primary: string[]; secondary: string[]; forbidden: string[] },
  incoming: { primary: string[]; secondary: string[]; forbidden: string[] },
): { primary: string[]; secondary: string[]; forbidden: string[] } {
  return {
    primary: stableSortToolPolicyList([...current.primary, ...incoming.primary]),
    secondary: stableSortToolPolicyList([...current.secondary, ...incoming.secondary]),
    forbidden: stableSortToolPolicyList([...current.forbidden, ...incoming.forbidden]),
  };
}

function trackWeight(track: string): number {
  if (track === "standard") return 0;
  if (track === "independent") return 1;
  if (track === "contrarian") return 2;
  return 9;
}

function defaultWave1PromptContract() {
  return {
    max_words: 900,
    max_sources: 10,
    tool_budget: {
      search_calls: 3,
      fetch_calls: 4,
    },
    must_include_sections: ["Findings", "Sources", "Gaps"],
  };
}

async function listNormalizedPerspectivesDraftOutputs(args: {
  runRoot: string;
}): Promise<Array<{ fileName: string; absPath: string }>> {
  const dirPath = path.join(args.runRoot, "operator", "outputs", "perspectives");
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  const normalized = entries
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.endsWith(".meta.json"))
    .filter((name) => !name.endsWith(".raw.json"))
    .filter((name) => !name.endsWith(".input.json"))
    .filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name))
    .sort((a, b) => a.localeCompare(b));

  return normalized.map((fileName) => ({ fileName, absPath: path.join(dirPath, fileName) }));
}

async function buildPerspectivesDraftFromOutputs(args: {
  runId: string;
  runRoot: string;
  createdAt: string;
}): Promise<{
  perspectivesDoc: PerspectivesV1Payload;
  mergeReport: PerspectivesDraftMergeReportV1;
  draftDigest: string;
  reviewRequired: boolean;
}> {
  const sources = await listNormalizedPerspectivesDraftOutputs({ runRoot: args.runRoot });
  if (sources.length === 0) {
    throwWithCode("PERSPECTIVES_DRAFT_OUTPUTS_MISSING", "no normalized perspectives draft outputs found");
  }

  const allCandidates: Array<ReturnType<typeof normalizePerspectivesDraftOutputV1>["candidates"][number]> = [];
  for (const source of sources) {
    const raw = await readJsonObject(source.absPath);
    const normalized = normalizePerspectivesDraftOutputV1({ value: raw, expectedRunId: args.runId });
    allCandidates.push(...normalized.candidates);
  }

  const keys: string[] = [];
  const dedupedByKey = new Map<string, {
    title: string;
    questions: string[];
    track: "standard" | "independent" | "contrarian";
    recommended_agent_type: string;
    domain: string;
    platform_requirements: Array<{ name: string; reason: string }>;
    tool_policy: {
      primary: string[];
      secondary: string[];
      forbidden: string[];
    };
    flags: { human_review_required: boolean };
  }>();

  for (const candidate of allCandidates) {
    const title = normalizeWhitespace(candidate.title);
    const questions = candidate.questions.map((q) => normalizeWhitespace(q));
    const key = sha256HexLowerUtf8(`${candidate.track}\n${title}\n${questions.join("\n")}`);
    const candidatePlatformRequirements = stableSortPlatformRequirements(candidate.platform_requirements);
    const candidateToolPolicy = normalizeToolPolicyValue(candidate.tool_policy);
    keys.push(key);
    const existing = dedupedByKey.get(key);
    if (existing) {
      existing.platform_requirements = stableSortPlatformRequirements([
        ...existing.platform_requirements,
        ...candidatePlatformRequirements,
      ]);
      existing.tool_policy = mergeToolPolicyValues(existing.tool_policy, candidateToolPolicy);
      existing.flags.human_review_required = existing.flags.human_review_required
        || Boolean(candidate.flags?.human_review_required);
      continue;
    }

    dedupedByKey.set(key, {
      title,
      questions,
      track: candidate.track,
      recommended_agent_type: candidate.recommended_agent_type,
      domain: candidate.domain,
      platform_requirements: candidatePlatformRequirements,
      tool_policy: candidateToolPolicy,
      flags: { human_review_required: Boolean(candidate.flags?.human_review_required) },
    });
  }

  const merged = Array.from(dedupedByKey.values()).sort((a, b) => {
    const tw = trackWeight(a.track) - trackWeight(b.track);
    if (tw !== 0) return tw;
    const domainCmp = String(a.domain).localeCompare(String(b.domain));
    if (domainCmp !== 0) return domainCmp;
    return a.title.localeCompare(b.title);
  });

  const reviewRequired = merged.some((c) => c.flags.human_review_required);
  const contract = defaultWave1PromptContract();

  const perspectivesDoc: PerspectivesV1Payload = {
    schema_version: "perspectives.v1",
    run_id: args.runId,
    created_at: args.createdAt,
    perspectives: merged.map((item, idx) => ({
      id: `p${idx + 1}`,
      title: item.title,
      track: item.track,
      agent_type: item.recommended_agent_type,
      prompt_contract: contract,
      platform_requirements: item.platform_requirements,
      tool_policy: item.tool_policy,
    })),
  };

  const mergeReport: PerspectivesDraftMergeReportV1 = {
    schema_version: "perspectives-draft-merge-report.v1",
    run_id: args.runId,
    generated_from: sources.map((s) => s.fileName),
    candidate_count_in: allCandidates.length,
    candidate_count_out: merged.length,
    review_required: reviewRequired,
    dedupe_keys: Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b)),
  };

  const draftDigest = stableDigest(perspectivesDoc);
  return { perspectivesDoc, mergeReport, draftDigest, reviewRequired };
}

function buildDefaultPerspectivesPolicyArtifact(): PerspectivesPolicyArtifactV1 {
  return {
    schema_version: "perspectives-policy.v1",
    thresholds: {
      ensemble_threshold: 80,
      backup_threshold: 85,
      match_bonus: 10,
      mismatch_penalty: -25,
      threshold_operator: ">=",
      confidence: {
        type: "integer",
        min: 0,
        max: 100,
      },
    },
    track_allocation: {
      standard: 0.5,
      independent: 0.25,
      contrarian: 0.25,
      rounding: "largest_remainder_method",
    },
    partial_failure_policy: {
      mode: "fail_closed",
      on_partial_failure: "awaiting_agent_results",
    },
  };
}

async function writeDefaultPerspectivesPolicy(args: {
  runRoot: string;
}): Promise<{ policyPath: string; policyDigest: string; changed: boolean }> {
  const policyPath = path.join(args.runRoot, "operator", "config", "perspectives-policy.json");
  const policyArtifact = buildDefaultPerspectivesPolicyArtifact();
  const changed = await writeJsonFileIfChanged(policyPath, policyArtifact);
  return {
    policyPath,
    policyDigest: stableDigest(policyArtifact),
    changed,
  };
}

async function resolvePerspectivesDraftStatus(args: {
  runId: string;
  perspective: TaskDriverMissingPerspective;
}): Promise<{
  status: PerspectivesDraftStatus;
  outputExists: boolean;
  metaPromptDigest: string | null;
  promptDigestMatches: boolean;
  normalizedOutputValid: boolean;
  normalizedOutputErrorCode: string | null;
  normalizedOutputErrorMessage: string | null;
}> {
  const outputExists = await fileExists(args.perspective.outputPath);
  const metaPromptDigest = await readPromptDigestFromMeta(args.perspective.metaPath);
  const promptDigestMatches = metaPromptDigest === args.perspective.promptDigest;

  let normalizedOutputValid = false;
  let normalizedOutputErrorCode: string | null = null;
  let normalizedOutputErrorMessage: string | null = null;

  if (outputExists) {
    try {
      const output = await readJsonObject(args.perspective.outputPath);
      normalizePerspectivesDraftOutputV1({
        value: output,
        expectedRunId: args.runId,
      });
      normalizedOutputValid = true;
    } catch (error) {
      normalizedOutputValid = false;
      normalizedOutputErrorCode = typeof error === "object"
          && error !== null
          && typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code?: string }).code)
        : "PERSPECTIVES_OUTPUT_INVALID";
      normalizedOutputErrorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  const status: PerspectivesDraftStatus = outputExists && promptDigestMatches && normalizedOutputValid
    ? "merging"
    : "awaiting_agent_results";

  return {
    status,
    outputExists,
    metaPromptDigest,
    promptDigestMatches,
    normalizedOutputValid,
    normalizedOutputErrorCode,
    normalizedOutputErrorMessage,
  };
}

async function readWave1PlanEntries(args: {
  runRoot: string;
  manifest: Record<string, unknown>;
}): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave1PlanPath = path.join(args.runRoot, "wave-1", "wave1-plan.json");
  const wave1Plan = await readJsonObject(wave1PlanPath);

  const perspectivesPath = await resolvePerspectivesPathFromManifest(args.manifest);
  const perspectivesDoc = await readJsonObject(perspectivesPath);
  const expectedDigest = sha256DigestForJson(perspectivesDoc);
  const actualDigest = typeof wave1Plan.perspectives_digest === "string"
    ? wave1Plan.perspectives_digest.trim()
    : "";
  if (!actualDigest || actualDigest !== expectedDigest) {
    throwWithCodeAndDetails(
      "WAVE1_PLAN_STALE",
      "WAVE1_PLAN_STALE: wave1 plan perspectives digest mismatch",
      {
        plan_path: wave1PlanPath,
        perspectives_path: perspectivesPath,
        expected_digest: expectedDigest,
        actual_digest: actualDigest || null,
      },
    );
  }

  const entries = Array.isArray(wave1Plan.entries)
    ? (wave1Plan.entries as Array<unknown>)
    : [];
  const out: Array<{ perspectiveId: string; promptMd: string }> = [];

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    const perspectiveId = String(entry.perspective_id ?? "").trim();
    const promptMd = String(entry.prompt_md ?? "");
    if (!perspectiveId || !promptMd.trim()) continue;
    if (!isSafeSegment(perspectiveId)) continue;
    out.push({ perspectiveId, promptMd });
  }

  if (out.length === 0) {
    throw new Error(`wave1 plan has no valid entries (${wave1PlanPath})`);
  }
  return out;
}

async function readWave2PlanEntries(runRoot: string): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave2PlanPath = path.join(runRoot, "wave-2", "wave2-plan.json");
  const wave2Plan = await readJsonObject(wave2PlanPath);
  const entries = Array.isArray(wave2Plan.entries)
    ? (wave2Plan.entries as Array<unknown>)
    : [];
  const out: Array<{ perspectiveId: string; promptMd: string }> = [];

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    const perspectiveId = String(entry.perspective_id ?? "").trim();
    const promptMd = String(entry.prompt_md ?? "");
    if (!perspectiveId || !promptMd.trim()) continue;
    if (!isSafeSegment(perspectiveId)) continue;
    out.push({ perspectiveId, promptMd });
  }

  if (out.length === 0) {
    throw new Error(`wave2 plan has no valid entries (${wave2PlanPath})`);
  }
  return out;
}

async function sidecarPromptDigestMatches(metaPath: string, expectedPromptDigest: string): Promise<boolean> {
  const normalized = await readPromptDigestFromMeta(metaPath);
  return normalized === expectedPromptDigest;
}

async function readPromptDigestFromMeta(metaPath: string): Promise<string | null> {
  const exists = await fileExists(metaPath);
  if (!exists) return null;

  try {
    const metaRaw = await readJsonObject(metaPath);
    return normalizePromptDigest(metaRaw.prompt_digest);
  } catch {
    return null;
  }
}

async function collectTaskDriverMissingWave1Perspectives(args: {
  runRoot: string;
  manifest: Record<string, unknown>;
}): Promise<TaskDriverMissingPerspective[]> {
  const planEntries = await readWave1PlanEntries({
    runRoot: args.runRoot,
    manifest: args.manifest,
  });
  const missing: TaskDriverMissingPerspective[] = [];

  for (const entry of planEntries) {
    const outputPath = path.join(args.runRoot, "wave-1", `${entry.perspectiveId}.md`);
    const metaPath = path.join(args.runRoot, "wave-1", `${entry.perspectiveId}.meta.json`);
    const promptPath = path.join(args.runRoot, "operator", "prompts", "wave1", `${entry.perspectiveId}.md`);
    const promptDigest = promptDigestFromPromptMarkdown(entry.promptMd);

    const outputExists = await fileExists(outputPath);
    const digestMatches = outputExists
      && await sidecarPromptDigestMatches(metaPath, promptDigest);

    if (digestMatches) continue;

    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.writeFile(promptPath, `${entry.promptMd.trim()}\n`, "utf8");

    missing.push({
      perspectiveId: entry.perspectiveId,
      promptPath,
      outputPath,
      metaPath,
      promptDigest,
    });
  }

  return missing;
}

function buildTaskDriverNextCommands(args: {
  manifestPath: string;
  runRoot: string;
  stage: "wave1" | "wave2" | "summaries" | "synthesis";
  missing: TaskDriverMissingPerspective[];
}): string[] {
  const cli = nextStepCliInvocation();
  const agentResultCommands = args.missing.map((item) => {
    const inputPath = path.join(args.runRoot, "operator", "outputs", args.stage, `${item.perspectiveId}.md`);
    return `${cli} agent-result --manifest "${args.manifestPath}" --stage ${args.stage} --perspective "${item.perspectiveId}" --input "${inputPath}" --agent-run-id "<AGENT_RUN_ID>" --reason "operator: task driver ingest ${args.stage}/${item.perspectiveId}"`;
  });

  return [
    `${cli} inspect --manifest "${args.manifestPath}"`,
    ...agentResultCommands,
    `${cli} tick --manifest "${args.manifestPath}" --driver task --reason "resume ${args.stage} after agent-result ingestion"`,
  ];
}

function createTaskPromptOutDriver(): (
  input: OrchestratorLiveRunAgentInput,
) => Promise<OrchestratorLiveRunAgentResult> {
  return async (input: OrchestratorLiveRunAgentInput): Promise<OrchestratorLiveRunAgentResult> => {
    const runRoot = String(input.run_root ?? "").trim();
    const stage = String(input.stage ?? "").trim();
    const perspectiveId = String(input.perspective_id ?? "").trim();
    const promptMd = String(input.prompt_md ?? "");

    if (!runRoot || !path.isAbsolute(runRoot)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "run_root missing/invalid" } };
    }
    if (!stage || !perspectiveId || !isSafeSegment(stage) || !isSafeSegment(perspectiveId)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "stage/perspective_id missing or invalid" } };
    }
    if (!promptMd.trim()) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "prompt_md missing" } };
    }

    let runRootReal = runRoot;
    try {
      runRootReal = await fs.realpath(runRoot);
    } catch {
      // keep original root for downstream errors
    }

    const promptPath = path.resolve(runRootReal, "operator", "prompts", stage, `${perspectiveId}.md`);
    const rel = path.relative(runRootReal, promptPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return { markdown: "", error: { code: "PATH_TRAVERSAL", message: "prompt path escapes run root" } };
    }

    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.writeFile(promptPath, `${promptMd.trim()}\n`, "utf8");

    return {
      markdown: "",
      error: {
        code: "RUN_AGENT_REQUIRED",
        message: `agent-result required for ${stage}/${perspectiveId}`,
      },
    };
  };
}

function createOperatorInputDriver(): (
  input: OrchestratorLiveRunAgentInput,
) => Promise<OrchestratorLiveRunAgentResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const close = () => {
    try {
      rl.close();
    } catch {
      // best effort
    }
  };
  process.on("exit", close);
  process.on("SIGINT", () => {
    close();
    process.exit(130);
  });

  return async (input: OrchestratorLiveRunAgentInput): Promise<OrchestratorLiveRunAgentResult> => {
    const runRoot = String(input.run_root ?? "").trim();
    const stage = String(input.stage ?? "").trim();
    const perspectiveId = String(input.perspective_id ?? "").trim();
    const promptMd = String(input.prompt_md ?? "");

    if (!runRoot || !path.isAbsolute(runRoot)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "run_root missing/invalid" } };
    }
    if (!stage || !perspectiveId) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "stage/perspective_id missing" } };
    }
    if (!isSafeSegment(stage)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "stage contains unsafe characters" } };
    }
    if (!isSafeSegment(perspectiveId)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "perspective_id contains unsafe characters" } };
    }
    if (!promptMd.trim()) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "prompt_md missing" } };
    }

    let runRootReal = runRoot;
    try {
      runRootReal = await fs.realpath(runRoot);
    } catch {
      // keep as-is; downstream writes will fail with a useful error
    }

    const promptPath = path.resolve(runRootReal, "operator", "prompts", stage, `${perspectiveId}.md`);
    const draftPath = path.resolve(runRootReal, "operator", "drafts", stage, `${perspectiveId}.md`);

    const contained = (absPath: string): boolean => {
      const rel = path.relative(runRootReal, absPath);
      return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
    };

    if (!contained(promptPath) || !contained(draftPath)) {
      return { markdown: "", error: { code: "PATH_TRAVERSAL", message: "operator paths escape run root" } };
    }
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(promptPath, `${promptMd.trim()}\n`, "utf8");

    try {
      await fs.access(draftPath);
    } catch {
      const template = [
        "## Findings",
        "",
        "(Write your findings here.)",
        "",
        "## Sources",
        "- ",
        "",
        "## Gaps",
        "- ",
        "",
      ].join("\n");
      await fs.writeFile(draftPath, `${template}\n`, "utf8");
    }

    console.log("\n--- Operator input required ---");
    console.log(`stage: ${stage}`);
    console.log(`perspective_id: ${perspectiveId}`);
    console.log(`prompt_path: ${promptPath}`);
    console.log(`draft_path: ${draftPath}`);
    console.log("Edit the draft file (use the prompt as instructions), then press ENTER to continue.");

    await rl.question("");

    const draft = await fs.readFile(draftPath, "utf8");
    if (!draft.trim()) {
      return { markdown: "", error: { code: "RUN_AGENT_FAILED", message: "draft is empty" } };
    }
    return { markdown: draft };
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function blockersSummaryJson(triage: TriageBlockers): {
  missing_artifacts: Array<{ name: string; path: string | null }>;
  blocked_gates: Array<{ gate: string; status: string | null }>;
} {
  return {
    missing_artifacts: triage.missingArtifacts.map((item) => ({
      name: item.name,
      path: item.path,
    })),
    blocked_gates: triage.blockedGates.map((item) => ({
      gate: item.gate,
      status: item.status,
    })),
  };
}

function defaultPerspectivePayload(runId: string): Record<string, unknown> {
  return {
    schema_version: "perspectives.v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    perspectives: [
      {
        id: "p1",
        title: "Default synthesis perspective",
        track: "standard",
        agent_type: "ClaudeResearcher",
        prompt_contract: {
          max_words: 900,
          max_sources: 12,
          tool_budget: { search_calls: 4, fetch_calls: 6 },
          must_include_sections: ["Findings", "Sources", "Gaps"],
        },
        platform_requirements: [],
        tool_policy: {
          primary: [],
          secondary: [],
          forbidden: [],
        },
      },
    ],
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function citationModeFromSensitivity(sensitivity: string): "offline" | "online" | "dry_run" {
  if (sensitivity === "no_web") return "offline";
  if (sensitivity === "restricted") return "dry_run";
  return "online";
}

function readManifestDeepFlags(manifest: Record<string, unknown>): Record<string, unknown> {
  const query = asObject(manifest.query);
  const constraints = asObject(query.constraints);
  return asObject(constraints.deep_research_flags);
}

function timestampTokenFromIso(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\..*Z$/, "Z").replace("T", "T");
}

async function writeRunConfig(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  manifest: Record<string, unknown>;
}): Promise<string> {
  const flags = resolveDeepResearchFlagsV1();
  const limits = asObject(args.manifest.limits);
  const query = asObject(args.manifest.query);
  const effectiveSensitivity = String(query.sensitivity ?? "normal");
  const deepFlags = readManifestDeepFlags(args.manifest);

  const manifestBrightDataEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT);
  const manifestApifyEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_APIFY_ENDPOINT);
  const effectiveBrightDataEndpoint = (manifestBrightDataEndpoint ?? flags.citationsBrightDataEndpoint ?? "").trim();
  const effectiveApifyEndpoint = (manifestApifyEndpoint ?? flags.citationsApifyEndpoint ?? "").trim();
  const citationMode = citationModeFromSensitivity(effectiveSensitivity);

  const brightDataSource = manifestBrightDataEndpoint
    ? "manifest"
    : flags.citationsBrightDataEndpoint
      ? "settings"
      : "run-config";
  const apifySource = manifestApifyEndpoint
    ? "manifest"
    : flags.citationsApifyEndpoint
      ? "settings"
      : "run-config";

  const runConfig = {
    schema_version: "run_config.v1",
    run_id: args.runId,
    created_at: new Date().toISOString(),
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
    effective: {
      sensitivity: effectiveSensitivity,
      flags: {
        option_c_enabled: true,
        no_web: effectiveSensitivity === "no_web" || flags.noWeb,
        citation_validation_tier: flags.citationValidationTier,
      },
      citation_endpoints: {
        extract_urls: "deep_research_citations_extract_urls",
        normalize: "deep_research_citations_normalize",
        validate: "deep_research_citations_validate",
        render_md: "deep_research_citations_render_md",
      },
      citations: {
        mode: citationMode,
        endpoints: {
          brightdata: effectiveBrightDataEndpoint,
          apify: effectiveApifyEndpoint,
        },
        source: {
          mode: "manifest",
          endpoints: {
            brightdata: brightDataSource,
            apify: apifySource,
          },
          authority: "run-config",
        },
      },
      caps: {
        max_wave1_agents: Number(limits.max_wave1_agents ?? 0),
        max_wave2_agents: Number(limits.max_wave2_agents ?? 0),
        max_summary_kb: Number(limits.max_summary_kb ?? 0),
        max_total_summary_kb: Number(limits.max_total_summary_kb ?? 0),
        max_review_iterations: Number(limits.max_review_iterations ?? 0),
      },
      source: flags.source,
    },
  };

  const outPath = path.join(args.runRoot, "run-config.json");
  await fs.writeFile(outPath, `${JSON.stringify(runConfig, null, 2)}\n`, "utf8");
  return outPath;
}

async function collectWaveOutputs(absDir: string): Promise<Array<{ perspective_id: string; output_path: string }>> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return [];
  }

  const markdownFiles = entries.filter((entry) => entry.endsWith(".md") && !entry.startsWith("."));
  markdownFiles.sort();

  return markdownFiles.map((filename) => ({
    perspective_id: path.basename(filename, ".md"),
    output_path: path.join(absDir, filename),
  }));
}

async function defaultFixtureDriver(args: {
  stage: string;
  run_root: string;
}): Promise<{ wave_outputs: Array<{ perspective_id: string; output_path?: string }>; requested_next?: string }> {
  if (args.stage === "init") {
    return { wave_outputs: [], requested_next: "wave1" };
  }
  if (args.stage === "wave1") {
    return {
      wave_outputs: await collectWaveOutputs(path.join(args.run_root, "wave-1")),
      requested_next: "pivot",
    };
  }
  if (args.stage === "wave2") {
    return {
      wave_outputs: await collectWaveOutputs(path.join(args.run_root, "wave-2")),
      requested_next: "citations",
    };
  }
  if (args.stage === "citations") {
    return { wave_outputs: [], requested_next: "summaries" };
  }
  if (args.stage === "summaries") {
    return { wave_outputs: [], requested_next: "synthesis" };
  }
  if (args.stage === "synthesis") {
    return { wave_outputs: [], requested_next: "review" };
  }
  return { wave_outputs: [] };
}

async function readBlockedUrlsInspectSummary(runRoot: string): Promise<BlockedUrlsInspectSummary | null> {
  const blockedUrlsPath = path.join(runRoot, "citations", "blocked-urls.json");

  let raw: Record<string, unknown>;
  try {
    raw = await readJsonObject(blockedUrlsPath);
  } catch {
    return null;
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  const statusCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();

  for (const item of items) {
    const obj = asObject(item);
    const status = String(obj.status ?? "blocked").trim() || "blocked";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const action = String(obj.action ?? "").trim();
    if (action) {
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }
  }

  const byStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));

  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, 5);

  return {
    artifactPath: blockedUrlsPath,
    total: items.length,
    byStatus,
    topActions,
  };
}

async function stageAdvanceDryRun(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<ToolEnvelope> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dr-stage-advance-"));
  const tempManifest = path.join(tempDir, "manifest.json");
  const tempGates = path.join(tempDir, "gates.json");

  try {
    await fs.copyFile(args.manifestPath, tempManifest);
    await fs.copyFile(args.gatesPath, tempGates);
    const raw = await (stage_advance as unknown as ToolWithExecute).execute(
      {
        manifest_path: tempManifest,
        gates_path: tempGates,
        reason: args.reason,
      },
      makeToolContext(),
    );
    return parseToolEnvelope("stage_advance", raw);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function triageFromStageAdvanceResult(envelope: ToolEnvelope): TriageBlockers {
  const error = asObject(envelope.error);
  const errorDetails = asObject(error.details);
  const decision = asObject(errorDetails.decision);
  const evaluated = Array.isArray(decision.evaluated)
    ? (decision.evaluated as Array<Record<string, unknown>>)
    : [];

  const missingArtifacts: Array<{ name: string; path: string | null }> = [];
  const blockedGates: Array<{ gate: string; status: string | null }> = [];
  const failedChecks: Array<{ kind: string; name: string }> = [];

  for (const item of evaluated) {
    if (item.ok === true) continue;
    const kind = String(item.kind ?? "unknown");
    const name = String(item.name ?? "unknown");
    const details = asObject(item.details);

    if (kind === "artifact") {
      missingArtifacts.push({
        name,
        path: details.path == null ? null : String(details.path),
      });
      continue;
    }

    if (kind === "gate") {
      blockedGates.push({
        gate: String(details.gate ?? name),
        status: details.status == null ? null : String(details.status),
      });
      continue;
    }

    failedChecks.push({ kind, name });
  }

  if (envelope.ok === true) {
    return {
      from: String(envelope.from ?? ""),
      to: String(envelope.to ?? ""),
      errorCode: null,
      errorMessage: null,
      missingArtifacts,
      blockedGates,
      failedChecks,
      allowed: true,
    };
  }

  return {
    from: String(errorDetails.from ?? ""),
    to: String(errorDetails.to ?? ""),
    errorCode: error.code == null ? null : String(error.code),
    errorMessage: error.message == null ? null : String(error.message),
    missingArtifacts,
    blockedGates,
    failedChecks,
    allowed: false,
  };
}

function printBlockersSummary(triage: TriageBlockers): void {
  console.log("blockers.summary:");
  console.log(`  transition: ${triage.from || "?"} -> ${triage.to || "?"}`);

  if (triage.allowed) {
    console.log("  status: no transition blockers detected");
    console.log("  remediation: inspect tick error details for non-stage failures");
    return;
  }

  if (triage.errorCode || triage.errorMessage) {
    console.log(`  error: ${triage.errorCode ?? "UNKNOWN"} ${triage.errorMessage ?? ""}`.trim());
  }

  if (triage.missingArtifacts.length > 0) {
    console.log("  missing_artifacts:");
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  if (triage.blockedGates.length > 0) {
    console.log("  blocked_gates:");
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  if (triage.failedChecks.length > 0) {
    console.log("  failed_checks:");
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }

  console.log("  remediation: run inspect for full guidance and produce required artifacts/gate passes");
}

async function computeTriageBlockers(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<TriageBlockers | null> {
  try {
    const dryRun = await stageAdvanceDryRun({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.reason,
    });
    return triageFromStageAdvanceResult(dryRun);
  } catch {
    return null;
  }
}

async function resolveHaltRelatedPaths(args: {
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
}): Promise<HaltRelatedPaths> {
  const related: HaltRelatedPaths = {
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
  };

  const retryDirectivesPath = await safeResolveManifestPath(args.runRoot, "retry/retry-directives.json", "retry.retry_directives");
  if (await fileExists(retryDirectivesPath)) {
    related.retry_directives_path = retryDirectivesPath;
  }

  const blockedUrlsPath = await safeResolveManifestPath(args.runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  if (await fileExists(blockedUrlsPath)) {
    related.blocked_urls_path = blockedUrlsPath;
  }

  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(args.runRoot);
  if (latestOnlineFixturesPath) {
    related.online_fixtures_latest_path = latestOnlineFixturesPath;
  }

  return related;
}

function nextHaltCommands(args: {
  manifestPath: string;
  stageCurrent: string;
  tickIndex: number;
  nextCommandsOverride?: string[];
}): string[] {
  if (Array.isArray(args.nextCommandsOverride) && args.nextCommandsOverride.length > 0) {
    return args.nextCommandsOverride;
  }
  const cli = nextStepCliInvocation();
  return [
    `${cli} inspect --manifest "${args.manifestPath}"`,
    `${cli} triage --manifest "${args.manifestPath}"`,
    `${cli} tick --manifest "${args.manifestPath}" --driver fixture --reason "halt retry from ${args.stageCurrent} (halt_tick_${args.tickIndex})"`,
  ];
}

async function writeHaltArtifact(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  stageCurrent: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  triage: TriageBlockers | null;
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number }> {
  const haltDir = path.join(args.runRoot, "operator", "halt");
  await fs.mkdir(haltDir, { recursive: true });

  const tickIndex = await nextHaltTickIndex(haltDir);
  const padded = String(tickIndex).padStart(4, "0");
  const tickPath = path.join(haltDir, `tick-${padded}.json`);
  const latestPath = path.join(haltDir, "latest.json");
  const relatedPaths = await resolveHaltRelatedPaths({
    runRoot: args.runRoot,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
  });

  const triage = args.triage;
  const artifact: HaltArtifactV1 = {
    schema_version: "halt.v1",
    created_at: nowIso(),
    run_id: args.runId,
    run_root: args.runRoot,
    tick_index: tickIndex,
    stage_current: args.stageCurrent,
    blocked_transition: {
      from: triage?.from || args.stageCurrent,
      to: triage?.to || args.stageCurrent,
    },
    error: {
      code: args.error.code,
      message: args.error.message,
      ...(args.error.details ? { details: args.error.details } : {}),
    },
    blockers: {
      missing_artifacts: (triage?.missingArtifacts ?? []).map((item) => ({
        name: item.name,
        ...(item.path ? { path: item.path } : {}),
      })),
      blocked_gates: (triage?.blockedGates ?? []).map((item) => ({
        gate: item.gate,
        ...(item.status ? { status: item.status } : {}),
      })),
      failed_checks: (triage?.failedChecks ?? []).map((item) => ({
        kind: item.kind,
        name: item.name,
      })),
    },
    related_paths: relatedPaths,
    next_commands: nextHaltCommands({
      manifestPath: args.manifestPath,
      stageCurrent: args.stageCurrent,
      tickIndex,
      nextCommandsOverride: args.nextCommandsOverride,
    }),
    notes: `Tick failure captured by operator CLI (${args.reason})`,
  };

  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await fs.writeFile(tickPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");

  return { tickPath, latestPath, tickIndex };
}

async function writeHaltArtifactForFailure(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; triage: TriageBlockers | null }> {
  const triage = await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: `${args.reason} [halt_triage]`,
  });

  const halt = await writeHaltArtifact({
    runRoot: args.runRoot,
    runId: args.runId,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    stageCurrent: args.stageCurrent,
    reason: args.reason,
    error: args.error,
    triage,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  return { ...halt, triage };
}

async function printAutoTriage(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  triage?: TriageBlockers | null;
}): Promise<void> {
  const triage = args.triage ?? await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
  });

  if (triage) {
    printBlockersSummary(triage);
    return;
  }

  console.log("blockers.summary:");
  console.log("  unavailable: stage_advance dry-run failed");
}

async function printHaltArtifactSummary(args: {
  tickPath: string;
  latestPath: string;
  tickIndex: number;
}): Promise<void> {
  console.log(`halt.tick_index: ${args.tickIndex}`);
  console.log(`halt.path: ${args.tickPath}`);
  console.log(`halt.latest_path: ${args.latestPath}`);
}

async function handleTickFailureArtifacts(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  triageReason: string;
  nextCommandsOverride?: string[];
  emitLogs?: boolean;
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; triage: TriageBlockers | null }> {
  const halt = await writeHaltArtifactForFailure({
    runRoot: args.runRoot,
    runId: args.runId,
    stageCurrent: args.stageCurrent,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
    error: args.error,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  if (args.emitLogs !== false) {
    await printHaltArtifactSummary(halt);
    await printAutoTriage({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.triageReason,
      triage: halt.triage,
    });
  }

  return halt;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonObject(filePath);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function resolveLatestOnlineFixtures(runRoot: string): Promise<string | null> {
  const latestPointerPath = await safeResolveManifestPath(
    runRoot,
    "citations/online-fixtures.latest.json",
    "citations.online_fixtures.latest",
  );
  const latestPointer = await readJsonIfExists(latestPointerPath);
  if (latestPointer) {
    const candidateRaw = String(latestPointer.path ?? latestPointer.latest_path ?? "").trim();
    if (candidateRaw) {
      return await safeResolveManifestPath(runRoot, candidateRaw, "citations.online_fixtures.path");
    }
    return latestPointerPath;
  }

  const citationsDir = await safeResolveManifestPath(runRoot, "citations", "citations.dir");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(citationsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => /^online-fixtures\.[^.]+\.json$/u.test(entry))
    .sort();
  if (candidates.length === 0) return null;
  return path.join(citationsDir, candidates[candidates.length - 1]);
}

async function printInspectOperatorGuidance(runRoot: string): Promise<void> {
  const blockedUrlsPath = await safeResolveManifestPath(runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  const retryDirectivesPath = await safeResolveManifestPath(runRoot, "retry/retry-directives.json", "retry.retry_directives");

  const blockedUrls = await readJsonIfExists(blockedUrlsPath);
  const retryDirectives = await readJsonIfExists(retryDirectivesPath);
  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(runRoot);

  if (blockedUrls) {
    const items = Array.isArray(blockedUrls.items) ? blockedUrls.items : [];
    console.log("citations.blocked_urls:");
    console.log(`  path: ${blockedUrlsPath}`);
    console.log(`  count: ${items.length}`);
    for (const raw of items.slice(0, 5)) {
      const item = asObject(raw);
      console.log(`  - ${String(item.url ?? item.normalized_url ?? "unknown")}`);
      console.log(`    action: ${String(item.action ?? "review citation access path")}`);
    }
    if (items.length > 0) {
      console.log("  next: replace blocked URLs or add acceptable sources, then re-run citations stage");
    }
  }

  if (retryDirectives) {
    const directives = Array.isArray(retryDirectives.retry_directives) ? retryDirectives.retry_directives : [];
    const consumedAt = String(retryDirectives.consumed_at ?? "").trim();
    console.log("retry.directives:");
    console.log(`  path: ${retryDirectivesPath}`);
    console.log(`  count: ${directives.length}`);
    if (consumedAt) {
      console.log(`  consumed_at: ${consumedAt}`);
    } else if (directives.length > 0) {
      console.log("  next: apply retry directives and run tick again");
    }
  }

  if (latestOnlineFixturesPath) {
    console.log("citations.online_fixtures_latest:");
    console.log(`  path: ${latestOnlineFixturesPath}`);
    console.log("  next: use this fixture for deterministic replay/debug");
  }
}

async function runInit(args: InitCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const rootOverride = normalizeOptional(args.runsRoot);
  const init = await callTool("run_init", run_init as unknown as ToolWithExecute, {
    query: args.query,
    mode: args.mode,
    sensitivity: args.sensitivity,
    run_id: args.runId,
    ...(rootOverride ? { root_override: requireAbsolutePath(rootOverride, "--runs-root") } : {}),
  });

  const runId = String(init.run_id ?? "").trim();
  const runRoot = requireAbsolutePath(String(init.root ?? ""), "run_init root");
  const manifestPath = requireAbsolutePath(String(init.manifest_path ?? ""), "run_init manifest_path");
  const gatesPath = requireAbsolutePath(String(init.gates_path ?? ""), "run_init gates_path");

  const created = Boolean(init.created);
  const notes: string[] = [];
  let perspectivesPathOut: string | null = null;
  let wave1PlanPathOut: string | null = null;

  if (!created) {
    // Defensive: when reusing an existing run_id, ensure the run root in the manifest
    // matches what run_init resolved. This prevents accidental cross-root reuse.
    const existingManifest = await readJsonObject(manifestPath);
    const manifestRunRoot = resolveRunRoot(existingManifest);
    let expected = runRoot;
    let actual = manifestRunRoot;
    try {
      expected = await fs.realpath(runRoot);
    } catch {
      // best effort only
    }
    try {
      actual = await fs.realpath(manifestRunRoot);
    } catch {
      // best effort only
    }
    if (path.resolve(expected) !== path.resolve(actual)) {
      throw new Error(
        `manifest.artifacts.root mismatch for existing run (expected ${expected}, actual ${actual})`,
      );
    }
  }

  if (args.writePerspectives) {
    const perspectivesPath = path.join(runRoot, "perspectives.json");
    perspectivesPathOut = perspectivesPath;
    const perspectivesExists = await fs.stat(perspectivesPath).then(() => true).catch(() => false);

    if (!perspectivesExists || args.force || created) {
      await callTool("perspectives_write", perspectives_write as unknown as ToolWithExecute, {
        perspectives_path: perspectivesPath,
        value: defaultPerspectivePayload(runId),
        reason: created
          ? "operator-cli init: default perspectives (new run)"
          : (args.force ? "operator-cli init: default perspectives (forced overwrite)" : "operator-cli init: default perspectives (missing file)"),
      });
    } else {
      const message = "existing perspectives preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`perspectives.note: ${message}`);
      }
    }
    if (!args.json) {
      console.log(`perspectives_path: ${perspectivesPath}`);
    }

    // wave1_plan writes a new artifact with a generated_at timestamp; only create it
    // when missing/new, or when forced.
    const wave1PlanPath = path.join(runRoot, "wave-1", "wave1-plan.json");
    const wave1PlanExists = await fs.stat(wave1PlanPath).then(() => true).catch(() => false);

    if (!wave1PlanExists || args.force || created) {
      const wave1Plan = await callTool("wave1_plan", wave1_plan as unknown as ToolWithExecute, {
        manifest_path: manifestPath,
        reason: created
          ? "operator-cli init: deterministic wave1 plan (new run)"
          : (args.force ? "operator-cli init: deterministic wave1 plan (forced overwrite)" : "operator-cli init: deterministic wave1 plan (missing file)"),
      });

      const produced = String(wave1Plan.plan_path ?? "").trim();
      if (!produced || !path.isAbsolute(produced)) {
        throw new Error("wave1_plan returned invalid plan_path");
      }
      wave1PlanPathOut = produced;
      if (!args.json) {
        console.log(`wave1_plan_path: ${produced}`);
      }
    } else {
      wave1PlanPathOut = wave1PlanPath;
      const message = "existing plan preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`wave1_plan_path: ${wave1PlanPath}`);
        console.log(`wave1_plan.note: ${message}`);
      }
    }

    // Resume-safe: if this run is already in wave1, do not attempt a redundant stage_advance.
    // But if a run exists in init, it's still reasonable to advance to wave1.
    const preStageManifest = await readJsonObject(manifestPath);
    const preStage = asObject(preStageManifest.stage);
    const preCurrent = String(preStage.current ?? "").trim();
    if (preCurrent === "init") {
      const stageAdvance = await callTool(
        "stage_advance:init->wave1",
        stage_advance as unknown as ToolWithExecute,
        {
          manifest_path: manifestPath,
          gates_path: gatesPath,
          requested_next: "wave1",
          reason: created
            ? "operator-cli init: deterministic init->wave1 (new run)"
            : "operator-cli init: deterministic init->wave1 (resume)",
        },
      );

      if (String(stageAdvance.from ?? "") !== "init" || String(stageAdvance.to ?? "") !== "wave1") {
        throw new Error("stage_advance init->wave1 returned unexpected transition");
      }
    }
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runConfigPath = await writeRunConfig({
    runRoot,
    runId,
    manifestPath,
    gatesPath,
    manifest,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "init",
      run_id: runId,
      run_root: runRoot,
      manifest_path: manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      run_config_path: runConfigPath,
      perspectives_path: perspectivesPathOut,
      wave1_plan_path: wave1PlanPathOut,
      notes,
    });
    return;
  }

  printContract({
    runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log(`run_config_path: ${runConfigPath}`);
}

async function runOneOrchestratorTick(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  driver: "fixture" | "live" | "task";
  stageHint?: string;
  liveDriver?: ReturnType<typeof createOperatorInputDriver> | null;
}): Promise<TickResult> {
  if (args.driver === "fixture") {
    return await orchestrator_tick_fixture({
      manifest_path: args.manifestPath,
      gates_path: args.gatesPath,
      reason: args.reason,
      fixture_driver: ({ stage, run_root }) => defaultFixtureDriver({ stage, run_root }),
      tool_context: makeToolContext(),
    });
  }

  const stage = args.stageHint ?? (await summarizeManifest(await readJsonObject(args.manifestPath))).stageCurrent;
  if (stage === "perspectives") {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "stage perspectives requires explicit drafting flow before tick",
        details: {
          stage,
          required_action: "stage-advance --requested-next wave1 after perspectives are finalized",
        },
      },
    } as TickResult;
  }
  if (stage === "init" || stage === "wave1") {
    if (!args.liveDriver) throw new Error("internal: live driver missing");
    return await orchestrator_tick_live({
      manifest_path: args.manifestPath,
      gates_path: args.gatesPath,
      reason: args.reason,
      drivers: { runAgent: args.liveDriver },
      tool_context: makeToolContext(),
    });
  }

  if (stage === "pivot" || stage === "wave2" || stage === "citations") {
    return await orchestrator_tick_post_pivot({
      manifest_path: args.manifestPath,
      gates_path: args.gatesPath,
      reason: args.reason,
      driver: args.driver,
      tool_context: makeToolContext(),
    });
  }

  return await orchestrator_tick_post_summaries({
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
    reason: args.reason,
    driver: args.driver,
    tool_context: makeToolContext(),
  });
}

function printTickResult(driver: "fixture" | "live" | "task", result: TickResult): void {
  console.log(`tick.driver: ${driver}`);
  if (!result.ok) {
    console.log("tick.ok: false");
    console.log(`tick.error.code: ${result.error.code}`);
    console.log(`tick.error.message: ${result.error.message}`);
    console.log(`tick.error.details: ${JSON.stringify(result.error.details ?? {}, null, 2)}`);
    return;
  }

  console.log("tick.ok: true");
  console.log(`tick.from: ${String(result.from ?? "")}`);
  console.log(`tick.to: ${String(result.to ?? "")}`);
  if ("wave_outputs_count" in result && typeof result.wave_outputs_count === "number") {
    console.log(`tick.wave_outputs_count: ${result.wave_outputs_count}`);
  }
}

async function runTick(args: TickCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const liveDriver = args.driver === "fixture"
    ? null
    : (args.driver === "live" ? createOperatorInputDriver() : createTaskPromptOutDriver());
  if (args.driver === "live" || args.driver === "task") {
    await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [pre_tick]`,
    });
  }

  const context = await beginTickObservability({
    manifestPath: runHandle.manifestPath,
    gatesPath: runHandle.gatesPath,
    reason: args.reason,
  });

  let result: TickResult;
  let toolFailure: { code: string; message: string } | null = null;
  let haltNextCommandsOverride: string[] | undefined;
  try {
    if (args.driver === "task" && context.stageBefore === "wave1") {
      const missing = await collectTaskDriverMissingWave1Perspectives({
        runRoot: context.runRoot,
        manifest: runHandle.manifest,
      });

      if (missing.length > 0) {
        haltNextCommandsOverride = buildTaskDriverNextCommands({
          manifestPath: runHandle.manifestPath,
          runRoot: context.runRoot,
          stage: "wave1",
          missing,
        });

        result = {
          ok: false,
          error: {
            code: "RUN_AGENT_REQUIRED",
            message: "Wave 1 requires external agent results via agent-result",
            details: {
              stage: "wave1",
              missing_count: missing.length,
              missing_perspectives: missing.map((item) => ({
                perspective_id: item.perspectiveId,
                prompt_path: item.promptPath,
                output_path: item.outputPath,
                meta_path: item.metaPath,
                prompt_digest: item.promptDigest,
              })),
            },
          },
        } as TickResult;
      } else {
        result = await runOneOrchestratorTick({
          manifestPath: runHandle.manifestPath,
          gatesPath: runHandle.gatesPath,
          reason: args.reason,
          driver: args.driver,
          stageHint: context.stageBefore,
          liveDriver,
        });
      }
    } else {
      result = await runOneOrchestratorTick({
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: args.reason,
        driver: args.driver,
        stageHint: context.stageBefore,
        liveDriver,
      });
    }

    if (
      args.driver === "task"
      && !result.ok
      && String(result.error?.code ?? "") === "RUN_AGENT_REQUIRED"
    ) {
      const details = (result.error?.details && typeof result.error.details === "object" && !Array.isArray(result.error.details))
        ? (result.error.details as Record<string, unknown>)
        : {};
      const missingStage = String(details.stage ?? "");
      if (missingStage === "wave2" || missingStage === "summaries" || missingStage === "synthesis") {
        const missingRaw = Array.isArray(details.missing_perspectives)
          ? (details.missing_perspectives as Array<unknown>)
          : [];
        const missing: TaskDriverMissingPerspective[] = [];
        for (const itemRaw of missingRaw) {
          if (!itemRaw || typeof itemRaw !== "object" || Array.isArray(itemRaw)) continue;
          const item = itemRaw as Record<string, unknown>;
          const perspectiveId = String(item.perspective_id ?? "").trim();
          const promptPath = String(item.prompt_path ?? "").trim();
          const outputPath = String(item.output_path ?? "").trim();
          const metaPath = String(item.meta_path ?? "").trim();
          const promptDigest = String(item.prompt_digest ?? "").trim();
          if (!isSafeSegment(perspectiveId)) continue;
          if (!promptPath || !outputPath || !metaPath || !promptDigest) continue;
          missing.push({
            perspectiveId,
            promptPath,
            outputPath,
            metaPath,
            promptDigest,
          });
        }

        if (missing.length > 0) {
          haltNextCommandsOverride = buildTaskDriverNextCommands({
            manifestPath: runHandle.manifestPath,
            runRoot: context.runRoot,
            stage: missingStage as "wave2" | "summaries" | "synthesis",
            missing,
          });
        }
      }
    }
  } catch (error) {
    const codedError = error as { code?: unknown; details?: unknown; message?: unknown };
    if (typeof codedError?.code === "string") {
      toolFailure = {
        code: codedError.code,
        message: error instanceof Error
          ? error.message
          : String(codedError.message ?? error),
      };
      const details = codedError.details && typeof codedError.details === "object" && !Array.isArray(codedError.details)
        ? (codedError.details as Record<string, unknown>)
        : {};
      result = {
        ok: false,
        error: {
          code: toolFailure.code,
          message: toolFailure.message,
          details,
        },
      } as TickResult;
      // keep original control-flow for telemetry + halt artifact handling below.
    } else {
      toolFailure = toolErrorDetails(error);
      result = {
        ok: false,
        error: {
          code: toolFailure.code,
          message: toolFailure.message,
          details: {},
        },
      } as TickResult;
    }
  }

  await finalizeTickObservability({
    context,
    tickResult: result,
    reason: args.reason,
    toolError: toolFailure,
  });

  if (!args.json) {
    printTickResult(args.driver, result);
  }

  let haltArtifact: { tickPath: string; latestPath: string; tickIndex: number; triage: TriageBlockers | null } | null = null;

  if (!result.ok) {
    const tickError = resultErrorDetails(result) ?? {
      code: "UNKNOWN",
      message: "tick failed",
    };
    haltArtifact = await handleTickFailureArtifacts({
      runRoot: context.runRoot,
      runId: context.runId,
      stageCurrent: context.stageBefore,
      manifestPath: runHandle.manifestPath,
      gatesPath: runHandle.gatesPath,
      reason: `operator-cli tick failure: ${args.reason}`,
      error: tickError,
      triageReason: `operator-cli tick auto-triage: ${args.reason}`,
      nextCommandsOverride: haltNextCommandsOverride,
      emitLogs: !args.json,
    });
  }

  if (args.driver === "live" || args.driver === "task") {
    await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [post_tick]`,
    });
  }

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    const tickPayload: Record<string, unknown> = result.ok
      ? {
        ok: true,
        from: String(result.from ?? ""),
        to: String(result.to ?? ""),
      }
      : {
        ok: false,
        error: {
          code: String(result.error.code ?? "UNKNOWN"),
          message: String(result.error.message ?? "tick failed"),
          details: result.error.details ?? {},
        },
      };
    if ("wave_outputs_count" in result && typeof result.wave_outputs_count === "number") {
      tickPayload.wave_outputs_count = result.wave_outputs_count;
    }

    emitJson({
      ok: result.ok,
      command: "tick",
      driver: args.driver,
      tick: tickPayload,
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      halt: haltArtifact
        ? {
          tick_index: haltArtifact.tickIndex,
          tick_path: haltArtifact.tickPath,
          latest_path: haltArtifact.latestPath,
          blockers_summary: haltArtifact.triage ? blockersSummaryJson(haltArtifact.triage) : null,
        }
        : null,
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runPerspectivesDraft(args: PerspectivesDraftCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  if (args.driver !== "task") {
    throw new Error(`perspectives-draft currently supports --driver task only (found ${args.driver})`);
  }
  const runHandle = await resolveRunHandle({ manifest: args.manifest });
  const summary = await summarizeManifest(runHandle.manifest);

  if (summary.stageCurrent !== "perspectives") {
    throw new Error(`perspectives-draft requires stage.current=perspectives (found ${summary.stageCurrent})`);
  }

  const query = asObject(runHandle.manifest.query);
  const queryText = String(query.text ?? "");

  const missingPerspective = await writeTaskDriverPerspectiveDraftPrompt({
    runRoot: summary.runRoot,
    runId: summary.runId,
    queryText,
  });

  const statusResolution = await resolvePerspectivesDraftStatus({
    runId: summary.runId,
    perspective: missingPerspective,
  });

  const policyWrite = await writeDefaultPerspectivesPolicy({
    runRoot: summary.runRoot,
  });

  const statePath = path.join(summary.runRoot, "operator", "state", "perspectives-state.json");
  const stateInputsDigest = stableDigest({
    schema: "perspectives-draft-state.inputs.v1",
    run_id: summary.runId,
    perspective_id: missingPerspective.perspectiveId,
    prompt_digest: missingPerspective.promptDigest,
    output_exists: statusResolution.outputExists,
    meta_prompt_digest: statusResolution.metaPromptDigest,
    prompt_digest_matches: statusResolution.promptDigestMatches,
    normalized_output_valid: statusResolution.normalizedOutputValid,
    policy_path: policyWrite.policyPath,
    policy_digest: policyWrite.policyDigest,
  });
  let stateArtifact: PerspectivesDraftStateArtifactV1 = {
    schema_version: "perspectives-draft-state.v1",
    run_id: summary.runId,
    status: statusResolution.status,
    policy_path: policyWrite.policyPath,
    inputs_digest: stateInputsDigest,
    draft_digest: null,
    promoted_digest: null,
  };

  // If outputs are present+valid, deterministically merge and (optionally) promote.
  if (statusResolution.status === "merging") {
    const createdAt = String(runHandle.manifest.created_at ?? "").trim()
      || String((asObject(runHandle.manifest.stage).started_at ?? "")).trim();
    if (!createdAt) {
      throwWithCode("PERSPECTIVES_CREATED_AT_MISSING", "manifest.created_at is missing; cannot promote perspectives deterministically");
    }

    const draftBuild = await buildPerspectivesDraftFromOutputs({
      runId: summary.runId,
      runRoot: summary.runRoot,
      createdAt,
    });

    const draftPath = path.join(summary.runRoot, "operator", "drafts", "perspectives.draft.json");
    const mergeReportPath = path.join(summary.runRoot, "operator", "drafts", "perspectives.merge-report.json");

    stateArtifact = {
      ...stateArtifact,
      status: draftBuild.reviewRequired ? "awaiting_human_review" : "merging",
      draft_digest: draftBuild.draftDigest,
    };

    await withRunLock({
      runRoot: summary.runRoot,
      reason: `operator-cli perspectives-draft merge: ${args.reason}`,
      fn: async () => {
        await writeJsonFileIfChanged(draftPath, draftBuild.perspectivesDoc as unknown as Record<string, unknown>);
        await writeJsonFileIfChanged(mergeReportPath, draftBuild.mergeReport as unknown as Record<string, unknown>);
        await writeJsonFileIfChanged(statePath, stateArtifact);
      },
    });

    if (draftBuild.reviewRequired) {
      const halt = await writeHaltArtifactForFailure({
        runRoot: summary.runRoot,
        runId: summary.runId,
        stageCurrent: summary.stageCurrent,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        reason: `operator-cli perspectives-draft: ${args.reason}`,
        error: {
          code: "HUMAN_REVIEW_REQUIRED",
          message: "Perspectives draft requires human review before promotion",
          details: {
            stage: "perspectives",
            status: "awaiting_human_review",
            state_path: statePath,
            policy_path: policyWrite.policyPath,
            draft_path: draftPath,
            merge_report_path: mergeReportPath,
            draft_digest: draftBuild.draftDigest,
          },
        },
        nextCommandsOverride: [
          `${nextStepCliInvocation()} inspect --manifest "${runHandle.manifestPath}"`,
          `# Edit draft then rerun perspectives-draft: ${draftPath}`,
          `${nextStepCliInvocation()} perspectives-draft --manifest "${runHandle.manifestPath}" --reason "approve perspectives draft" --driver task`,
        ],
      });

      if (args.json) {
        emitJson({
          ok: false,
          command: "perspectives-draft",
          driver: args.driver,
          run_id: summary.runId,
          run_root: summary.runRoot,
          manifest_path: runHandle.manifestPath,
          gates_path: summary.gatesPath,
          stage_current: summary.stageCurrent,
          status: summary.status,
          error: {
            code: "HUMAN_REVIEW_REQUIRED",
            message: "Perspectives draft requires human review before promotion",
            details: {
              draft_path: draftPath,
              merge_report_path: mergeReportPath,
              state_path: statePath,
              draft_digest: draftBuild.draftDigest,
            },
          },
          state_path: statePath,
          halt: {
            tick_index: halt.tickIndex,
            tick_path: halt.tickPath,
            latest_path: halt.latestPath,
          },
        });
        return;
      }

      printContract({
        runId: summary.runId,
        runRoot: summary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        stageCurrent: summary.stageCurrent,
        status: summary.status,
      });
      console.log("perspectives_draft.ok: false");
      console.log("perspectives_draft.error.code: HUMAN_REVIEW_REQUIRED");
      console.log(`perspectives_draft.draft_path: ${draftPath}`);
      console.log(`perspectives_draft.merge_report_path: ${mergeReportPath}`);
      await printHaltArtifactSummary(halt);
      return;
    }

    // Auto-promote (deterministic created_at) and advance to wave1.
    const perspectivesPath = path.join(summary.runRoot, "perspectives.json");
    await callTool("perspectives_write", perspectives_write as unknown as ToolWithExecute, {
      perspectives_path: perspectivesPath,
      value: draftBuild.perspectivesDoc as unknown as Record<string, unknown>,
      reason: `operator-cli perspectives-draft: promote perspectives (${args.reason})`,
    });

    const wave1Plan = await callTool("wave1_plan", wave1_plan as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `operator-cli perspectives-draft: regenerate wave1 plan (${args.reason})`,
    });

    await callTool("stage_advance", stage_advance as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      requested_next: "wave1",
      reason: `operator-cli perspectives-draft: enter wave1 (${args.reason})`,
    });

    stateArtifact = {
      ...stateArtifact,
      status: "promoted",
      promoted_digest: stableDigest(draftBuild.perspectivesDoc),
      draft_digest: draftBuild.draftDigest,
    };
    await writeJsonFileIfChanged(statePath, stateArtifact);

    const manifestAfter = await readJsonObject(runHandle.manifestPath);
    const afterSummary = await summarizeManifest(manifestAfter);
    const wave1PlanPath = String(wave1Plan.plan_path ?? "").trim();

    if (args.json) {
      emitJson({
        ok: true,
        command: "perspectives-draft",
        driver: args.driver,
        run_id: afterSummary.runId,
        run_root: afterSummary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: afterSummary.gatesPath,
        stage_current: afterSummary.stageCurrent,
        status: afterSummary.status,
        perspectives_path: perspectivesPath,
        wave1_plan_path: wave1PlanPath,
        state_path: statePath,
      });
      return;
    }

    printContract({
      runId: afterSummary.runId,
      runRoot: afterSummary.runRoot,
      manifestPath: runHandle.manifestPath,
      gatesPath: afterSummary.gatesPath,
      stageCurrent: afterSummary.stageCurrent,
      status: afterSummary.status,
    });
    console.log("perspectives_draft.ok: true");
    console.log(`perspectives_path: ${perspectivesPath}`);
    if (wave1PlanPath) console.log(`wave1_plan_path: ${wave1PlanPath}`);
    console.log(`perspectives_state_path: ${statePath}`);
    return;
  }

  await writeJsonFileIfChanged(statePath, stateArtifact);

  const errorCode = "RUN_AGENT_REQUIRED";
  const errorMessage = "Perspectives drafting requires external agent results via task driver";

  const errorDetails: Record<string, unknown> = {
    stage: "perspectives",
    status: statusResolution.status,
    state_path: statePath,
    prompt_path: missingPerspective.promptPath,
    output_path: missingPerspective.outputPath,
    meta_path: missingPerspective.metaPath,
    policy_path: policyWrite.policyPath,
    policy_digest: policyWrite.policyDigest,
    policy_changed: policyWrite.changed,
    prompt_digest: missingPerspective.promptDigest,
    checks: {
      output_exists: statusResolution.outputExists,
      meta_prompt_digest: statusResolution.metaPromptDigest,
      prompt_digest_matches: statusResolution.promptDigestMatches,
      normalized_output_valid: statusResolution.normalizedOutputValid,
    },
    ...(statusResolution.normalizedOutputErrorCode
      ? {
        normalized_output_error: {
          code: statusResolution.normalizedOutputErrorCode,
          message: statusResolution.normalizedOutputErrorMessage,
        },
      }
      : {}),
    missing_count: 1,
    missing_perspectives: [
      {
        perspective_id: missingPerspective.perspectiveId,
        prompt_path: missingPerspective.promptPath,
        output_path: missingPerspective.outputPath,
        meta_path: missingPerspective.metaPath,
        prompt_digest: missingPerspective.promptDigest,
      },
    ],
  };

  const nextCommands = [
    `${nextStepCliInvocation()} inspect --manifest "${runHandle.manifestPath}"`,
    `${nextStepCliInvocation()} agent-result --manifest "${runHandle.manifestPath}" --stage perspectives --perspective "${missingPerspective.perspectiveId}" --input "${path.join(summary.runRoot, "operator", "outputs", "perspectives", `${missingPerspective.perspectiveId}.raw.json`)}" --agent-run-id "<AGENT_RUN_ID>" --reason "operator: ingest perspectives/${missingPerspective.perspectiveId}"`,
    `${nextStepCliInvocation()} stage-advance --manifest "${runHandle.manifestPath}" --requested-next wave1 --reason "perspectives finalized (requires perspectives.json promotion)"`,
  ];

  const halt = await writeHaltArtifactForFailure({
    runRoot: summary.runRoot,
    runId: summary.runId,
    stageCurrent: summary.stageCurrent,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: `operator-cli perspectives-draft: ${args.reason}`,
    error: {
      code: errorCode,
      message: errorMessage,
      details: errorDetails,
    },
    nextCommandsOverride: nextCommands,
  });

  if (args.json) {
    emitJson({
      ok: false,
      command: "perspectives-draft",
      driver: args.driver,
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      error: {
        code: errorCode,
        message: errorMessage,
        details: errorDetails,
      },
      prompt_path: missingPerspective.promptPath,
      state_path: statePath,
      halt: {
        tick_index: halt.tickIndex,
        tick_path: halt.tickPath,
        latest_path: halt.latestPath,
      },
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("perspectives_draft.ok: false");
  console.log(`perspectives_draft.error.code: ${errorCode}`);
  console.log(`perspectives_draft.error.message: ${errorMessage}`);
  console.log(`perspectives_draft.status: ${statusResolution.status}`);
  console.log(`perspectives_draft.state_path: ${statePath}`);
  console.log(`perspectives_draft.prompt_path: ${missingPerspective.promptPath}`);
  console.log(`perspectives_draft.prompt_digest: ${missingPerspective.promptDigest}`);
  await printHaltArtifactSummary(halt);
}

async function runStageAdvance(args: StageAdvanceCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const runHandle = await resolveRunHandle({
    manifest: args.manifest,
    gates: args.gates,
  });

  const stageAdvance = await callTool("stage_advance", stage_advance as unknown as ToolWithExecute, {
    manifest_path: runHandle.manifestPath,
    gates_path: runHandle.gatesPath,
    ...(args.requestedNext ? { requested_next: args.requestedNext } : {}),
    reason: args.reason,
  });

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    emitJson({
      ok: true,
      command: "stage-advance",
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      from: String(stageAdvance.from ?? ""),
      to: String(stageAdvance.to ?? ""),
      manifest_revision: Number(stageAdvance.manifest_revision ?? Number.NaN),
      decision_inputs_digest: String((asObject(stageAdvance.decision).inputs_digest ?? "")),
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("stage_advance.ok: true");
  console.log(`stage_advance.from: ${String(stageAdvance.from ?? "")}`);
  console.log(`stage_advance.to: ${String(stageAdvance.to ?? "")}`);
  console.log(`stage_advance.manifest_revision: ${String(stageAdvance.manifest_revision ?? "")}`);
}

async function runStatus(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);
    emitContractCommandJson({
      command: "status",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary,
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runInspect(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gatesDoc = await readJsonObject(summary.gatesPath);
  const gateStatuses = parseGateStatuses(gatesDoc);
  const blockedUrlsSummary = await readBlockedUrlsInspectSummary(summary.runRoot);
  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli inspect: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  if (args.json) {
    emitContractCommandJson({
      command: "inspect",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary: gateStatusesSummaryRecord(gateStatuses),
      extra: {
        blockers_summary: blockersSummaryJson(triage),
      },
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });

  console.log("gate_statuses:");
  for (const gate of gateStatuses) {
    console.log(`  - ${gate.id}: ${gate.status}${gate.checked_at ? ` @ ${gate.checked_at}` : ""}`);
  }

  if (blockedUrlsSummary) {
    console.log("citations_blockers:");
    console.log(`  artifact_path: ${blockedUrlsSummary.artifactPath}`);
    console.log(`  total: ${blockedUrlsSummary.total}`);

    console.log("  by_status:");
    if (blockedUrlsSummary.byStatus.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.byStatus) {
        console.log(`    - ${row.status}: ${row.count}`);
      }
    }

    console.log("  next_steps:");
    if (blockedUrlsSummary.topActions.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.topActions) {
        console.log(`    - ${row.action} (count=${row.count})`);
      }
    }
  }

  console.log("blockers:");
  if (triage.allowed) {
    console.log(`  - none (next transition allowed: ${triage.from} -> ${triage.to})`);
  } else if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log(`  - ${triage.errorCode ?? "UNKNOWN"}: ${triage.errorMessage ?? "Unknown blocker"}`);
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`  - missing artifact: ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
    for (const gate of triage.blockedGates) {
      console.log(`  - blocked gate: ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
    for (const check of triage.failedChecks) {
      console.log(`  - failed ${check.kind}: ${check.name}`);
    }
  }

  await printInspectOperatorGuidance(summary.runRoot);
}

async function runTriage(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);

  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli triage: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  if (args.json) {
    emitContractCommandJson({
      command: "triage",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary,
      extra: {
        blockers_summary: blockersSummaryJson(triage),
      },
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });

  console.log("triage:");
  console.log(`  allowed: ${triage.allowed}`);
  console.log(`  from: ${triage.from}`);
  console.log(`  to: ${triage.to}`);
  if (triage.errorCode) console.log(`  error.code: ${triage.errorCode}`);
  if (triage.errorMessage) console.log(`  error.message: ${triage.errorMessage}`);

  if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log("  missing_artifacts: none");
    console.log("  blocked_gates: none");
    console.log("  failed_checks: none");
    return;
  }

  console.log("  missing_artifacts:");
  if (triage.missingArtifacts.length === 0) {
    console.log("    - none");
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  console.log("  blocked_gates:");
  if (triage.blockedGates.length === 0) {
    console.log("    - none");
  } else {
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  console.log("  failed_checks:");
  if (triage.failedChecks.length === 0) {
    console.log("    - none");
  } else {
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }
}

async function runRun(args: RunCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const liveDriver = args.driver === "live" ? createOperatorInputDriver() : null;

  const emitRunJson = (summary: ManifestSummary, payload: Record<string, unknown>): void => {
    emitJson({
      command: "run",
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      ...payload,
    });
  };

  const log = (line: string): void => {
    if (!args.json) {
      console.log(line);
    }
  };

  for (let i = 1; i <= args.maxTicks; i += 1) {
    const pre = (await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [pre_tick_${i}]`,
    })) as ToolEnvelope & { timed_out?: boolean; checkpoint_path?: string };
    if (pre.timed_out === true) {
      const summary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
      if (args.json) {
        emitRunJson(summary, {
          ok: false,
          error: {
            code: "WATCHDOG_TIMEOUT",
            message: "stage timed out before tick execution",
          },
          checkpoint_path: String(pre.checkpoint_path ?? ""),
        });
      } else {
        log("run.ok: false");
        log("run.error.code: WATCHDOG_TIMEOUT");
        log("run.error.message: stage timed out before tick execution");
        log(`run.checkpoint_path: ${String(pre.checkpoint_path ?? "")}`);
      }
      return;
    }

    const manifest = await readJsonObject(runHandle.manifestPath);
    const summary = await summarizeManifest(manifest);

    if (summary.status === "completed" || summary.status === "failed" || summary.status === "cancelled") {
      if (args.json) {
        emitRunJson(summary, { ok: true, terminal: true });
      } else {
        log("run.ok: true");
        printContract({
          runId: summary.runId,
          runRoot: summary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: summary.gatesPath,
          stageCurrent: summary.stageCurrent,
          status: summary.status,
        });
      }
      return;
    }

    if (args.until && summary.stageCurrent === args.until) {
      if (args.json) {
        emitRunJson(summary, { ok: true, until_reached: args.until });
      } else {
        log("run.ok: true");
        log(`run.until_reached: ${args.until}`);
        printContract({
          runId: summary.runId,
          runRoot: summary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: summary.gatesPath,
          stageCurrent: summary.stageCurrent,
          status: summary.status,
        });
      }
      return;
    }

    if (summary.status === "paused") {
      if (args.json) {
        emitRunJson(summary, {
          ok: false,
          error: {
            code: "PAUSED",
            message: "run is paused; resume first",
          },
        });
      } else {
        log("run.ok: false");
        log("run.error.code: PAUSED");
        log("run.error.message: run is paused; resume first");
        printContract({
          runId: summary.runId,
          runRoot: summary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: summary.gatesPath,
          stageCurrent: summary.stageCurrent,
          status: summary.status,
        });
      }
      return;
    }

    const tickReason = `${args.reason} [tick_${i}]`;
    const context = await beginTickObservability({
      manifestPath: runHandle.manifestPath,
      gatesPath: runHandle.gatesPath,
      reason: tickReason,
    });

    let result: TickResult;
    let toolFailure: { code: string; message: string } | null = null;
    try {
      result = await runOneOrchestratorTick({
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: tickReason,
        driver: args.driver,
        stageHint: summary.stageCurrent,
        liveDriver,
      });
    } catch (error) {
      toolFailure = toolErrorDetails(error);
      result = {
        ok: false,
        error: {
          code: toolFailure.code,
          message: toolFailure.message,
          details: {},
        },
      } as TickResult;
    }

    await finalizeTickObservability({
      context,
      tickResult: result,
      reason: tickReason,
      toolError: toolFailure,
    });

    if (!result.ok) {
      if (result.error.code === "CANCELLED") {
        const current = await readJsonObject(runHandle.manifestPath);
        const currentSummary = await summarizeManifest(current);
        if (args.json) {
          emitRunJson(currentSummary, { ok: true, cancelled: true });
        } else {
          log("run.ok: true");
          printContract({
            runId: currentSummary.runId,
            runRoot: currentSummary.runRoot,
            manifestPath: runHandle.manifestPath,
            gatesPath: currentSummary.gatesPath,
            stageCurrent: currentSummary.stageCurrent,
            status: currentSummary.status,
          });
        }
        return;
      }

      const tickError = resultErrorDetails(result) ?? {
        code: "UNKNOWN",
        message: "tick failed",
      };
      const haltArtifact = await handleTickFailureArtifacts({
        runRoot: context.runRoot,
        runId: context.runId,
        stageCurrent: context.stageBefore,
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: `operator-cli run tick_${i} failure: ${args.reason}`,
        error: tickError,
        triageReason: `operator-cli run auto-triage: ${args.reason}`,
        emitLogs: !args.json,
      });

      const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
      if (args.json) {
        emitRunJson(currentSummary, {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details ?? {},
          },
          halt: {
            tick_index: haltArtifact.tickIndex,
            tick_path: haltArtifact.tickPath,
            latest_path: haltArtifact.latestPath,
            blockers_summary: haltArtifact.triage ? blockersSummaryJson(haltArtifact.triage) : null,
          },
        });
      } else {
        log("run.ok: false");
        log(`run.error.code: ${result.error.code}`);
        log(`run.error.message: ${result.error.message}`);
        log(`run.error.details: ${JSON.stringify(result.error.details ?? {}, null, 2)}`);
      }
      return;
    }

    log(`run.tick_${i}.from: ${String(result.from ?? "")}`);
    log(`run.tick_${i}.to: ${String(result.to ?? "")}`);
    if ("wave_outputs_count" in result && typeof result.wave_outputs_count === "number") {
      log(`run.tick_${i}.wave_outputs_count: ${result.wave_outputs_count}`);
    }

    const post = (await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [post_tick_${i}]`,
    })) as ToolEnvelope & { timed_out?: boolean; checkpoint_path?: string };
    if (post.timed_out === true) {
      const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
      if (args.json) {
        emitRunJson(currentSummary, {
          ok: false,
          error: {
            code: "WATCHDOG_TIMEOUT",
            message: "stage timed out after tick execution",
          },
          checkpoint_path: String(post.checkpoint_path ?? ""),
        });
      } else {
        log("run.ok: false");
        log("run.error.code: WATCHDOG_TIMEOUT");
        log("run.error.message: stage timed out after tick execution");
        log(`run.checkpoint_path: ${String(post.checkpoint_path ?? "")}`);
      }
      return;
    }

    const after = await readJsonObject(runHandle.manifestPath);
    const afterSummary = await summarizeManifest(after);
    if (afterSummary.status === "completed" || afterSummary.status === "failed" || afterSummary.status === "cancelled") {
      if (args.json) {
        emitRunJson(afterSummary, { ok: true, terminal: true, ticks_executed: i });
      } else {
        log("run.ok: true");
        printContract({
          runId: afterSummary.runId,
          runRoot: afterSummary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: afterSummary.gatesPath,
          stageCurrent: afterSummary.stageCurrent,
          status: afterSummary.status,
        });
      }
      return;
    }

    if (args.until && afterSummary.stageCurrent === args.until) {
      if (args.json) {
        emitRunJson(afterSummary, { ok: true, until_reached: args.until, ticks_executed: i });
      } else {
        log("run.ok: true");
        log(`run.until_reached: ${args.until}`);
        printContract({
          runId: afterSummary.runId,
          runRoot: afterSummary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: afterSummary.gatesPath,
          stageCurrent: afterSummary.stageCurrent,
          status: afterSummary.status,
        });
      }
      return;
    }

    if (String(result.to ?? "") === String(result.from ?? "")) {
      if (args.json) {
        emitRunJson(afterSummary, { ok: false, note: "stage did not advance", ticks_executed: i });
      } else {
        log("run.note: stage did not advance");
      }
      return;
    }
  }

  const summary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
  if (args.json) {
    emitRunJson(summary, {
      ok: false,
      error: {
        code: "TICK_CAP_EXCEEDED",
        message: "max ticks reached before completion",
      },
    });
    return;
  }

  log("run.ok: false");
  log("run.error.code: TICK_CAP_EXCEEDED");
  log("run.error.message: max ticks reached before completion");
}

async function runPause(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");
  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli pause: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "paused" },
        expected_revision: manifestRevision,
        reason: `operator-cli pause: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "pause-checkpoint.md",
        content: [
          "# Pause Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} resume --manifest "${runHandle.manifestPath}" --reason "operator resume"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("pause.ok: true");
        console.log(`pause.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "pause",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runResume(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");
  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli resume: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "running", stage: { started_at: nowIso() } },
        expected_revision: manifestRevision,
        reason: `operator-cli resume: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "resume-checkpoint.md",
        content: [
          "# Resume Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("resume.ok: true");
        console.log(`resume.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "resume",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runCancel(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");

  if (summary.status === "cancelled") {
    if (args.json) {
      emitJson({
        ok: true,
        command: "cancel",
        note: "already cancelled",
        run_id: summary.runId,
        run_root: summary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: summary.gatesPath,
        stage_current: summary.stageCurrent,
        status: summary.status,
      });
    } else {
      console.log("cancel.ok: true");
      console.log("cancel.note: already cancelled");
    }
    return;
  }

  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli cancel: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "cancelled" },
        expected_revision: manifestRevision,
        reason: `operator-cli cancel: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "cancel-checkpoint.md",
        content: [
          "# Cancel Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} status --manifest "${runHandle.manifestPath}"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("cancel.ok: true");
        console.log(`cancel.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "cancel",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runCaptureFixtures(args: {
  manifest: string;
  outputDir?: string;
  bundleId?: string;
  reason: string;
  json?: boolean;
}): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifest = await readJsonObject(args.manifest);
  const summary = await summarizeManifest(manifest);
  const runId = summary.runId;
  const createdAt = nowIso();

  const outputDir = args.outputDir
    ? requireAbsolutePath(args.outputDir, "--output-dir")
    : path.join(summary.runRoot, "fixtures");
  const defaultBundleId = `${runId}_bundle_${timestampTokenFromIso(createdAt)}`;
  const bundleId = String(args.bundleId ?? defaultBundleId).trim();
  if (!bundleId) throw new Error("--bundle-id must be non-empty");

  const capture = await callTool("fixture_bundle_capture", fixture_bundle_capture as unknown as ToolWithExecute, {
    manifest_path: args.manifest,
    output_dir: outputDir,
    bundle_id: bundleId,
    reason: args.reason,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "capture-fixtures",
      run_id: runId,
      run_root: summary.runRoot,
      manifest_path: args.manifest,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      bundle_id: String(capture.bundle_id ?? bundleId),
      bundle_root: String(capture.bundle_root ?? ""),
      replay_command: "deep_research_fixture_replay --bundle_root <bundle_root>",
    });
    return;
  }

  printContract({
    runId,
    runRoot: summary.runRoot,
    manifestPath: args.manifest,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("capture_fixtures.ok: true");
  console.log(`capture_fixtures.bundle_id: ${String(capture.bundle_id ?? bundleId)}`);
  console.log(`capture_fixtures.bundle_root: ${String(capture.bundle_root ?? "")}`);
  console.log("capture_fixtures.replay: deep_research_fixture_replay --bundle_root <bundle_root>");
}

async function runRerunWave1(args: RerunWave1CliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const perspective = args.perspective.trim();
  const reason = args.reason.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(perspective)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const retryDirectivesPath = await safeResolveManifestPath(
    summary.runRoot,
    "retry/retry-directives.json",
    "retry.retry_directives_file",
  );

  const retryArtifact = {
    schema_version: "wave1.retry_directives.v1",
    run_id: summary.runId,
    stage: "wave1",
    generated_at: nowIso(),
    consumed_at: null,
    retry_directives: [
      {
        perspective_id: perspective,
        action: "retry",
        change_note: reason,
      },
    ],
    deferred_validation_failures: [],
  };

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli rerun wave1: ${reason}`,
    fn: async () => {
      await fs.mkdir(path.dirname(retryDirectivesPath), { recursive: true });
      await fs.writeFile(retryDirectivesPath, `${JSON.stringify(retryArtifact, null, 2)}\n`, "utf8");
    },
  });

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("rerun.wave1.ok: true");
  console.log(`rerun.wave1.retry_directives_path: ${retryDirectivesPath}`);
  console.log(`rerun.wave1.perspective_id: ${perspective}`);
}

async function runAgentResult(args: AgentResultCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const inputPath = requireAbsolutePath(args.input, "--input");
  const stage = args.stage;
  const perspectiveId = args.perspective.trim();
  const agentRunId = args.agentRunId.trim();
  const reason = args.reason.trim();

  if (stage !== "perspectives" && stage !== "wave1" && stage !== "wave2" && stage !== "summaries" && stage !== "synthesis") {
    throw new Error("--stage must be perspectives|wave1|wave2|summaries|synthesis");
  }
  if (!isSafeSegment(perspectiveId)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!agentRunId) {
    throw new Error("--agent-run-id must be non-empty");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const sourceInputText = await fs.readFile(inputPath, "utf8");
  if (!sourceInputText.trim()) {
    throw new Error("--input is empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runRoot = summary.runRoot;
  let promptMd: string;
  let promptDigest: string;
  let outputPath: string;
  let rawOutputPath: string | null = null;
  let metaPath: string;
  let normalizedPerspectivesOutput: ReturnType<typeof normalizePerspectivesDraftOutputV1> | null = null;
  let noop = false;

  if (stage === "perspectives") {
    const promptPath = path.join(runRoot, "operator", "prompts", "perspectives", `${perspectiveId}.md`);
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`perspectives prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);

    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(sourceInputText);
    } catch {
      throwWithCode("AGENT_RESULT_PERSPECTIVES_INPUT_INVALID_JSON", "--input must be valid JSON for stage=perspectives");
    }

    normalizedPerspectivesOutput = normalizePerspectivesDraftOutputV1({
      value: parsedInput,
      expectedRunId: summary.runId,
    });

    rawOutputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.raw.json`);
    outputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.json`);
    metaPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.meta.json`);
  } else if (stage === "wave1" || stage === "wave2") {
    const planEntries = stage === "wave1"
      ? await readWave1PlanEntries({ runRoot, manifest })
      : await readWave2PlanEntries(runRoot);
    const planEntry = planEntries.find((entry) => entry.perspectiveId === perspectiveId);
    if (!planEntry) {
      throw new Error(`perspective ${perspectiveId} not found in ${stage} plan`);
    }
    promptMd = planEntry.promptMd;
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    const waveDir = stage === "wave1" ? "wave-1" : "wave-2";
    outputPath = path.join(runRoot, waveDir, `${perspectiveId}.md`);
    metaPath = path.join(runRoot, waveDir, `${perspectiveId}.meta.json`);
  } else if (stage === "summaries") {
    const promptPath = path.join(runRoot, "operator", "prompts", "summaries", `${perspectiveId}.md`);
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`summary prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "summaries", `${perspectiveId}.md`);
    metaPath = path.join(runRoot, "summaries", `${perspectiveId}.meta.json`);
  } else {
    // synthesis
    const promptPath = path.join(runRoot, "operator", "prompts", "synthesis", "final-synthesis.md");
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`synthesis prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "synthesis", "final-synthesis.md");
    metaPath = path.join(runRoot, "synthesis", "final-synthesis.meta.json");
  }

  assertWithinRoot(runRoot, outputPath, `${stage} output`);
  if (rawOutputPath) {
    assertWithinRoot(runRoot, rawOutputPath, `${stage} raw output`);
  }
  assertWithinRoot(runRoot, metaPath, `${stage} meta sidecar`);

  const startedAt = normalizeOptional(args.startedAt);
  const finishedAt = normalizeOptional(args.finishedAt);
  const model = normalizeOptional(args.model);
  const ingestedAt = nowIso();

  const sidecar = {
    schema_version: stage === "perspectives" ? "agent-result-meta.v1" : "wave-output-meta.v1",
    prompt_digest: promptDigest,
    agent_run_id: agentRunId,
    ingested_at: ingestedAt,
    source_input_path: inputPath,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(model ? { model } : {}),
  };

  await withRunLock({
    runRoot,
    reason: `operator-cli agent-result: ${reason}`,
    fn: async () => {
      if (stage === "perspectives") {
        const outputExists = await fileExists(outputPath);
        const rawExists = rawOutputPath ? await fileExists(rawOutputPath) : false;
        const metaExists = await fileExists(metaPath);
        const normalizedInputPath = path.resolve(inputPath);
        const normalizedRawOutputPath = rawOutputPath ? path.resolve(rawOutputPath) : null;
        const inputMatchesRawOutput = rawOutputPath ? normalizedInputPath === normalizedRawOutputPath : false;

        if (!args.force && outputExists && metaExists) {
          const existingPromptDigest = await readPromptDigestFromMeta(metaPath);
          if (existingPromptDigest === promptDigest) {
            noop = true;
            return;
          }
          if (existingPromptDigest) {
            throwWithCode(
              "AGENT_RESULT_PROMPT_DIGEST_CONFLICT",
              `perspectives output/meta prompt_digest mismatch for ${perspectiveId}; use --force to overwrite`,
            );
          }
        }

        if (!args.force && outputExists) {
          throwWithCode(
            "AGENT_RESULT_META_CONFLICT",
            `perspectives output exists with missing/invalid meta for ${perspectiveId}; use --force to overwrite`,
          );
        }

        if (!args.force && (metaExists || (!inputMatchesRawOutput && rawExists))) {
          throwWithCode(
            "AGENT_RESULT_CONFLICT",
            `perspectives artifacts already exist for ${perspectiveId}; use --force to overwrite`,
          );
        }

        if (!rawOutputPath || !normalizedPerspectivesOutput) {
          throwWithCode("AGENT_RESULT_INTERNAL_ERROR", "perspectives ingest was not initialized");
        }

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        if (!inputMatchesRawOutput && !rawExists) {
          await fs.writeFile(rawOutputPath, sourceInputText, "utf8");
        }
        await fs.writeFile(outputPath, `${JSON.stringify(normalizedPerspectivesOutput, null, 2)}\n`, "utf8");
        await fs.writeFile(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
        return;
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${sourceInputText.trim()}\n`, "utf8");
      await fs.writeFile(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    },
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "agent-result",
      run_id: summary.runId,
      run_root: runRoot,
      manifest_path: manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      stage,
      perspective_id: perspectiveId,
      output_path: outputPath,
      meta_path: metaPath,
      ...(rawOutputPath ? { raw_output_path: rawOutputPath } : {}),
      prompt_digest: promptDigest,
      noop,
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("agent_result.ok: true");
  console.log(`agent_result.stage: ${stage}`);
  console.log(`agent_result.perspective_id: ${perspectiveId}`);
  console.log(`agent_result.output_path: ${outputPath}`);
  console.log(`agent_result.meta_path: ${metaPath}`);
  console.log(`agent_result.prompt_digest: ${promptDigest}`);
}

const AbsolutePath: Type<string, string> = {
  async from(str) {
    return requireAbsolutePath(str, "path");
  },
};

const initCmd = createInitCmd({ AbsolutePath, runInit });

const tickCmd = createTickCmd({ AbsolutePath, runTick });

const agentResultCmd = createAgentResultCmd({ AbsolutePath, runAgentResult });

const runCmd = createRunCmd({ AbsolutePath, runRun });

const stageAdvanceCmd = createStageAdvanceCmd({ AbsolutePath, runStageAdvance });

const perspectivesDraftCmd = createPerspectivesDraftCmd({ AbsolutePath, runPerspectivesDraft });

const statusCmd = createStatusCmd({ AbsolutePath, runStatus });

const inspectCmd = createInspectCmd({ AbsolutePath, runInspect });

const triageCmd = createTriageCmd({ AbsolutePath, runTriage });

const pauseCmd = createPauseCmd({ AbsolutePath, runPause });

const resumeCmd = createResumeCmd({ AbsolutePath, runResume });

const cancelCmd = createCancelCmd({ AbsolutePath, runCancel });

const captureFixturesCmd = createCaptureFixturesCmd({ AbsolutePath, runCaptureFixtures });

const rerunCmd = createRerunCmd({ AbsolutePath, runRerunWave1 });

const app = subcommands({
  name: "deep-research-option-c",
  cmds: {
    init: initCmd,
    tick: tickCmd,
    "agent-result": agentResultCmd,
    run: runCmd,
    "stage-advance": stageAdvanceCmd,
    "perspectives-draft": perspectivesDraftCmd,
    status: statusCmd,
    inspect: inspectCmd,
    triage: triageCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    cancel: cancelCmd,
    "capture-fixtures": captureFixturesCmd,
    rerun: rerunCmd,
  },
});

runSafely(app, CLI_ARGV)
  .then((result) => {
    if (result._tag === "ok") return;

    const command = typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown";
    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command,
        error: {
          code: "CLI_PARSE_ERROR",
          message: result.error.config.message,
        },
      });
      process.exit(result.error.config.exitCode);
      return;
    }

    result.error.run();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : "CLI_ERROR";

    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command: typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown",
        error: {
          code: errorCode,
          message,
        },
      });
    } else {
      console.error(`ERROR: ${message}`);
    }

    process.exit(1);
  });
