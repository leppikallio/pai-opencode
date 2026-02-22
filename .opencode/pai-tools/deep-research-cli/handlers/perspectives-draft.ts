import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  perspectives_write,
  stage_advance,
  wave1_plan,
} from "../../../tools/deep_research_cli.ts";
import {
  resolveDeepResearchCliFlagsV1,
  sha256HexLowerUtf8,
} from "../../../tools/deep_research_cli/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import { throwWithCode } from "../cli/errors";
import {
  asObject,
  readJsonObject,
} from "../utils/io-json";
import { fileExists } from "../utils/fs-utils";
import {
  printContract,
  resolveRunHandle,
  summarizeManifest,
  withRunLock,
} from "../utils/run-handle";
import {
  stableDigest,
  promptDigestFromPromptMarkdown,
  normalizePromptDigest,
} from "../utils/digest";
import {
  buildDefaultPerspectivesPolicyArtifact,
  writeDefaultPerspectivesPolicy,
} from "../perspectives/policy";
import { buildPerspectivesDraftPromptMarkdown } from "../perspectives/prompt";
import { normalizePerspectivesDraftOutputV1 } from "../perspectives/schema";
import type {
  PerspectivesDraftMergeReportV1,
  PerspectivesDraftStateArtifactV1,
  PerspectivesDraftStatus,
  PerspectivesV1Payload,
  TaskDriverMissingPerspective,
} from "../perspectives/state";
import {
  printHaltArtifactSummary,
  writeHaltArtifactForFailure,
} from "../triage/halt-artifacts";
import {
  callTool,
  type ToolWithExecute,
} from "../tooling/tool-envelope";

export type PerspectivesDraftCliArgs = {
  manifest: string;
  reason: string;
  driver: "task";
  json: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchCliFlagsV1();
  if (!flags.cliEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

function nextStepCliInvocation(): string {
  const cliName = "deep-research-cli" + ".ts";
  return `bun "pai-tools/${cliName}"`;
}

const REQUIRED_TASK_DRIVER_PERSPECTIVE_IDS = [
  "primary",
  "ensemble-independent",
  "ensemble-contrarian",
] as const;

async function writeTaskDriverPerspectiveDraftPrompt(args: {
  runRoot: string;
  runId: string;
  queryText: string;
  perspectiveId: string;
}): Promise<TaskDriverMissingPerspective> {
  const perspectiveId = args.perspectiveId;
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

type PerspectiveTrack = "standard" | "independent" | "contrarian";

type AggregatedPerspectiveCandidate = {
  key: string;
  title: string;
  questions: string[];
  track: PerspectiveTrack;
  recommended_agent_type: string;
  domain: string;
  platform_requirements: Array<{ name: string; reason: string }>;
  tool_policy: {
    primary: string[];
    secondary: string[];
    forbidden: string[];
  };
  flags: { human_review_required: boolean };
  confidence: number;
  agreement: number;
  score: number;
};

function asFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function compareByScoreThenStable(a: AggregatedPerspectiveCandidate, b: AggregatedPerspectiveCandidate): number {
  const scoreCmp = b.score - a.score;
  if (scoreCmp !== 0) return scoreCmp;
  const domainCmp = String(a.domain).localeCompare(String(b.domain));
  if (domainCmp !== 0) return domainCmp;
  const titleCmp = a.title.localeCompare(b.title);
  if (titleCmp !== 0) return titleCmp;
  return a.key.localeCompare(b.key);
}

function compareForFinalOutput(a: AggregatedPerspectiveCandidate, b: AggregatedPerspectiveCandidate): number {
  const trackCmp = trackWeight(a.track) - trackWeight(b.track);
  if (trackCmp !== 0) return trackCmp;
  return compareByScoreThenStable(a, b);
}

function allocateTrackTargets(args: {
  total: number;
  allocation: Record<PerspectiveTrack, number>;
}): Record<PerspectiveTrack, number> {
  const tracks: PerspectiveTrack[] = ["standard", "independent", "contrarian"];
  const result: Record<PerspectiveTrack, number> = {
    standard: 0,
    independent: 0,
    contrarian: 0,
  };

  if (args.total <= 0) return result;

  const baseAlloc = tracks.map((track) => {
    const raw = Math.max(0, args.allocation[track]) * args.total;
    const base = Math.floor(raw);
    return {
      track,
      base,
      remainder: raw - base,
    };
  });

  for (const entry of baseAlloc) {
    result[entry.track] = entry.base;
  }

  let remaining = args.total - tracks.reduce((sum, track) => sum + result[track], 0);
  if (remaining <= 0) return result;

  const remainderOrder = [...baseAlloc].sort((a, b) => {
    const remainderCmp = b.remainder - a.remainder;
    if (remainderCmp !== 0) return remainderCmp;
    return trackWeight(a.track) - trackWeight(b.track);
  });

  if (remainderOrder.length === 0) return result;

  for (let index = 0; remaining > 0; index = (index + 1) % remainderOrder.length) {
    result[remainderOrder[index]!.track] += 1;
    remaining -= 1;
  }

  return result;
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
  policyPath: string;
}): Promise<{
  perspectivesDoc: PerspectivesV1Payload;
  mergeReport: PerspectivesDraftMergeReportV1;
  draftDigest: string;
  reviewRequired: boolean;
  selectionTelemetry: {
    thresholds: {
      confidence_min: number;
      confidence_max: number;
      ensemble_threshold: number;
      backup_threshold: number;
      match_bonus: number;
    };
    candidate_count_in: number;
    candidate_count_out: number;
  };
}> {
  const sources = await listNormalizedPerspectivesDraftOutputs({ runRoot: args.runRoot });
  if (sources.length === 0) {
    throwWithCode("PERSPECTIVES_DRAFT_OUTPUTS_MISSING", "no normalized perspectives draft outputs found");
  }

  const defaultPolicy = buildDefaultPerspectivesPolicyArtifact();
  const policyRaw = await readJsonObject(args.policyPath);
  const thresholdsRaw = asObject(policyRaw.thresholds);
  const confidenceRangeRaw = asObject(thresholdsRaw.confidence);
  const trackAllocationRaw = asObject(policyRaw.track_allocation);

  const confidenceMin = clampInteger(
    asFiniteNumber(confidenceRangeRaw.min, defaultPolicy.thresholds.confidence.min),
    0,
    100,
  );
  const confidenceMax = clampInteger(
    asFiniteNumber(confidenceRangeRaw.max, defaultPolicy.thresholds.confidence.max),
    confidenceMin,
    100,
  );
  const ensembleThreshold = clampInteger(
    asFiniteNumber(thresholdsRaw.ensemble_threshold, defaultPolicy.thresholds.ensemble_threshold),
    confidenceMin,
    confidenceMax,
  );
  const backupThreshold = clampInteger(
    asFiniteNumber(thresholdsRaw.backup_threshold, defaultPolicy.thresholds.backup_threshold),
    confidenceMin,
    confidenceMax,
  );
  const matchBonus = asFiniteNumber(thresholdsRaw.match_bonus, defaultPolicy.thresholds.match_bonus);
  const trackAllocation: Record<PerspectiveTrack, number> = {
    standard: Math.max(0, asFiniteNumber(trackAllocationRaw.standard, defaultPolicy.track_allocation.standard)),
    independent: Math.max(0, asFiniteNumber(trackAllocationRaw.independent, defaultPolicy.track_allocation.independent)),
    contrarian: Math.max(0, asFiniteNumber(trackAllocationRaw.contrarian, defaultPolicy.track_allocation.contrarian)),
  };

  const allCandidates: Array<ReturnType<typeof normalizePerspectivesDraftOutputV1>["candidates"][number]> = [];
  const sourceCandidates = new Map<string, Array<ReturnType<typeof normalizePerspectivesDraftOutputV1>["candidates"][number]>>();
  for (const source of sources) {
    const raw = await readJsonObject(source.absPath);
    const normalized = normalizePerspectivesDraftOutputV1({ value: raw, expectedRunId: args.runId });
    sourceCandidates.set(source.fileName, normalized.candidates);
    allCandidates.push(...normalized.candidates);
  }

  const keys: string[] = [];
  const dedupedByKey = new Map<string, {
    title: string;
    questions: string[];
    track: PerspectiveTrack;
    recommended_agent_type: string;
    domain: string;
    platform_requirements: Array<{ name: string; reason: string }>;
    tool_policy: {
      primary: string[];
      secondary: string[];
      forbidden: string[];
    };
    flags: { human_review_required: boolean };
    confidence: number;
    sources: Set<string>;
  }>();

  for (const [sourceId, candidates] of sourceCandidates.entries()) {
    for (const candidate of candidates) {
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
        existing.confidence = Math.max(existing.confidence, candidate.confidence);
        existing.sources.add(sourceId);
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
        confidence: candidate.confidence,
        sources: new Set([sourceId]),
      });
    }
  }

  const filteredScored = Array.from(dedupedByKey.entries())
    .map(([key, candidate]): AggregatedPerspectiveCandidate => {
      const agreement = candidate.sources.size;
      const score = candidate.confidence + (agreement >= 2 ? matchBonus : 0);
      return {
        key,
        title: candidate.title,
        questions: candidate.questions,
        track: candidate.track,
        recommended_agent_type: candidate.recommended_agent_type,
        domain: candidate.domain,
        platform_requirements: candidate.platform_requirements,
        tool_policy: candidate.tool_policy,
        flags: candidate.flags,
        confidence: candidate.confidence,
        agreement,
        score,
      };
    })
    .filter((candidate) => {
      const threshold = candidate.agreement >= 2 ? ensembleThreshold : backupThreshold;
      return candidate.score >= threshold;
    });

  const targetCount = Math.min(filteredScored.length, REQUIRED_TASK_DRIVER_PERSPECTIVE_IDS.length);
  const trackTargets = allocateTrackTargets({
    total: targetCount,
    allocation: trackAllocation,
  });

  const selected: AggregatedPerspectiveCandidate[] = [];
  const selectedKeys = new Set<string>();
  const tracks: PerspectiveTrack[] = ["standard", "independent", "contrarian"];

  for (const track of tracks) {
    const trackTarget = trackTargets[track];
    if (trackTarget <= 0) continue;
    const trackCandidates = filteredScored
      .filter((candidate) => candidate.track === track)
      .sort(compareByScoreThenStable)
      .slice(0, trackTarget);
    for (const candidate of trackCandidates) {
      selected.push(candidate);
      selectedKeys.add(candidate.key);
    }
  }

  if (selected.length < targetCount) {
    const remaining = filteredScored
      .filter((candidate) => !selectedKeys.has(candidate.key))
      .sort(compareByScoreThenStable);
    for (const candidate of remaining) {
      selected.push(candidate);
      selectedKeys.add(candidate.key);
      if (selected.length >= targetCount) break;
    }
  }

  const merged = selected.sort(compareForFinalOutput);

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

  const draftDigest = stableDigest(perspectivesDoc as unknown as Record<string, unknown>);
  return {
    perspectivesDoc,
    mergeReport,
    draftDigest,
    reviewRequired,
    selectionTelemetry: {
      thresholds: {
        confidence_min: confidenceMin,
        confidence_max: confidenceMax,
        ensemble_threshold: ensembleThreshold,
        backup_threshold: backupThreshold,
        match_bonus: matchBonus,
      },
      candidate_count_in: allCandidates.length,
      candidate_count_out: merged.length,
    },
  };
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

export async function runPerspectivesDraft(args: PerspectivesDraftCliArgs): Promise<void> {
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

  const requiredPerspectives = await Promise.all(
    REQUIRED_TASK_DRIVER_PERSPECTIVE_IDS.map((perspectiveId) => writeTaskDriverPerspectiveDraftPrompt({
      runRoot: summary.runRoot,
      runId: summary.runId,
      queryText,
      perspectiveId,
    }))
  );

  const statusResolutions = await Promise.all(
    requiredPerspectives.map((perspective) => resolvePerspectivesDraftStatus({
      runId: summary.runId,
      perspective,
    }))
  );

  const missing = requiredPerspectives
    .map((perspective, idx) => ({ perspective, resolution: statusResolutions[idx]! }))
    .filter(({ resolution }) => resolution.status !== "merging");
  const statusResolution: {
    status: PerspectivesDraftStatus;
  } = {
    status: missing.length === 0 ? "merging" : "awaiting_agent_results",
  };

  const policyWrite = await writeDefaultPerspectivesPolicy({
    runRoot: summary.runRoot,
  });

  const statePath = path.join(summary.runRoot, "operator", "state", "perspectives-state.json");
  const stateInputsDigest = stableDigest({
    schema: "perspectives-draft-state.inputs.v1",
    run_id: summary.runId,
    required_perspectives: requiredPerspectives.map((p) => ({
      perspective_id: p.perspectiveId,
      prompt_digest: p.promptDigest,
    })),
    missing_count: missing.length,
    missing_ids: missing.map((m) => m.perspective.perspectiveId),
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
      policyPath: policyWrite.policyPath,
    });

    const draftPath = path.join(summary.runRoot, "operator", "drafts", "perspectives.draft.json");
    const mergeReportPath = path.join(summary.runRoot, "operator", "drafts", "perspectives.merge-report.json");

    stateArtifact = {
      ...stateArtifact,
      status: draftBuild.reviewRequired || draftBuild.perspectivesDoc.perspectives.length === 0
        ? "awaiting_human_review"
        : "merging",
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

    if (draftBuild.perspectivesDoc.perspectives.length === 0) {
      const halt = await writeHaltArtifactForFailure({
        runRoot: summary.runRoot,
        runId: summary.runId,
        stageCurrent: summary.stageCurrent,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        reason: `operator-cli perspectives-draft: ${args.reason}`,
        error: {
          code: "PERSPECTIVES_SELECTION_EMPTY",
          message: "Perspectives selection is empty after deterministic policy filtering",
          details: {
            stage: "perspectives",
            status: "awaiting_human_review",
            state_path: statePath,
            policy_path: policyWrite.policyPath,
            thresholds: draftBuild.selectionTelemetry.thresholds,
            candidate_count_in: draftBuild.selectionTelemetry.candidate_count_in,
            candidate_count_out: draftBuild.selectionTelemetry.candidate_count_out,
            draft_path: draftPath,
            merge_report_path: mergeReportPath,
            draft_digest: draftBuild.draftDigest,
          },
        },
        nextStepCliInvocation,
        nextCommandsOverride: [
          `${nextStepCliInvocation()} inspect --manifest "${runHandle.manifestPath}"`,
          `# Review merge report and policy thresholding: ${mergeReportPath}`,
          `${nextStepCliInvocation()} perspectives-draft --manifest "${runHandle.manifestPath}" --reason "retry perspectives selection" --driver task`,
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
            code: "PERSPECTIVES_SELECTION_EMPTY",
            message: "Perspectives selection is empty after deterministic policy filtering",
            details: {
              state_path: statePath,
              policy_path: policyWrite.policyPath,
              thresholds: draftBuild.selectionTelemetry.thresholds,
              candidate_count_in: draftBuild.selectionTelemetry.candidate_count_in,
              candidate_count_out: draftBuild.selectionTelemetry.candidate_count_out,
              draft_path: draftPath,
              merge_report_path: mergeReportPath,
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
      console.log("perspectives_draft.error.code: PERSPECTIVES_SELECTION_EMPTY");
      console.log(`perspectives_draft.policy_path: ${policyWrite.policyPath}`);
      console.log(`perspectives_draft.draft_path: ${draftPath}`);
      console.log(`perspectives_draft.merge_report_path: ${mergeReportPath}`);
      await printHaltArtifactSummary(halt);
      return;
    }

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
        nextStepCliInvocation,
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
      promoted_digest: stableDigest(draftBuild.perspectivesDoc as unknown as Record<string, unknown>),
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

  const primaryPerspective = requiredPerspectives[0];
  const primaryResolution = statusResolutions[0];

  const errorDetails: Record<string, unknown> = {
    stage: "perspectives",
    status: statusResolution.status,
    state_path: statePath,
    prompt_path: primaryPerspective?.promptPath,
    output_path: primaryPerspective?.outputPath,
    meta_path: primaryPerspective?.metaPath,
    policy_path: policyWrite.policyPath,
    policy_digest: policyWrite.policyDigest,
    policy_changed: policyWrite.changed,
    prompt_digest: primaryPerspective?.promptDigest,
    checks: primaryResolution
      ? {
        output_exists: primaryResolution.outputExists,
        meta_prompt_digest: primaryResolution.metaPromptDigest,
        prompt_digest_matches: primaryResolution.promptDigestMatches,
        normalized_output_valid: primaryResolution.normalizedOutputValid,
      }
      : {},
    ...(primaryResolution?.normalizedOutputErrorCode
      ? {
        normalized_output_error: {
          code: primaryResolution.normalizedOutputErrorCode,
          message: primaryResolution.normalizedOutputErrorMessage,
        },
      }
      : {}),
    missing_count: missing.length,
    missing_perspectives: missing.map(({ perspective, resolution }) => ({
      perspective_id: perspective.perspectiveId,
      prompt_path: perspective.promptPath,
      output_path: perspective.outputPath,
      meta_path: perspective.metaPath,
      prompt_digest: perspective.promptDigest,
      checks: {
        output_exists: resolution.outputExists,
        meta_prompt_digest: resolution.metaPromptDigest,
        prompt_digest_matches: resolution.promptDigestMatches,
        normalized_output_valid: resolution.normalizedOutputValid,
      },
      ...(resolution.normalizedOutputErrorCode
        ? {
          normalized_output_error: {
            code: resolution.normalizedOutputErrorCode,
            message: resolution.normalizedOutputErrorMessage,
          },
        }
        : {}),
    })),
  };

  const nextCommands = [
    `${nextStepCliInvocation()} inspect --manifest "${runHandle.manifestPath}"`,
    ...missing.map(({ perspective }) => (
      `${nextStepCliInvocation()} agent-result --manifest "${runHandle.manifestPath}" --stage perspectives --perspective "${perspective.perspectiveId}" --input "${path.join(summary.runRoot, "operator", "outputs", "perspectives", `${perspective.perspectiveId}.raw.json`)}" --agent-run-id "<AGENT_RUN_ID>" --reason "operator: ingest perspectives/${perspective.perspectiveId}"`
    )),
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
    nextStepCliInvocation,
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
      prompt_path: primaryPerspective?.promptPath,
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
  if (primaryPerspective?.promptPath) {
    console.log(`perspectives_draft.prompt_path: ${primaryPerspective.promptPath}`);
  }
  if (primaryPerspective?.promptDigest) {
    console.log(`perspectives_draft.prompt_digest: ${primaryPerspective.promptDigest}`);
  }
  await printHaltArtifactSummary(halt);
  }
