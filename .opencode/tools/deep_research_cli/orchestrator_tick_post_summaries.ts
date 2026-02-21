import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, releaseRunLock, startRunLockHeartbeat } from "./run_lock";
import {
  atomicWriteJson,
  type ToolWithExecute,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  nowIso,
  parseJsonSafe,
  readJson,
  sha256HexLowerUtf8,
  validateManifestV1,
} from "./lifecycle_lib";
import { gate_d_evaluate } from "./gate_d_evaluate";
import { gate_e_evaluate } from "./gate_e_evaluate";
import { gate_e_reports } from "./gate_e_reports";
import { gate_f_evaluate } from "./gate_f_evaluate";
import { gates_write } from "./gates_write";
import { revision_control } from "./revision_control";
import { review_factory_run } from "./review_factory_run";
import { stage_advance } from "./stage_advance";
import { summary_pack_build } from "./summary_pack_build";
import { synthesis_write } from "./synthesis_write";
import { manifest_write } from "./manifest_write";
import type {
  OrchestratorLiveDrivers,
  OrchestratorLiveRunAgentResult,
} from "./orchestrator_tick_live";
import { readRunPolicyForRunRoot } from "./run_policy_read";

type ToolJsonOk = {
  ok: true;
  [key: string]: unknown;
};

type ToolJsonFailure = {
  ok: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type OrchestratorTickPostSummariesArgs = {
  manifest_path: string;
  gates_path: string;
  reason: string;
  driver?: "fixture" | "live" | "task";
  fixture_summaries_dir?: string;
  fixture_draft_path?: string;
  fixture_bundle_dir?: string;
  summary_pack_build_tool?: ToolWithExecute;
  gate_d_evaluate_tool?: ToolWithExecute;
  synthesis_write_tool?: ToolWithExecute;
  review_factory_run_tool?: ToolWithExecute;
  gate_e_reports_tool?: ToolWithExecute;
  gate_e_evaluate_tool?: ToolWithExecute;
  gate_f_evaluate_tool?: ToolWithExecute;
  revision_control_tool?: ToolWithExecute;
  gates_write_tool?: ToolWithExecute;
  stage_advance_tool?: ToolWithExecute;
  drivers?: Pick<OrchestratorLiveDrivers, "runAgent">;
  tool_context?: unknown;
};

export type OrchestratorTickPostSummariesSuccess = {
  ok: true;
  schema_version: "orchestrator_tick.post_summaries.v1";
  run_id: string;
  from: string;
  to: string;
  decision_inputs_digest: string | null;
  gate_d_status: string | null;
  gate_e_status: string | null;
  review_iteration: number | null;
  revision_action: string | null;
};

export type OrchestratorTickPostSummariesFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type OrchestratorTickPostSummariesResult =
  | OrchestratorTickPostSummariesSuccess
  | OrchestratorTickPostSummariesFailure;

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): OrchestratorTickPostSummariesFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isContainedWithin(baseDir: string, targetPath: string): boolean {
  if (baseDir === targetPath) return true;
  const relative = path.relative(baseDir, targetPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

type TickInProgressMarker = {
  schema_version: "tick_in_progress.v1";
  ts: string;
  stage: string;
  reason: string;
};

const STALE_TICK_MARKER_THRESHOLD_MS = 5 * 60 * 1000;

function tickInProgressMarkerPath(runRoot: string): string {
  return path.join(runRoot, "logs", "tick-in-progress.json");
}

async function writeTickInProgressMarker(args: {
  runRoot: string;
  stage: string;
  reason: string;
}): Promise<string> {
  const markerPath = tickInProgressMarkerPath(args.runRoot);
  const marker: TickInProgressMarker = {
    schema_version: "tick_in_progress.v1",
    ts: nowIso(),
    stage: args.stage,
    reason: args.reason,
  };
  await atomicWriteJson(markerPath, marker);
  return markerPath;
}

async function removeTickInProgressMarker(markerPath: string): Promise<void> {
  try {
    await fs.unlink(markerPath);
  } catch (e) {
    const code = e && typeof e === "object" ? String((e as { code?: unknown }).code ?? "") : "";
    if (code !== "ENOENT") throw e;
  }
}

async function checkForStaleTickInProgressMarker(runRoot: string): Promise<
  | { ok: true }
  | { ok: false; details: Record<string, unknown> }
> {
  const markerPath = tickInProgressMarkerPath(runRoot);
  if (!(await exists(markerPath))) return { ok: true };

  let markerRaw: unknown;
  try {
    markerRaw = await readJson(markerPath);
  } catch {
    return { ok: true };
  }

  if (!isPlainObject(markerRaw)) return { ok: true };
  const markerTs = nonEmptyString(markerRaw.ts);
  if (!markerTs) return { ok: true };

  const tsEpochMs = new Date(markerTs).getTime();
  if (!Number.isFinite(tsEpochMs)) return { ok: true };

  const markerAgeMs = Date.now() - tsEpochMs;
  if (markerAgeMs < STALE_TICK_MARKER_THRESHOLD_MS) return { ok: true };

  return {
    ok: false,
    details: {
      marker_path: markerPath,
      marker: markerRaw,
      marker_age_ms: markerAgeMs,
      stale_after_ms: STALE_TICK_MARKER_THRESHOLD_MS,
    },
  };
}

function normalizePromptDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^sha256:[a-f0-9]{64}$/u.test(trimmed)) return trimmed;
  if (/^[a-f0-9]{64}$/u.test(trimmed)) return `sha256:${trimmed}`;
  return null;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeRunAgentResult(
  value: OrchestratorLiveRunAgentResult,
):
  | {
    ok: true;
    markdown: string;
    agentRunId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    model: string | null;
  }
  | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "RUN_AGENT_FAILED",
      message: "drivers.runAgent result must be an object",
    };
  }

  const runError = isPlainObject(value.error)
    ? (value.error as Record<string, unknown>)
    : null;
  if (runError) {
    return {
      ok: false,
      code: String(runError.code ?? "RUN_AGENT_FAILED"),
      message: String(runError.message ?? "drivers.runAgent returned an error"),
    };
  }

  const markdown = nonEmptyString(value.markdown);
  if (!markdown) {
    return {
      ok: false,
      code: "RUN_AGENT_FAILED",
      message: "drivers.runAgent markdown must be non-empty",
    };
  }

  return {
    ok: true,
    markdown,
    agentRunId: nonEmptyString(value.agent_run_id),
    startedAt: nonEmptyString(value.started_at),
    finishedAt: nonEmptyString(value.finished_at),
    model: nonEmptyString(value.model),
  };
}

async function sidecarPromptDigestMatches(metaPath: string, expectedPromptDigest: string): Promise<boolean> {
  if (!(await exists(metaPath))) return false;
  const raw = await readJson(metaPath);
  if (!isPlainObject(raw)) return false;
  const normalized = normalizePromptDigest((raw as Record<string, unknown>).prompt_digest);
  return normalized === expectedPromptDigest;
}

async function resolveContainedAbsolutePath(args: {
  runRoot: string;
  runRootReal: string;
  input: string;
  field: string;
}): Promise<{ ok: true; absPath: string } | { ok: false; message: string; details: Record<string, unknown> }> {
  const trimmed = args.input.trim();
  const absPath = path.resolve(trimmed);

  let existingPath = absPath;
  while (!(await exists(existingPath))) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      return {
        ok: false,
        message: "path has no existing parent directory",
        details: {
          field: args.field,
          run_root: args.runRoot,
          value: args.input,
          resolved_path: absPath,
        },
      };
    }
    existingPath = parent;
  }

  let existingRealPath: string;
  try {
    existingRealPath = await fs.realpath(existingPath);
  } catch {
    return {
      ok: false,
      message: "failed to canonicalize path",
      details: {
        field: args.field,
        run_root: args.runRoot,
        value: args.input,
        resolved_path: absPath,
      },
    };
  }

  if (!isContainedWithin(args.runRootReal, existingRealPath)) {
    return {
      ok: false,
      message: "path escapes run root",
      details: {
        field: args.field,
        run_root: args.runRoot,
        value: args.input,
        resolved_path: absPath,
      },
    };
  }

  return { ok: true, absPath };
}

function countReviewToSynthesisTransitions(stageObj: Record<string, unknown>): number {
  const history = Array.isArray(stageObj.history)
    ? (stageObj.history as Array<Record<string, unknown>>)
    : [];

  let count = 0;
  for (const entry of history) {
    if (!isPlainObject(entry)) continue;
    const from = String(entry.from ?? "").trim();
    const to = String(entry.to ?? "").trim();
    if (from === "review" && to === "synthesis") count += 1;
  }
  return count;
}

function resolveFinalSynthesisPath(manifest: Record<string, unknown>, runRoot: string): string {
  const pathsObj = getManifestPaths(manifest);
  const synthesisDir = nonEmptyString(pathsObj.synthesis_dir) ?? "synthesis";
  return path.join(runRoot, synthesisDir, "final-synthesis.md");
}

function extractDecisionInputsDigest(value: ToolJsonOk): string | null {
  const decision = isPlainObject(value.decision)
    ? (value.decision as Record<string, unknown>)
    : null;
  return decision && typeof decision.inputs_digest === "string"
    ? decision.inputs_digest
    : null;
}

async function executeToolJson(args: {
  name: string;
  tool: ToolWithExecute;
  payload: Record<string, unknown>;
  tool_context?: unknown;
}): Promise<ToolJsonOk | ToolJsonFailure> {
  let raw: unknown;
  try {
    raw = await args.tool.execute(args.payload, args.tool_context);
  } catch (e) {
    return {
      ok: false,
      code: `${args.name}_THREW`,
      message: `${args.name} execution threw`,
      details: {
        message: String(e),
      },
    };
  }

  if (typeof raw !== "string") {
    return {
      ok: false,
      code: `${args.name}_INVALID_RESPONSE`,
      message: `${args.name} returned non-string response`,
      details: {
        response_type: typeof raw,
      },
    };
  }

  const parsed = parseJsonSafe(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return {
      ok: false,
      code: `${args.name}_INVALID_RESPONSE`,
      message: `${args.name} returned non-JSON response`,
      details: {
        raw,
      },
    };
  }

  const envelope = parsed.value as Record<string, unknown>;
  if (envelope.ok === true) {
    return {
      ok: true,
      ...envelope,
    };
  }

  const upstreamError = isPlainObject(envelope.error)
    ? (envelope.error as Record<string, unknown>)
    : null;
  const upstreamDetails = isPlainObject(upstreamError?.details)
    ? (upstreamError?.details as Record<string, unknown>)
    : {};

  return {
    ok: false,
    code: String(upstreamError?.code ?? `${args.name}_FAILED`),
    message: String(upstreamError?.message ?? `${args.name} failed`),
    details: {
      ...upstreamDetails,
      tool: args.name,
    },
  };
}

export async function orchestrator_tick_post_summaries(
  args: OrchestratorTickPostSummariesArgs,
): Promise<OrchestratorTickPostSummariesResult> {
  const manifestPath = args.manifest_path.trim();
  const gatesPath = args.gates_path.trim();
  const reason = args.reason.trim();
  const driver = args.driver ?? "fixture";

  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    return fail("INVALID_ARGS", "manifest_path must be absolute", {
      manifest_path: args.manifest_path,
    });
  }
  if (!gatesPath || !path.isAbsolute(gatesPath)) {
    return fail("INVALID_ARGS", "gates_path must be absolute", {
      gates_path: args.gates_path,
    });
  }
  if (!reason) return fail("INVALID_ARGS", "reason must be non-empty");

  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(manifestPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return fail("INVALID_JSON", "manifest_path contains invalid JSON", {
        manifest_path: manifestPath,
      });
    }
    return fail("NOT_FOUND", "manifest_path not found", {
      manifest_path: manifestPath,
      message: String(e),
    });
  }

  const manifestValidation = validateManifestV1(manifestRaw);
  if (manifestValidation) {
    return fail("SCHEMA_VALIDATION_FAILED", "manifest validation failed", {
      manifest_path: manifestPath,
      error: manifestValidation,
    });
  }

  const manifest = manifestRaw as Record<string, unknown>;
  const runId = String(manifest.run_id ?? "").trim();
  let manifestRevision = Number(manifest.revision ?? Number.NaN);
  const stageObj = isPlainObject(manifest.stage)
    ? (manifest.stage as Record<string, unknown>)
    : {};
  const from = String(stageObj.current ?? "").trim();
  const status = String(manifest.status ?? "").trim();
  const artifacts = getManifestArtifacts(manifest);
  const runRoot = String(
    (artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath),
  );

  if (!runId) {
    return fail("INVALID_STATE", "manifest.run_id missing", {
      manifest_path: manifestPath,
    });
  }
  if (!Number.isFinite(manifestRevision)) {
    return fail("INVALID_STATE", "manifest.revision invalid", {
      manifest_path: manifestPath,
      revision: manifest.revision ?? null,
    });
  }
  if (!from) {
    return fail("INVALID_STATE", "manifest.stage.current missing", {
      manifest_path: manifestPath,
    });
  }
  if (status === "paused") {
    return fail("PAUSED", "run is paused", {
      manifest_path: manifestPath,
      run_id: runId,
      stage: from,
    });
  }
  if (status === "cancelled") {
    return fail("CANCELLED", "run is cancelled", {
      manifest_path: manifestPath,
      run_id: runId,
      stage: from,
    });
  }
  if (!runRoot || !path.isAbsolute(runRoot)) {
    return fail("INVALID_STATE", "manifest.artifacts.root invalid", {
      manifest_path: manifestPath,
      root: runRoot,
    });
  }

  let runRootReal: string;
  try {
    runRootReal = await fs.realpath(runRoot);
  } catch (e) {
    return fail("INVALID_STATE", "manifest.artifacts.root must resolve to an existing directory", {
      manifest_path: manifestPath,
      root: runRoot,
      message: String(e),
    });
  }

  const runPolicy = await readRunPolicyForRunRoot(runRoot);
  const runLockPolicy = runPolicy.policy.run_lock_policy_v1;

  const lockResult = await acquireRunLock({
    run_root: runRoot,
    lease_seconds: runLockPolicy.lease_seconds,
    reason: `orchestrator_tick_post_summaries: ${reason}`,
  });
  if (!lockResult.ok) {
    return fail(lockResult.code, lockResult.message, lockResult.details);
  }
  const runLockHandle = lockResult.handle;
  const heartbeat = startRunLockHeartbeat({
    handle: runLockHandle,
    interval_ms: runLockPolicy.heartbeat_interval_ms,
    lease_seconds: runLockPolicy.lease_seconds,
    max_failures: runLockPolicy.heartbeat_max_failures,
  });

  let tickMarkerPath: string | null = null;
  let tickSucceeded = false;

  try {
  const staleMarkerCheck = await checkForStaleTickInProgressMarker(runRoot);
  if (!staleMarkerCheck.ok) {
    return fail(
      "PREVIOUS_TICK_INCOMPLETE",
      "previous tick appears incomplete; stale tick marker detected",
      staleMarkerCheck.details,
    );
  }

  tickMarkerPath = await writeTickInProgressMarker({
    runRoot,
    stage: from,
    reason,
  });

  const manifestContained = await resolveContainedAbsolutePath({
    runRoot,
    runRootReal,
    input: manifestPath,
    field: "manifest_path",
  });
  if (!manifestContained.ok) {
    return fail("PATH_TRAVERSAL", manifestContained.message, manifestContained.details);
  }

  const gatesContained = await resolveContainedAbsolutePath({
    runRoot,
    runRootReal,
    input: gatesPath,
    field: "gates_path",
  });
  if (!gatesContained.ok) {
    return fail("PATH_TRAVERSAL", gatesContained.message, gatesContained.details);
  }

  if (from === "finalize") {
    tickSucceeded = true;
    return {
      ok: true,
      schema_version: "orchestrator_tick.post_summaries.v1",
      run_id: runId,
      from,
      to: "finalize",
      decision_inputs_digest: null,
      gate_d_status: null,
      gate_e_status: null,
      review_iteration: null,
      revision_action: null,
    };
  }

  if (from !== "summaries" && from !== "synthesis" && from !== "review") {
    return fail(
      "INVALID_STATE",
      "post-summaries tick only supports summaries|synthesis|review|finalize stages",
      {
        from,
      },
    );
  }

  const summaryPackBuildTool = args.summary_pack_build_tool ?? (summary_pack_build as unknown as ToolWithExecute);
  const gateDEvaluateTool = args.gate_d_evaluate_tool ?? (gate_d_evaluate as unknown as ToolWithExecute);
  const synthesisWriteTool = args.synthesis_write_tool ?? (synthesis_write as unknown as ToolWithExecute);
  const reviewFactoryRunTool = args.review_factory_run_tool ?? (review_factory_run as unknown as ToolWithExecute);
  const gateEReportsTool = args.gate_e_reports_tool ?? (gate_e_reports as unknown as ToolWithExecute);
  const gateEEvaluateTool = args.gate_e_evaluate_tool ?? (gate_e_evaluate as unknown as ToolWithExecute);
  const gateFEvaluateTool = args.gate_f_evaluate_tool ?? (gate_f_evaluate as unknown as ToolWithExecute);
  const revisionControlTool = args.revision_control_tool ?? (revision_control as unknown as ToolWithExecute);
  const gatesWriteTool = args.gates_write_tool ?? (gates_write as unknown as ToolWithExecute);
  const stageAdvanceTool = args.stage_advance_tool ?? (stage_advance as unknown as ToolWithExecute);
  const manifestWriteTool = manifest_write as unknown as ToolWithExecute;

  const requiredTools: Array<{ name: string; tool: ToolWithExecute }> = [
    { name: "SUMMARY_PACK_BUILD", tool: summaryPackBuildTool },
    { name: "GATE_D_EVALUATE", tool: gateDEvaluateTool },
    { name: "SYNTHESIS_WRITE", tool: synthesisWriteTool },
    { name: "REVIEW_FACTORY_RUN", tool: reviewFactoryRunTool },
    { name: "GATE_E_REPORTS", tool: gateEReportsTool },
    { name: "GATE_E_EVALUATE", tool: gateEEvaluateTool },
    { name: "GATE_F_EVALUATE", tool: gateFEvaluateTool },
    { name: "REVISION_CONTROL", tool: revisionControlTool },
    { name: "GATES_WRITE", tool: gatesWriteTool },
    { name: "STAGE_ADVANCE", tool: stageAdvanceTool },
    { name: "MANIFEST_WRITE", tool: manifestWriteTool },
  ];

  for (const requiredTool of requiredTools) {
    if (!requiredTool.tool || typeof requiredTool.tool.execute !== "function") {
      return fail("INVALID_ARGS", `${requiredTool.name.toLowerCase()} tool.execute missing`);
    }
  }

  const runStageAdvance = async (
    requestedNext?: string,
  ): Promise<ToolJsonOk | ToolJsonFailure> => {
    const payload: Record<string, unknown> = {
      manifest_path: manifestPath,
      gates_path: gatesPath,
      expected_manifest_revision: manifestRevision,
      reason,
    };
    if (requestedNext) payload.requested_next = requestedNext;
    return executeToolJson({
      name: "STAGE_ADVANCE",
      tool: stageAdvanceTool,
      payload,
      tool_context: args.tool_context,
    });
  };

  const syncManifestRevision = (
    stageAdvanceResult: ToolJsonOk,
  ): OrchestratorTickPostSummariesFailure | null => {
    const nextRevision = Number(stageAdvanceResult.manifest_revision ?? Number.NaN);
    if (!Number.isFinite(nextRevision)) {
      return fail("INVALID_STATE", "stage_advance returned invalid manifest_revision", {
        manifest_revision: stageAdvanceResult.manifest_revision ?? null,
      });
    }
    manifestRevision = nextRevision;
    return null;
  };

  const markProgress = async (
    checkpoint: string,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string; details: Record<string, unknown> }> => {
    const progress = await executeToolJson({
      name: "MANIFEST_WRITE",
      tool: manifestWriteTool,
      payload: {
        manifest_path: manifestPath,
        patch: {
          stage: {
            last_progress_at: nowIso(),
          },
        },
        expected_revision: manifestRevision,
        reason: `${reason} [progress:${checkpoint}]`,
      },
      tool_context: args.tool_context,
    });

    if (!progress.ok) {
      return {
        ok: false,
        code: progress.code,
        message: progress.message,
        details: progress.details,
      };
    }

    const nextRevision = Number(progress.new_revision ?? Number.NaN);
    if (!Number.isFinite(nextRevision)) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "manifest_write returned invalid new_revision",
        details: {
          new_revision: progress.new_revision ?? null,
        },
      };
    }

    manifestRevision = nextRevision;
    return { ok: true };
  };

  const readGatesRevision = async (): Promise<
    { ok: true; revision: number }
    | { ok: false; failure: OrchestratorTickPostSummariesFailure }
  > => {
    try {
      const gatesDoc = await readJson(gatesPath);
      if (!isPlainObject(gatesDoc)) {
        return {
          ok: false,
          failure: fail("SCHEMA_VALIDATION_FAILED", "gates document must be object", {
            gates_path: gatesPath,
          }),
        };
      }
      const revisionRaw = Number(gatesDoc.revision ?? Number.NaN);
      if (!Number.isFinite(revisionRaw)) {
        return {
          ok: false,
          failure: fail("INVALID_STATE", "gates.revision invalid", {
            gates_path: gatesPath,
            revision: (gatesDoc as Record<string, unknown>).revision ?? null,
          }),
        };
      }
      return {
        ok: true,
        revision: revisionRaw,
      };
    } catch (e) {
      return {
        ok: false,
        failure: fail("NOT_FOUND", "gates_path not found", {
          gates_path: gatesPath,
          message: String(e),
        }),
      };
    }
  };

  if (from === "summaries") {
    let fixtureSummariesDir = args.fixture_summaries_dir?.trim() ?? "";
    let summaryMode: "fixture" | "generate" = fixtureSummariesDir ? "fixture" : "generate";

    const liveRunAgent = driver === "live" && args.drivers && typeof args.drivers.runAgent === "function"
      ? args.drivers.runAgent
      : null;

    if (driver === "task" || liveRunAgent) {
      const pathsObj = getManifestPaths(manifest);
      const summariesDirRel = nonEmptyString(pathsObj.summaries_dir) ?? "summaries";
      const summariesDirAbs = path.join(runRoot, summariesDirRel);

      const queryObj = isPlainObject(manifest.query)
        ? (manifest.query as Record<string, unknown>)
        : {};
      const queryText = nonEmptyString(queryObj.text) ?? "";

      const perspectivesRel = nonEmptyString(pathsObj.perspectives_file) ?? "perspectives.json";
      const perspectivesAbs = path.join(runRoot, perspectivesRel);
      const perspectivesRaw = await readJson(perspectivesAbs);
      if (!isPlainObject(perspectivesRaw)) {
        return fail("SCHEMA_VALIDATION_FAILED", "perspectives.json must be an object", {
          perspectives_path: perspectivesAbs,
        });
      }

      const doc = perspectivesRaw as Record<string, unknown>;
      const perspectives = Array.isArray(doc.perspectives)
        ? (doc.perspectives as Array<Record<string, unknown>>)
        : [];
      const perspectiveEntries = perspectives
        .map((p) => {
          if (!isPlainObject(p)) return null;
          const perspectiveId = String(p.id ?? "").trim();
          if (!perspectiveId) return null;
          return {
            perspective_id: perspectiveId,
            agent_type: nonEmptyString(p.agent_type) ?? "researcher",
          };
        })
        .filter((entry): entry is { perspective_id: string; agent_type: string } => entry !== null)
        .sort((a, b) => a.perspective_id.localeCompare(b.perspective_id));
      if (perspectiveEntries.length === 0) {
        return fail("SCHEMA_VALIDATION_FAILED", "perspectives list is empty", {
          perspectives_path: perspectivesAbs,
        });
      }

      const missing: Array<{
        perspective_id: string;
        agent_type: string;
        output_md: string;
        prompt_md: string;
        prompt_path: string;
        output_path: string;
        meta_path: string;
        prompt_digest: string;
      }> = [];

      for (const perspective of perspectiveEntries) {
        const perspectiveId = perspective.perspective_id;
        const promptMd = [
          "## Query",
          queryText || "(missing)",
          "",
          "## Summary Target",
          `- perspective_id: ${perspectiveId}`,
          "",
          "## Contract",
          "- Write a concise summary for this perspective.",
          "- MUST include citations using [@<cid>] that exist in citations/citations.jsonl.",
          "- MUST NOT include raw URLs.",
          "- Use headings: Findings, Evidence.",
          "",
        ].join("\n");

        const promptDigest = `sha256:${sha256HexLowerUtf8(promptMd)}`;
        const promptPath = path.join(runRoot, "operator", "prompts", "summaries", `${perspectiveId}.md`);
        const outputPath = path.join(summariesDirAbs, `${perspectiveId}.md`);
        const metaPath = path.join(summariesDirAbs, `${perspectiveId}.meta.json`);
        const outputMd = toPosixPath(path.relative(runRoot, outputPath));

        const outputExists = await exists(outputPath);
        const digestMatches = outputExists && await sidecarPromptDigestMatches(metaPath, promptDigest);
        if (digestMatches) continue;

        await fs.mkdir(path.dirname(promptPath), { recursive: true });
        await fs.writeFile(promptPath, promptMd.endsWith("\n") ? promptMd : `${promptMd}\n`, "utf8");
        missing.push({
          perspective_id: perspectiveId,
          agent_type: perspective.agent_type,
          output_md: outputMd,
          prompt_md: promptMd,
          prompt_path: promptPath,
          output_path: outputPath,
          meta_path: metaPath,
          prompt_digest: promptDigest,
        });
      }

      if (missing.length > 0) {
        if (liveRunAgent) {
          for (const missingEntry of missing) {
            let runAgentRaw: OrchestratorLiveRunAgentResult;
            try {
              runAgentRaw = await liveRunAgent({
                run_id: runId,
                stage: "summaries",
                run_root: runRoot,
                perspective_id: missingEntry.perspective_id,
                agent_type: missingEntry.agent_type,
                prompt_md: missingEntry.prompt_md,
                output_md: missingEntry.output_md,
              });
            } catch (e) {
              return fail("RUN_AGENT_FAILED", "drivers.runAgent threw", {
                perspective_id: missingEntry.perspective_id,
                message: String(e),
              });
            }

            const normalizedRunAgent = normalizeRunAgentResult(runAgentRaw);
            if (!normalizedRunAgent.ok) {
              return fail(normalizedRunAgent.code, normalizedRunAgent.message, {
                perspective_id: missingEntry.perspective_id,
              });
            }

            const markdownOut = normalizedRunAgent.markdown.endsWith("\n")
              ? normalizedRunAgent.markdown
              : `${normalizedRunAgent.markdown}\n`;
            const sidecarPayload = {
              schema_version: "wave-output-meta.v1",
              prompt_digest: missingEntry.prompt_digest,
              agent_run_id:
                normalizedRunAgent.agentRunId
                ?? `live:${missingEntry.perspective_id}:${missingEntry.prompt_digest}`,
              ingested_at: nowIso(),
              source_input_path: missingEntry.output_path,
              ...(normalizedRunAgent.startedAt ? { started_at: normalizedRunAgent.startedAt } : {}),
              ...(normalizedRunAgent.finishedAt ? { finished_at: normalizedRunAgent.finishedAt } : {}),
              ...(normalizedRunAgent.model ? { model: normalizedRunAgent.model } : {}),
            };

            try {
              await fs.mkdir(path.dirname(missingEntry.output_path), { recursive: true });
              await fs.writeFile(missingEntry.output_path, markdownOut, "utf8");
              await fs.writeFile(missingEntry.meta_path, `${JSON.stringify(sidecarPayload, null, 2)}\n`, "utf8");
            } catch (e) {
              return fail("WRITE_FAILED", "failed to persist live summary artifacts", {
                perspective_id: missingEntry.perspective_id,
                output_path: missingEntry.output_path,
                meta_path: missingEntry.meta_path,
                message: String(e),
              });
            }
          }
        } else if (driver === "task") {
          return fail("RUN_AGENT_REQUIRED", "Summaries require external agent results via agent-result", {
            stage: "summaries",
            missing_count: missing.length,
            missing_perspectives: missing,
          });
        }
      }

      if (driver === "task" || liveRunAgent) {
        summaryMode = "fixture";
        fixtureSummariesDir = summariesDirAbs;
      }
    }

    if (summaryMode === "fixture" && !path.isAbsolute(fixtureSummariesDir)) {
      return fail("INVALID_ARGS", "fixture_summaries_dir must be absolute in summaries stage", {
        fixture_summaries_dir: args.fixture_summaries_dir ?? null,
        from,
      });
    }

    const summaryPayload: Record<string, unknown> = {
      manifest_path: manifestPath,
      mode: summaryMode,
      reason,
    };
    if (summaryMode === "fixture") {
      summaryPayload.fixture_summaries_dir = fixtureSummariesDir;
    }

    const summaryPack = await executeToolJson({
      name: "SUMMARY_PACK_BUILD",
      tool: summaryPackBuildTool,
      payload: summaryPayload,
      tool_context: args.tool_context,
    });
    if (!summaryPack.ok) {
      return fail(summaryPack.code, summaryPack.message, summaryPack.details);
    }

    const summariesProgress = await markProgress("summary_pack_built");
    if (!summariesProgress.ok) {
      return fail(summariesProgress.code, summariesProgress.message, {
        ...summariesProgress.details,
        checkpoint: "summary_pack_built",
      });
    }

    const gateD = await executeToolJson({
      name: "GATE_D_EVALUATE",
      tool: gateDEvaluateTool,
      payload: {
        manifest_path: manifestPath,
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!gateD.ok) {
      return fail(gateD.code, gateD.message, gateD.details);
    }

    const gateDUpdate = isPlainObject(gateD.update)
      ? (gateD.update as Record<string, unknown>)
      : null;
    const gateDInputsDigest = nonEmptyString(gateD.inputs_digest);
    if (!gateDUpdate || !gateDInputsDigest) {
      return fail("INVALID_STATE", "gate_d_evaluate returned incomplete gate patch", {
        update: gateD.update ?? null,
        inputs_digest: gateD.inputs_digest ?? null,
      });
    }

    const gateDStatus = nonEmptyString(gateD.status);

    const gateDRevision = await readGatesRevision();
    if (!gateDRevision.ok) return gateDRevision.failure;

    const writeGateD = await executeToolJson({
      name: "GATES_WRITE",
      tool: gatesWriteTool,
      payload: {
        gates_path: gatesPath,
        update: gateDUpdate,
        inputs_digest: gateDInputsDigest,
        expected_revision: gateDRevision.revision,
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!writeGateD.ok) {
      return fail(writeGateD.code, writeGateD.message, writeGateD.details);
    }

    const advanceToSynthesis = await runStageAdvance("synthesis");
    if (!advanceToSynthesis.ok) {
      return fail(advanceToSynthesis.code, advanceToSynthesis.message, {
        ...advanceToSynthesis.details,
        from,
        requested_next: "synthesis",
      });
    }

    const summariesRevisionSyncError = syncManifestRevision(advanceToSynthesis);
    if (summariesRevisionSyncError) return summariesRevisionSyncError;

    tickSucceeded = true;
    return {
      ok: true,
      schema_version: "orchestrator_tick.post_summaries.v1",
      run_id: runId,
      from,
      to: String(advanceToSynthesis.to ?? "").trim(),
      decision_inputs_digest: extractDecisionInputsDigest(advanceToSynthesis),
      gate_d_status: gateDStatus,
      gate_e_status: null,
      review_iteration: null,
      revision_action: null,
    };
  }

  const finalSynthesisPath = resolveFinalSynthesisPath(manifest, runRoot);
  const synthesisContained = await resolveContainedAbsolutePath({
    runRoot,
    runRootReal,
    input: finalSynthesisPath,
    field: "manifest.artifacts.paths.synthesis_dir",
  });
  if (!synthesisContained.ok) {
    return fail("PATH_TRAVERSAL", synthesisContained.message, synthesisContained.details);
  }

  if (from === "synthesis") {
    const liveRunAgent = driver === "live" && args.drivers && typeof args.drivers.runAgent === "function"
      ? args.drivers.runAgent
      : null;

    if (driver === "task" || liveRunAgent) {
      const queryObj = isPlainObject(manifest.query)
        ? (manifest.query as Record<string, unknown>)
        : {};
      const queryText = nonEmptyString(queryObj.text) ?? "";

      const promptMd = [
        "## Query",
        queryText || "(missing)",
        "",
        "## Synthesis Target",
        "- Write the final synthesis markdown for this run.",
        "- Output path: synthesis/final-synthesis.md",
        "",
        "## Inputs",
        "- summaries/summary-pack.json",
        "- citations/citations.jsonl",
        "",
        "## Contract",
        "- MUST include citations using [@<cid>] that exist in citations/citations.jsonl.",
        "- MUST NOT include raw URLs.",
        "- Use headings: Summary, Key Findings, Evidence, Caveats.",
        "",
      ].join("\n");

      const promptDigest = `sha256:${sha256HexLowerUtf8(promptMd)}`;
      const promptPath = path.join(runRoot, "operator", "prompts", "synthesis", "final-synthesis.md");
      const outputPath = finalSynthesisPath;
      const outputMd = toPosixPath(path.relative(runRoot, outputPath));
      const metaPath = path.join(path.dirname(finalSynthesisPath), "final-synthesis.meta.json");

      const outputExists = await exists(outputPath);
      const digestMatches = outputExists && await sidecarPromptDigestMatches(metaPath, promptDigest);
      if (!digestMatches) {
        await fs.mkdir(path.dirname(promptPath), { recursive: true });
        await fs.writeFile(promptPath, promptMd.endsWith("\n") ? promptMd : `${promptMd}\n`, "utf8");

        if (liveRunAgent) {
          let runAgentRaw: OrchestratorLiveRunAgentResult;
          try {
            runAgentRaw = await liveRunAgent({
              run_id: runId,
              stage: "synthesis",
              run_root: runRoot,
              perspective_id: "final-synthesis",
              agent_type: "researcher",
              prompt_md: promptMd,
              output_md: outputMd,
            });
          } catch (e) {
            return fail("RUN_AGENT_FAILED", "drivers.runAgent threw", {
              perspective_id: "final-synthesis",
              message: String(e),
            });
          }

          const normalizedRunAgent = normalizeRunAgentResult(runAgentRaw);
          if (!normalizedRunAgent.ok) {
            return fail(normalizedRunAgent.code, normalizedRunAgent.message, {
              perspective_id: "final-synthesis",
            });
          }

          const markdownOut = normalizedRunAgent.markdown.endsWith("\n")
            ? normalizedRunAgent.markdown
            : `${normalizedRunAgent.markdown}\n`;
          const sidecarPayload = {
            schema_version: "wave-output-meta.v1",
            prompt_digest: promptDigest,
            agent_run_id: normalizedRunAgent.agentRunId ?? `live:final-synthesis:${promptDigest}`,
            ingested_at: nowIso(),
            source_input_path: outputPath,
            ...(normalizedRunAgent.startedAt ? { started_at: normalizedRunAgent.startedAt } : {}),
            ...(normalizedRunAgent.finishedAt ? { finished_at: normalizedRunAgent.finishedAt } : {}),
            ...(normalizedRunAgent.model ? { model: normalizedRunAgent.model } : {}),
          };

          try {
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, markdownOut, "utf8");
            await fs.writeFile(metaPath, `${JSON.stringify(sidecarPayload, null, 2)}\n`, "utf8");
          } catch (e) {
            return fail("WRITE_FAILED", "failed to persist live synthesis artifacts", {
              perspective_id: "final-synthesis",
              output_path: outputPath,
              meta_path: metaPath,
              message: String(e),
            });
          }
        } else {
          return fail("RUN_AGENT_REQUIRED", "Synthesis requires external agent results via agent-result", {
            stage: "synthesis",
            missing_count: 1,
            missing_perspectives: [
              {
                perspective_id: "final-synthesis",
                prompt_path: promptPath,
                output_path: outputPath,
                meta_path: metaPath,
                prompt_digest: promptDigest,
              },
            ],
          });
        }
      }

      const synthesisProgress = await markProgress("synthesis_written");
      if (!synthesisProgress.ok) {
        return fail(synthesisProgress.code, synthesisProgress.message, {
          ...synthesisProgress.details,
          checkpoint: "synthesis_written",
        });
      }

      const advanceToReview = await runStageAdvance("review");
      if (!advanceToReview.ok) {
        return fail(advanceToReview.code, advanceToReview.message, {
          ...advanceToReview.details,
          from,
          requested_next: "review",
        });
      }

      const synthesisRevisionSyncError = syncManifestRevision(advanceToReview);
      if (synthesisRevisionSyncError) return synthesisRevisionSyncError;

      tickSucceeded = true;
      return {
        ok: true,
        schema_version: "orchestrator_tick.post_summaries.v1",
        run_id: runId,
        from,
        to: String(advanceToReview.to ?? "").trim(),
        decision_inputs_digest: extractDecisionInputsDigest(advanceToReview),
        gate_d_status: null,
        gate_e_status: null,
        review_iteration: null,
        revision_action: null,
      };
    }

    const fixtureDraftPath = args.fixture_draft_path?.trim() ?? "";
    const synthesisMode: "fixture" | "generate" = fixtureDraftPath ? "fixture" : "generate";
    if (synthesisMode === "fixture" && !path.isAbsolute(fixtureDraftPath)) {
      return fail("INVALID_ARGS", "fixture_draft_path must be absolute in synthesis stage", {
        fixture_draft_path: args.fixture_draft_path ?? null,
        from,
      });
    }

    const synthesisPayload: Record<string, unknown> = {
      manifest_path: manifestPath,
      mode: synthesisMode,
      output_path: finalSynthesisPath,
      reason,
    };
    if (synthesisMode === "fixture") {
      synthesisPayload.fixture_draft_path = fixtureDraftPath;
    }

    const writeSynthesis = await executeToolJson({
      name: "SYNTHESIS_WRITE",
      tool: synthesisWriteTool,
      payload: synthesisPayload,
      tool_context: args.tool_context,
    });
    if (!writeSynthesis.ok) {
      return fail(writeSynthesis.code, writeSynthesis.message, writeSynthesis.details);
    }

    const synthesisProgress = await markProgress("synthesis_written");
    if (!synthesisProgress.ok) {
      return fail(synthesisProgress.code, synthesisProgress.message, {
        ...synthesisProgress.details,
        checkpoint: "synthesis_written",
      });
    }

    const advanceToReview = await runStageAdvance("review");
    if (!advanceToReview.ok) {
      return fail(advanceToReview.code, advanceToReview.message, {
        ...advanceToReview.details,
        from,
        requested_next: "review",
      });
    }

    const synthesisRevisionSyncError = syncManifestRevision(advanceToReview);
    if (synthesisRevisionSyncError) return synthesisRevisionSyncError;

    tickSucceeded = true;
    return {
      ok: true,
      schema_version: "orchestrator_tick.post_summaries.v1",
      run_id: runId,
      from,
      to: String(advanceToReview.to ?? "").trim(),
      decision_inputs_digest: extractDecisionInputsDigest(advanceToReview),
      gate_d_status: null,
      gate_e_status: null,
      review_iteration: null,
      revision_action: null,
    };
  }

  const fixtureBundleDir = args.fixture_bundle_dir?.trim() ?? "";
  const reviewMode: "fixture" | "generate" = fixtureBundleDir ? "fixture" : "generate";
  if (reviewMode === "fixture" && !path.isAbsolute(fixtureBundleDir)) {
    return fail("INVALID_ARGS", "fixture_bundle_dir must be absolute in review stage", {
      fixture_bundle_dir: args.fixture_bundle_dir ?? null,
      from,
    });
  }

  const reviewIteration = countReviewToSynthesisTransitions(stageObj) + 1;

  const reviewBundle = await executeToolJson({
    name: "REVIEW_FACTORY_RUN",
    tool: reviewFactoryRunTool,
    payload: {
      manifest_path: manifestPath,
      draft_path: finalSynthesisPath,
      mode: reviewMode,
      ...(reviewMode === "fixture" ? { fixture_bundle_dir: fixtureBundleDir } : {}),
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!reviewBundle.ok) {
    return fail(reviewBundle.code, reviewBundle.message, reviewBundle.details);
  }

  const reviewBundlePath = nonEmptyString(reviewBundle.review_bundle_path);
  if (!reviewBundlePath || !path.isAbsolute(reviewBundlePath)) {
    return fail("INVALID_STATE", "review_factory_run returned invalid review_bundle_path", {
      review_bundle_path: reviewBundle.review_bundle_path ?? null,
    });
  }

  const reviewDecision = nonEmptyString(reviewBundle.decision);

  const reports = await executeToolJson({
    name: "GATE_E_REPORTS",
    tool: gateEReportsTool,
    payload: {
      manifest_path: manifestPath,
      synthesis_path: finalSynthesisPath,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!reports.ok) {
    return fail(reports.code, reports.message, reports.details);
  }

  const gateE = await executeToolJson({
    name: "GATE_E_EVALUATE",
    tool: gateEEvaluateTool,
    payload: {
      manifest_path: manifestPath,
      synthesis_path: finalSynthesisPath,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!gateE.ok) {
    return fail(gateE.code, gateE.message, gateE.details);
  }

  const gateEUpdate = isPlainObject(gateE.update)
    ? (gateE.update as Record<string, unknown>)
    : null;
  const gateEInputsDigest = nonEmptyString(gateE.inputs_digest);
  if (!gateEUpdate || !gateEInputsDigest) {
    return fail("INVALID_STATE", "gate_e_evaluate returned incomplete gate patch", {
      update: gateE.update ?? null,
      inputs_digest: gateE.inputs_digest ?? null,
    });
  }

  const gateEStatus = nonEmptyString(gateE.status);

  const gateERevision = await readGatesRevision();
  if (!gateERevision.ok) return gateERevision.failure;

  const writeGateE = await executeToolJson({
    name: "GATES_WRITE",
    tool: gatesWriteTool,
    payload: {
      gates_path: gatesPath,
      update: gateEUpdate,
      inputs_digest: gateEInputsDigest,
      expected_revision: gateERevision.revision,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!writeGateE.ok) {
    return fail(writeGateE.code, writeGateE.message, writeGateE.details);
  }

  const revisionControlResult = await executeToolJson({
    name: "REVISION_CONTROL",
    tool: revisionControlTool,
    payload: {
      manifest_path: manifestPath,
      gates_path: gatesPath,
      review_bundle_path: reviewBundlePath,
      current_iteration: reviewIteration,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!revisionControlResult.ok) {
    return fail(revisionControlResult.code, revisionControlResult.message, revisionControlResult.details);
  }

  const revisionAction = nonEmptyString(revisionControlResult.action);

  const reviewProgress = await markProgress(`review_iteration_completed:${reviewIteration}`);
  if (!reviewProgress.ok) {
    return fail(reviewProgress.code, reviewProgress.message, {
      ...reviewProgress.details,
      checkpoint: "review_iteration_completed",
      review_iteration: reviewIteration,
    });
  }

  if (reviewDecision === "PASS") {
    const gateF = await executeToolJson({
      name: "GATE_F_EVALUATE",
      tool: gateFEvaluateTool,
      payload: {
        manifest_path: manifestPath,
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!gateF.ok) {
      return fail(gateF.code, gateF.message, gateF.details);
    }

    const gateFUpdate = isPlainObject(gateF.update)
      ? (gateF.update as Record<string, unknown>)
      : null;
    const gateFInputsDigest = nonEmptyString(gateF.inputs_digest);
    if (!gateFUpdate || !gateFInputsDigest) {
      return fail("INVALID_STATE", "gate_f_evaluate returned incomplete gate patch", {
        update: gateF.update ?? null,
        inputs_digest: gateF.inputs_digest ?? null,
      });
    }

    const gateFRevision = await readGatesRevision();
    if (!gateFRevision.ok) return gateFRevision.failure;

    const writeGateF = await executeToolJson({
      name: "GATES_WRITE",
      tool: gatesWriteTool,
      payload: {
        gates_path: gatesPath,
        update: gateFUpdate,
        inputs_digest: gateFInputsDigest,
        expected_revision: gateFRevision.revision,
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!writeGateF.ok) {
      return fail(writeGateF.code, writeGateF.message, writeGateF.details);
    }
  }

  const requestedNext = reviewDecision === "PASS"
    ? "finalize"
    : reviewDecision === "CHANGES_REQUIRED"
      ? "synthesis"
      : undefined;

  const advanceFromReview = await runStageAdvance(requestedNext);
  if (!advanceFromReview.ok) {
    return fail(advanceFromReview.code, advanceFromReview.message, {
      ...advanceFromReview.details,
      from,
    });
  }

  const reviewRevisionSyncError = syncManifestRevision(advanceFromReview);
  if (reviewRevisionSyncError) return reviewRevisionSyncError;

  const to = String(advanceFromReview.to ?? "").trim();
  if (reviewDecision === "CHANGES_REQUIRED" && to === "finalize") {
    return fail("INVALID_STATE", "review decision CHANGES_REQUIRED cannot transition to finalize", {
      from,
      to,
      review_decision: reviewDecision,
    });
  }

  tickSucceeded = true;
  return {
    ok: true,
    schema_version: "orchestrator_tick.post_summaries.v1",
    run_id: runId,
    from,
    to,
    decision_inputs_digest: extractDecisionInputsDigest(advanceFromReview),
    gate_d_status: null,
    gate_e_status: gateEStatus,
    review_iteration: reviewIteration,
    revision_action: revisionAction,
  };
  } finally {
    if (tickSucceeded && tickMarkerPath) {
      await removeTickInProgressMarker(tickMarkerPath);
    }
    heartbeat.stop();
    await releaseRunLock(runLockHandle).catch(() => undefined);
  }
}
