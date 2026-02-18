import * as path from "node:path";
import * as fs from "node:fs/promises";

import { acquireRunLock, releaseRunLock, startRunLockHeartbeat } from "./run_lock";
import {
  type ToolWithExecute,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  parseJsonSafe,
  readJson,
  validateManifestV1,
} from "./lifecycle_lib";
import { gate_b_derive } from "./gate_b_derive";
import { gates_write } from "./gates_write";
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

function gateBPassInDoc(doc: unknown): boolean {
  if (!isPlainObject(doc)) return false;
  const gatesObj = isPlainObject(doc.gates) ? (doc.gates as Record<string, unknown>) : null;
  const gateB = gatesObj && isPlainObject(gatesObj.B) ? (gatesObj.B as Record<string, unknown>) : null;
  return String(gateB?.status ?? "").trim().toLowerCase() === "pass";
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
  const stageAdvanceTool = args.stage_advance_tool ?? (stage_advance as unknown as ToolWithExecute);

  const requiredTools: Array<{ name: string; tool: ToolWithExecute }> = [
    { name: "WAVE1_PLAN", tool: wave1PlanTool },
    { name: "WAVE_OUTPUT_INGEST", tool: waveOutputIngestTool },
    { name: "WAVE_OUTPUT_VALIDATE", tool: waveOutputValidateTool },
    { name: "WAVE_REVIEW", tool: waveReviewTool },
    { name: "GATE_B_DERIVE", tool: gateBDeriveTool },
    { name: "GATES_WRITE", tool: gatesWriteTool },
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

  const firstEntryRaw = entries[0];
  if (!isPlainObject(firstEntryRaw)) {
    return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan first entry must be object", {
      plan_path: planPath,
    });
  }

  const perspectiveId = nonEmptyString(firstEntryRaw.perspective_id);
  const agentType = nonEmptyString(firstEntryRaw.agent_type);
  const promptMd = nonEmptyString(firstEntryRaw.prompt_md);
  const outputMd = nonEmptyString(firstEntryRaw.output_md);

  if (!perspectiveId || !agentType || !promptMd || !outputMd) {
    return fail("SCHEMA_VALIDATION_FAILED", "wave1 plan entry is missing required fields", {
      entry: firstEntryRaw,
    });
  }

  const outputMarkdownResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: outputMd,
    field: "wave1_plan.entries[0].output_md",
  });
  if (!outputMarkdownResolved.ok) {
    return fail("PATH_TRAVERSAL", outputMarkdownResolved.reason, outputMarkdownResolved.details);
  }
  const outputMarkdownPath = outputMarkdownResolved.absPath;

  const outputAlreadyExists = await exists(outputMarkdownPath);
  if (!outputAlreadyExists) {
    let runAgentRaw: OrchestratorLiveRunAgentResult;
    try {
      runAgentRaw = await args.drivers.runAgent({
        run_id: runId,
        stage: currentStage,
        run_root: runRoot,
        perspective_id: perspectiveId,
        agent_type: agentType,
        prompt_md: promptMd,
        output_md: outputMd,
      });
    } catch (e) {
      return fail("RUN_AGENT_FAILED", "drivers.runAgent threw", {
        perspective_id: perspectiveId,
        message: String(e),
      });
    }

    const normalizedRunAgent = normalizeRunAgentResult(runAgentRaw);
    if (!normalizedRunAgent.ok) {
      return fail(normalizedRunAgent.code, normalizedRunAgent.message, {
        perspective_id: perspectiveId,
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
            perspective_id: perspectiveId,
            markdown: normalizedRunAgent.markdown,
            agent_type: agentType,
            prompt_md: promptMd,
          },
        ],
      },
      tool_context: args.tool_context,
    });
    if (!ingestResult.ok) {
      return fail(ingestResult.code, ingestResult.message, ingestResult.details);
    }
  }

  const validateResult = await executeToolJson({
    name: "WAVE_OUTPUT_VALIDATE",
    tool: waveOutputValidateTool,
    payload: {
      perspectives_path: perspectivesPath,
      perspective_id: perspectiveId,
      markdown_path: outputMarkdownPath,
    },
    tool_context: args.tool_context,
  });
  if (!validateResult.ok) {
    return fail(validateResult.code, validateResult.message, validateResult.details);
  }

  const waveReviewExists = await exists(waveReviewPath);
  if (!waveReviewExists) {
    const reviewResult = await executeToolJson({
      name: "WAVE_REVIEW",
      tool: waveReviewTool,
      payload: {
        perspectives_path: perspectivesPath,
        outputs_dir: wave1DirPath,
        perspective_ids: [perspectiveId],
        report_path: waveReviewPath,
      },
      tool_context: args.tool_context,
    });
    if (!reviewResult.ok) {
      return fail(reviewResult.code, reviewResult.message, reviewResult.details);
    }
  }

  let gateBAlreadyPass = false;
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
    gateBAlreadyPass = gateBPassInDoc(gatesDoc);
  } catch (e) {
    return fail("NOT_FOUND", "gates_path not found", {
      gates_path: gatesPath,
      message: String(e),
    });
  }

  if (!gateBAlreadyPass) {
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

    const nextGatesRevision = Number(gatesWriteResult.new_revision ?? Number.NaN);
    if (!Number.isFinite(nextGatesRevision)) {
      return fail("INVALID_STATE", "gates_write returned invalid new_revision", {
        new_revision: gatesWriteResult.new_revision ?? null,
      });
    }
    gatesRevision = nextGatesRevision;
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
    wave_outputs_count: 1,
    decision_inputs_digest: decisionInputsDigest,
  };
  } finally {
    heartbeat.stop();
    await releaseRunLock(runLockHandle).catch(() => undefined);
  }
}
