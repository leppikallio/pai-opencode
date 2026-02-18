import * as path from "node:path";
import * as fs from "node:fs/promises";

import { acquireRunLock, releaseRunLock, startRunLockHeartbeat } from "./run_lock";
import {
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
import { gate_b_derive } from "./gate_b_derive";
import { gates_write } from "./gates_write";
import { retry_record } from "./retry_record";
import { stage_advance } from "./stage_advance";
import { wave_output_ingest } from "./wave_output_ingest";
import { wave_output_validate } from "./wave_output_validate";
import { wave_review } from "./wave_review";
import { wave1_plan } from "./wave1_plan";

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

export type OrchestratorLiveRunAgentInput = {
  run_id: string;
  stage: string;
  run_root: string;
  perspective_id: string;
  agent_type: string;
  prompt_md: string;
  output_md: string;
};

export type OrchestratorLiveRunAgentResult = {
  markdown: string;
  agent_run_id?: string;
  started_at?: string;
  finished_at?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type OrchestratorLiveDrivers = {
  runAgent: (
    input: OrchestratorLiveRunAgentInput,
  ) => Promise<OrchestratorLiveRunAgentResult> | OrchestratorLiveRunAgentResult;
};

export type OrchestratorTickLiveArgs = {
  manifest_path: string;
  gates_path: string;
  reason: string;
  drivers: OrchestratorLiveDrivers;
  wave1_plan_tool?: ToolWithExecute;
  wave_output_ingest_tool?: ToolWithExecute;
  wave_output_validate_tool?: ToolWithExecute;
  wave_review_tool?: ToolWithExecute;
  gate_b_derive_tool?: ToolWithExecute;
  gates_write_tool?: ToolWithExecute;
  retry_record_tool?: ToolWithExecute;
  stage_advance_tool?: ToolWithExecute;
  tool_context?: unknown;
};

export type OrchestratorTickLiveSuccess = {
  ok: true;
  schema_version: "orchestrator_tick.live.v1";
  run_id: string;
  from: string;
  to: string;
  wave_outputs_count: number;
  decision_inputs_digest: string | null;
};

export type OrchestratorTickLiveFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type OrchestratorTickLiveResult =
  | OrchestratorTickLiveSuccess
  | OrchestratorTickLiveFailure;

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): OrchestratorTickLiveFailure {
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

async function resolveContainedPath(args: {
  runRoot: string;
  runRootReal: string;
  input: string;
  field: string;
}): Promise<{ ok: true; absPath: string } | { ok: false; reason: string; details: Record<string, unknown> }> {
  const trimmed = args.input.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: "path is empty",
      details: { field: args.field, value: args.input },
    };
  }

  const absPath = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(args.runRoot, trimmed);
  const runRootAbs = path.resolve(args.runRoot);
  if (!isContainedWithin(runRootAbs, absPath)) {
    return {
      ok: false,
      reason: "path escapes run root",
      details: {
        field: args.field,
        run_root: args.runRoot,
        value: args.input,
        resolved_path: absPath,
      },
    };
  }

  let existingPath = absPath;
  while (!(await exists(existingPath))) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      return {
        ok: false,
        reason: "path has no existing parent directory",
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
  } catch (e) {
    return {
      ok: false,
      reason: "failed to canonicalize path",
      details: {
        field: args.field,
        value: args.input,
        resolved_path: absPath,
        existing_path: existingPath,
        message: String(e),
      },
    };
  }

  if (!isContainedWithin(args.runRootReal, existingRealPath)) {
    return {
      ok: false,
      reason: "path escapes run root",
      details: {
        field: args.field,
        run_root: args.runRoot,
        run_root_real: args.runRootReal,
        value: args.input,
        resolved_path: absPath,
        existing_path: existingPath,
        existing_real_path: existingRealPath,
      },
    };
  }

  return { ok: true, absPath };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

function normalizeRunAgentResult(
  value: unknown,
): { ok: true; markdown: string } | { ok: false; code: string; message: string } {
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
  };
}

type PlannedWave1Entry = {
  perspectiveId: string;
  agentType: string;
  promptMd: string;
  outputMd: string;
  outputMarkdownPath: string;
  sidecarPath: string;
};

function getGateRetryCount(manifest: Record<string, unknown>, gateId: "A" | "B" | "C" | "D" | "E" | "F"): number {
  const metrics = isPlainObject(manifest.metrics)
    ? (manifest.metrics as Record<string, unknown>)
    : null;
  const retryCounts = metrics && isPlainObject(metrics.retry_counts)
    ? (metrics.retry_counts as Record<string, unknown>)
    : null;
  const raw = retryCounts ? retryCounts[gateId] : null;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

const WAVE_OUTPUT_VALIDATE_RETRY_CODES = new Set<string>([
  "MISSING_REQUIRED_SECTION",
  "TOO_MANY_WORDS",
  "MALFORMED_SOURCES",
  "TOO_MANY_SOURCES",
]);

function shouldDeferValidationFailure(code: string): boolean {
  return WAVE_OUTPUT_VALIDATE_RETRY_CODES.has(code);
}

function toRetryDirectives(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isPlainObject(entry));
}

function getRetryChangeNote(retryDirectives: Array<Record<string, unknown>>): string {
  for (const directive of retryDirectives) {
    const note = nonEmptyString(directive.change_note);
    if (note) return note;
  }
  return `wave_review emitted ${retryDirectives.length} retry directives`;
}

async function outputCreatedAtIso(outputMarkdownPath: string): Promise<string> {
  try {
    const stat = await fs.stat(outputMarkdownPath);
    return stat.mtime.toISOString();
  } catch {
    return nowIso();
  }
}

async function writeOutputMetadataSidecar(args: {
  sidecarPath: string;
  perspectiveId: string;
  agentType: string;
  outputMd: string;
  promptMd: string;
  retryCount: number;
  createdAt: string;
}): Promise<void> {
  const payload = {
    perspective_id: args.perspectiveId,
    agent_type: args.agentType,
    output_md: args.outputMd,
    prompt_digest: `sha256:${sha256HexLowerUtf8(args.promptMd)}`,
    created_at: args.createdAt,
    retry_count: args.retryCount,
  };
  await fs.mkdir(path.dirname(args.sidecarPath), { recursive: true });
  await fs.writeFile(args.sidecarPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function orchestrator_tick_live(
  args: OrchestratorTickLiveArgs,
): Promise<OrchestratorTickLiveResult> {
  const manifestPath = args.manifest_path.trim();
  const gatesPath = args.gates_path.trim();
  const reason = args.reason.trim();

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
  if (!isPlainObject(args.drivers) || typeof args.drivers.runAgent !== "function") {
    return fail("INVALID_ARGS", "drivers.runAgent must be a function");
  }

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

  const lockResult = await acquireRunLock({
    run_root: runRoot,
    lease_seconds: 120,
    reason: `orchestrator_tick_live: ${reason}`,
  });
  if (!lockResult.ok) {
    return fail(lockResult.code, lockResult.message, lockResult.details);
  }
  const runLockHandle = lockResult.handle;
  const heartbeat = startRunLockHeartbeat({
    handle: runLockHandle,
    interval_ms: 30_000,
    lease_seconds: 120,
  });

  try {

  const pathsObj = getManifestPaths(manifest);
  const perspectivesResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.perspectives_file ?? "perspectives.json"),
    field: "manifest.artifacts.paths.perspectives_file",
  });
  if (!perspectivesResolved.ok) {
    return fail("PATH_TRAVERSAL", perspectivesResolved.reason, perspectivesResolved.details);
  }
  const perspectivesPath = perspectivesResolved.absPath;

  const wave1DirResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.wave1_dir ?? "wave-1"),
    field: "manifest.artifacts.paths.wave1_dir",
  });
  if (!wave1DirResolved.ok) {
    return fail("PATH_TRAVERSAL", wave1DirResolved.reason, wave1DirResolved.details);
  }
  const wave1DirPath = wave1DirResolved.absPath;

  const waveReviewResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.wave_review_report_file ?? "wave-review.json"),
    field: "manifest.artifacts.paths.wave_review_report_file",
  });
  if (!waveReviewResolved.ok) {
    return fail("PATH_TRAVERSAL", waveReviewResolved.reason, waveReviewResolved.details);
  }
  const waveReviewPath = waveReviewResolved.absPath;

  const wave1PlanTool = args.wave1_plan_tool ?? (wave1_plan as unknown as ToolWithExecute);
  const waveOutputIngestTool = args.wave_output_ingest_tool ?? (wave_output_ingest as unknown as ToolWithExecute);
  const waveOutputValidateTool = args.wave_output_validate_tool ?? (wave_output_validate as unknown as ToolWithExecute);
  const waveReviewTool = args.wave_review_tool ?? (wave_review as unknown as ToolWithExecute);
  const gateBDeriveTool = args.gate_b_derive_tool ?? (gate_b_derive as unknown as ToolWithExecute);
  const gatesWriteTool = args.gates_write_tool ?? (gates_write as unknown as ToolWithExecute);
  const retryRecordTool = args.retry_record_tool ?? (retry_record as unknown as ToolWithExecute);
  const stageAdvanceTool = args.stage_advance_tool ?? (stage_advance as unknown as ToolWithExecute);

  const requiredTools: Array<{ name: string; tool: ToolWithExecute }> = [
    { name: "WAVE1_PLAN", tool: wave1PlanTool },
    { name: "WAVE_OUTPUT_INGEST", tool: waveOutputIngestTool },
    { name: "WAVE_OUTPUT_VALIDATE", tool: waveOutputValidateTool },
    { name: "WAVE_REVIEW", tool: waveReviewTool },
    { name: "GATE_B_DERIVE", tool: gateBDeriveTool },
    { name: "GATES_WRITE", tool: gatesWriteTool },
    { name: "RETRY_RECORD", tool: retryRecordTool },
    { name: "STAGE_ADVANCE", tool: stageAdvanceTool },
  ];
  for (const requiredTool of requiredTools) {
    if (!requiredTool.tool || typeof requiredTool.tool.execute !== "function") {
      return fail("INVALID_ARGS", `${requiredTool.name.toLowerCase()} tool.execute missing`);
    }
  }

  const runStageAdvance = async (
    requestedNext: string,
  ): Promise<ToolJsonOk | ToolJsonFailure> => executeToolJson({
    name: "STAGE_ADVANCE",
    tool: stageAdvanceTool,
    payload: {
        manifest_path: manifestPath,
        gates_path: gatesPath,
        requested_next: requestedNext,
        expected_manifest_revision: manifestRevision,
        reason,
      },
      tool_context: args.tool_context,
    });

  const syncManifestRevision = (
    stageAdvanceResult: ToolJsonOk,
  ): OrchestratorTickLiveFailure | null => {
    const nextRevision = Number(stageAdvanceResult.manifest_revision ?? Number.NaN);
    if (!Number.isFinite(nextRevision)) {
      return fail("INVALID_STATE", "stage_advance returned invalid manifest_revision", {
        manifest_revision: stageAdvanceResult.manifest_revision ?? null,
      });
    }
    manifestRevision = nextRevision;
    return null;
  };

  let currentStage = from;
  if (currentStage === "init") {
    const initAdvance = await runStageAdvance("wave1");
    if (!initAdvance.ok) {
      return fail(initAdvance.code, initAdvance.message, {
        ...initAdvance.details,
        from: currentStage,
        requested_next: "wave1",
      });
    }

    const revisionSyncError = syncManifestRevision(initAdvance);
    if (revisionSyncError) return revisionSyncError;

    const to = String(initAdvance.to ?? "").trim();
    if (to !== "wave1") {
      return fail("INVALID_STATE", "expected init transition to wave1", {
        from: currentStage,
        to,
      });
    }
    currentStage = "wave1";
  }

  if (currentStage === "pivot") {
    return {
      ok: true,
      schema_version: "orchestrator_tick.live.v1",
      run_id: runId,
      from,
      to: "pivot",
      wave_outputs_count: 0,
      decision_inputs_digest: null,
    };
  }

  if (currentStage !== "wave1") {
    return fail("INVALID_STATE", "orchestrator tick live only supports init|wave1|pivot stages", {
      from,
      current_stage: currentStage,
    });
  }

  const planPath = path.join(wave1DirPath, "wave1-plan.json");
  const planExists = await exists(planPath);
  if (!planExists) {
    const planResult = await executeToolJson({
      name: "WAVE1_PLAN",
      tool: wave1PlanTool,
      payload: {
        manifest_path: manifestPath,
        perspectives_path: perspectivesPath,
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!planResult.ok) {
      return fail(planResult.code, planResult.message, planResult.details);
    }

    const returnedPlanPath = nonEmptyString(planResult.plan_path);
    if (!returnedPlanPath || !path.isAbsolute(returnedPlanPath)) {
      return fail("INVALID_STATE", "wave1_plan returned invalid plan_path", {
        plan_path: planResult.plan_path ?? null,
      });
    }

    if (path.resolve(returnedPlanPath) !== path.resolve(planPath)) {
      return fail("INVALID_STATE", "wave1_plan returned unexpected plan_path", {
        expected_plan_path: planPath,
        plan_path: returnedPlanPath,
      });
    }
  }

  let planRaw: unknown;
  try {
    planRaw = await readJson(planPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return fail("INVALID_JSON", "wave1 plan contains invalid JSON", {
        plan_path: planPath,
      });
    }
    return fail("NOT_FOUND", "wave1 plan not found", {
      plan_path: planPath,
      message: String(e),
    });
  }

  if (!isPlainObject(planRaw)) {
    return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan must be an object", {
      plan_path: planPath,
    });
  }

  const entries = Array.isArray(planRaw.entries)
    ? (planRaw.entries as Array<Record<string, unknown>>)
    : null;
  if (!entries || entries.length === 0) {
    return fail("INVALID_STATE", "wave1 plan entries missing", {
      plan_path: planPath,
    });
  }

  const plannedEntries: PlannedWave1Entry[] = [];
  const seenPerspectiveIds = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const entryRaw = entries[i];
    if (!isPlainObject(entryRaw)) {
      return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan entry must be object", {
        plan_path: planPath,
        index: i,
      });
    }

    const perspectiveId = nonEmptyString(entryRaw.perspective_id);
    const agentType = nonEmptyString(entryRaw.agent_type);
    const promptMd = nonEmptyString(entryRaw.prompt_md);
    const outputMd = nonEmptyString(entryRaw.output_md);

    if (!perspectiveId || !agentType || !promptMd || !outputMd) {
      return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan entry is missing required fields", {
        index: i,
        entry: entryRaw,
      });
    }

    if (seenPerspectiveIds.has(perspectiveId)) {
      return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan contains duplicate perspective_id", {
        perspective_id: perspectiveId,
      });
    }
    seenPerspectiveIds.add(perspectiveId);

    const outputMarkdownResolved = await resolveContainedPath({
      runRoot,
      runRootReal,
      input: outputMd,
      field: `wave1_plan.entries[${i}].output_md`,
    });
    if (!outputMarkdownResolved.ok) {
      return fail("PATH_TRAVERSAL", outputMarkdownResolved.reason, outputMarkdownResolved.details);
    }

    const sidecarInput = outputMd.endsWith(".md")
      ? `${outputMd.slice(0, -3)}.meta.json`
      : `${outputMd}.meta.json`;
    const sidecarResolved = await resolveContainedPath({
      runRoot,
      runRootReal,
      input: sidecarInput,
      field: `wave1_plan.entries[${i}].meta_path`,
    });
    if (!sidecarResolved.ok) {
      return fail("PATH_TRAVERSAL", sidecarResolved.reason, sidecarResolved.details);
    }

    plannedEntries.push({
      perspectiveId,
      agentType,
      promptMd,
      outputMd,
      outputMarkdownPath: outputMarkdownResolved.absPath,
      sidecarPath: sidecarResolved.absPath,
    });
  }

  const gateBRetryCount = getGateRetryCount(manifest, "B");
  const deferredValidationFailures: Array<Record<string, unknown>> = [];

  const retryDirectivesResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: "retry/retry-directives.json",
    field: "retry.retry_directives_file",
  });
  if (!retryDirectivesResolved.ok) {
    return fail("PATH_TRAVERSAL", retryDirectivesResolved.reason, retryDirectivesResolved.details);
  }
  const retryDirectivesPath = retryDirectivesResolved.absPath;

  const activeRetryNotesByPerspective = new Map<string, string>();
  if (await exists(retryDirectivesPath)) {
    try {
      const retryRaw = await readJson(retryDirectivesPath);
      if (isPlainObject(retryRaw)) {
        const consumedAt = nonEmptyString((retryRaw as Record<string, unknown>).consumed_at);
        if (!consumedAt) {
          const directivesRaw = (retryRaw as Record<string, unknown>).retry_directives;
          if (Array.isArray(directivesRaw)) {
            for (const directive of directivesRaw) {
              if (!isPlainObject(directive)) continue;
              const pid = nonEmptyString((directive as Record<string, unknown>).perspective_id);
              if (!pid) continue;
              const note = nonEmptyString((directive as Record<string, unknown>).change_note) ?? "";
              activeRetryNotesByPerspective.set(pid, note);
            }
          }
        }
      }
    } catch {
      // best effort only
    }
  }

  for (const entry of plannedEntries) {
    const outputAlreadyExists = await exists(entry.outputMarkdownPath);
    const retryNote = activeRetryNotesByPerspective.get(entry.perspectiveId) ?? null;
    if (!outputAlreadyExists || retryNote !== null) {
      const effectivePromptMd = retryNote
        ? `${entry.promptMd}\n\n## Retry Directive\n${retryNote}\n`
        : entry.promptMd;

      let runAgentRaw: OrchestratorLiveRunAgentResult;
      try {
        runAgentRaw = await args.drivers.runAgent({
          run_id: runId,
          stage: currentStage,
          run_root: runRoot,
          perspective_id: entry.perspectiveId,
          agent_type: entry.agentType,
          prompt_md: effectivePromptMd,
          output_md: entry.outputMd,
        });
      } catch (e) {
        return fail("RUN_AGENT_FAILED", "drivers.runAgent threw", {
          perspective_id: entry.perspectiveId,
          message: String(e),
        });
      }

      const normalizedRunAgent = normalizeRunAgentResult(runAgentRaw);
      if (!normalizedRunAgent.ok) {
        return fail(normalizedRunAgent.code, normalizedRunAgent.message, {
          perspective_id: entry.perspectiveId,
        });
      }

      const ingestResult = await executeToolJson({
        name: "WAVE_OUTPUT_INGEST",
        tool: waveOutputIngestTool,
        payload: {
          manifest_path: manifestPath,
          perspectives_path: perspectivesPath,
          wave: "wave1",
          outputs: [
            {
              perspective_id: entry.perspectiveId,
              markdown: normalizedRunAgent.markdown,
              agent_type: entry.agentType,
              prompt_md: effectivePromptMd,
            },
          ],
        },
        tool_context: args.tool_context,
      });
      if (!ingestResult.ok) {
        return fail(ingestResult.code, ingestResult.message, {
          ...ingestResult.details,
          perspective_id: entry.perspectiveId,
        });
      }
    }

    const validateResult = await executeToolJson({
      name: "WAVE_OUTPUT_VALIDATE",
      tool: waveOutputValidateTool,
      payload: {
        perspectives_path: perspectivesPath,
        perspective_id: entry.perspectiveId,
        markdown_path: entry.outputMarkdownPath,
      },
      tool_context: args.tool_context,
    });
    if (!validateResult.ok) {
      if (!shouldDeferValidationFailure(validateResult.code)) {
        return fail(validateResult.code, validateResult.message, {
          ...validateResult.details,
          perspective_id: entry.perspectiveId,
          markdown_path: entry.outputMarkdownPath,
        });
      }
      deferredValidationFailures.push({
        perspective_id: entry.perspectiveId,
        code: validateResult.code,
        message: validateResult.message,
      });
    }

    try {
      await writeOutputMetadataSidecar({
        sidecarPath: entry.sidecarPath,
        perspectiveId: entry.perspectiveId,
        agentType: entry.agentType,
        outputMd: entry.outputMd,
        promptMd: retryNote
          ? `${entry.promptMd}\n\n## Retry Directive\n${retryNote}\n`
          : entry.promptMd,
        retryCount: gateBRetryCount,
        createdAt: await outputCreatedAtIso(entry.outputMarkdownPath),
      });
    } catch (e) {
      return fail("WRITE_FAILED", "failed to persist wave output metadata sidecar", {
        perspective_id: entry.perspectiveId,
        sidecar_path: entry.sidecarPath,
        message: String(e),
      });
    }
  }

  const plannedPerspectiveIds = plannedEntries.map((entry) => entry.perspectiveId);
  const reviewResult = await executeToolJson({
    name: "WAVE_REVIEW",
    tool: waveReviewTool,
    payload: {
      perspectives_path: perspectivesPath,
      outputs_dir: wave1DirPath,
      perspective_ids: plannedPerspectiveIds,
      report_path: waveReviewPath,
    },
    tool_context: args.tool_context,
  });
  if (!reviewResult.ok) {
    return fail(reviewResult.code, reviewResult.message, reviewResult.details);
  }

  const gateBDeriveResult = await executeToolJson({
    name: "GATE_B_DERIVE",
    tool: gateBDeriveTool,
    payload: {
      manifest_path: manifestPath,
      wave_review_report_path: waveReviewPath,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!gateBDeriveResult.ok) {
    return fail(gateBDeriveResult.code, gateBDeriveResult.message, gateBDeriveResult.details);
  }

  const gateUpdate = isPlainObject(gateBDeriveResult.update)
    ? (gateBDeriveResult.update as Record<string, unknown>)
    : null;
  const gateInputsDigest = nonEmptyString(gateBDeriveResult.inputs_digest);
  if (!gateUpdate || !gateInputsDigest) {
    return fail("INVALID_STATE", "gate_b_derive returned incomplete gate patch", {
      update: gateBDeriveResult.update ?? null,
      inputs_digest: gateBDeriveResult.inputs_digest ?? null,
    });
  }

  let gatesRevision: number | null = null;
  try {
    const gatesDoc = await readJson(gatesPath);
    if (!isPlainObject(gatesDoc)) {
      return fail("SCHEMA_VALIDATION_FAILED", "gates document must be object", {
        gates_path: gatesPath,
      });
    }
    const revisionRaw = Number(gatesDoc.revision ?? Number.NaN);
    if (!Number.isFinite(revisionRaw)) {
      return fail("INVALID_STATE", "gates.revision invalid", {
        gates_path: gatesPath,
        revision: (gatesDoc as Record<string, unknown>).revision ?? null,
      });
    }
    gatesRevision = revisionRaw;
  } catch (e) {
    return fail("NOT_FOUND", "gates_path not found", {
      gates_path: gatesPath,
      message: String(e),
    });
  }

  const gatesWriteResult = await executeToolJson({
    name: "GATES_WRITE",
    tool: gatesWriteTool,
    payload: {
      gates_path: gatesPath,
      update: gateUpdate,
      inputs_digest: gateInputsDigest,
      expected_revision: gatesRevision ?? undefined,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!gatesWriteResult.ok) {
    return fail(gatesWriteResult.code, gatesWriteResult.message, gatesWriteResult.details);
  }

  const retryDirectives = toRetryDirectives(reviewResult.retry_directives);
  if (retryDirectives.length === 0 && activeRetryNotesByPerspective.size > 0) {
    try {
      const retryRaw = await readJson(retryDirectivesPath);
      if (isPlainObject(retryRaw)) {
        const retryDoc = retryRaw as Record<string, unknown>;
        retryDoc.consumed_at = nowIso();
        await fs.mkdir(path.dirname(retryDirectivesPath), { recursive: true });
        await fs.writeFile(retryDirectivesPath, `${JSON.stringify(retryDoc, null, 2)}\n`, "utf8");
      }
    } catch {
      // best effort only
    }
  }
  if (retryDirectives.length > 0) {
    const retryArtifact = {
      schema_version: "wave1.retry_directives.v1",
      run_id: runId,
      stage: currentStage,
      generated_at: nowIso(),
      consumed_at: null,
      retry_directives: retryDirectives,
      deferred_validation_failures: deferredValidationFailures,
    };
    try {
      await fs.mkdir(path.dirname(retryDirectivesPath), { recursive: true });
      await fs.writeFile(retryDirectivesPath, `${JSON.stringify(retryArtifact, null, 2)}\n`, "utf8");
    } catch (e) {
      return fail("WRITE_FAILED", "failed to write retry directives artifact", {
        retry_directives_path: retryDirectivesPath,
        message: String(e),
      });
    }

    const retryRecordResult = await executeToolJson({
      name: "RETRY_RECORD",
      tool: retryRecordTool,
      payload: {
        manifest_path: manifestPath,
        gate_id: "B",
        change_note: getRetryChangeNote(retryDirectives),
        reason,
      },
      tool_context: args.tool_context,
    });
    if (!retryRecordResult.ok) {
      if (retryRecordResult.code === "RETRY_EXHAUSTED") {
        return fail("RETRY_CAP_EXHAUSTED", "wave1 retry cap exhausted", {
          ...retryRecordResult.details,
          gate_id: "B",
          retry_directives_count: retryDirectives.length,
          retry_directives_path: retryDirectivesPath,
          perspective_ids: retryDirectives.map((directive) => String(directive.perspective_id ?? "")).filter(Boolean),
        });
      }
      return fail(retryRecordResult.code, retryRecordResult.message, {
        ...retryRecordResult.details,
        retry_directives_path: retryDirectivesPath,
      });
    }

    return fail("RETRY_REQUIRED", "wave1 outputs require retry before pivot", {
      gate_id: "B",
      retry_count: retryRecordResult.retry_count ?? null,
      max_retries: retryRecordResult.max_retries ?? null,
      retry_directives_count: retryDirectives.length,
      retry_directives_path: retryDirectivesPath,
      perspective_ids: retryDirectives.map((directive) => String(directive.perspective_id ?? "")).filter(Boolean),
      deferred_validation_failures: deferredValidationFailures,
    });
  }

  const finalAdvance = await runStageAdvance("pivot");
  if (!finalAdvance.ok) {
    return fail(finalAdvance.code, finalAdvance.message, {
      ...finalAdvance.details,
      from: currentStage,
      requested_next: "pivot",
    });
  }

  const finalRevisionSyncError = syncManifestRevision(finalAdvance);
  if (finalRevisionSyncError) return finalRevisionSyncError;

  const to = String(finalAdvance.to ?? "").trim();
  const decisionObj = isPlainObject(finalAdvance.decision)
    ? (finalAdvance.decision as Record<string, unknown>)
    : null;
  const decisionInputsDigest =
    decisionObj && typeof decisionObj.inputs_digest === "string"
      ? decisionObj.inputs_digest
      : null;

  return {
    ok: true,
    schema_version: "orchestrator_tick.live.v1",
    run_id: runId,
    from,
    to,
    wave_outputs_count: plannedEntries.length,
    decision_inputs_digest: decisionInputsDigest,
  };
  } finally {
    heartbeat.stop();
    await releaseRunLock(runLockHandle).catch(() => undefined);
  }
}
