import * as path from "node:path";

import {
  type ToolWithExecute,
  getManifestArtifacts,
  getStringProp,
  isPlainObject,
  parseJsonSafe,
  readJson,
  validateManifestV1,
} from "./lifecycle_lib";
import { stage_advance } from "./stage_advance";

export type FixtureWaveOutput = {
  perspective_id: string;
  output_path?: string;
};

export type OrchestratorFixtureDriverArgs = {
  run_id: string;
  stage: string;
  run_root: string;
};

export type OrchestratorFixtureDriverResult = {
  wave_outputs: FixtureWaveOutput[];
  requested_next?: string;
};

export type OrchestratorFixtureDriver = (
  args: OrchestratorFixtureDriverArgs,
) => Promise<OrchestratorFixtureDriverResult> | OrchestratorFixtureDriverResult;

export type OrchestratorTickFixtureArgs = {
  manifest_path: string;
  gates_path: string;
  reason: string;
  fixture_driver: OrchestratorFixtureDriver;
  stage_advance_tool?: ToolWithExecute;
  tool_context?: unknown;
};

export type OrchestratorTickFixtureSuccess = {
  ok: true;
  schema_version: "orchestrator_tick.fixture.v1";
  run_id: string;
  from: string;
  to: string;
  requested_next: string | null;
  wave_outputs_count: number;
  wave_outputs: FixtureWaveOutput[];
  decision_inputs_digest: string | null;
};

export type OrchestratorTickFixtureFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type OrchestratorTickFixtureResult =
  | OrchestratorTickFixtureSuccess
  | OrchestratorTickFixtureFailure;

function fail(code: string, message: string, details: Record<string, unknown> = {}): OrchestratorTickFixtureFailure {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function normalizeWaveOutputs(value: unknown): FixtureWaveOutput[] | null {
  if (!Array.isArray(value)) return null;

  const out: FixtureWaveOutput[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;

    const perspectiveId = String(item.perspective_id ?? "").trim();
    if (!perspectiveId) return null;

    const normalized: FixtureWaveOutput = { perspective_id: perspectiveId };
    const outputPathRaw = item.output_path;
    if (typeof outputPathRaw === "string" && outputPathRaw.trim()) {
      normalized.output_path = outputPathRaw.trim();
    }

    out.push(normalized);
  }

  return out;
}

export async function orchestrator_tick_fixture(args: OrchestratorTickFixtureArgs): Promise<OrchestratorTickFixtureResult> {
  const manifestPath = args.manifest_path.trim();
  const gatesPath = args.gates_path.trim();
  const reason = args.reason.trim();

  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    return fail("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
  }
  if (!gatesPath || !path.isAbsolute(gatesPath)) {
    return fail("INVALID_ARGS", "gates_path must be absolute", { gates_path: args.gates_path });
  }
  if (!reason) {
    return fail("INVALID_ARGS", "reason must be non-empty");
  }
  if (typeof args.fixture_driver !== "function") {
    return fail("INVALID_ARGS", "fixture_driver must be a function");
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(manifestPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return fail("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
    }
    return fail("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath, message: String(e) });
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
  const stageObj = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
  const from = String(stageObj.current ?? "").trim();
  const artifacts = getManifestArtifacts(manifest);
  const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

  if (!runId) return fail("INVALID_STATE", "manifest.run_id missing", { manifest_path: manifestPath });
  if (!from) return fail("INVALID_STATE", "manifest.stage.current missing", { manifest_path: manifestPath });
  if (!runRoot || !path.isAbsolute(runRoot)) {
    return fail("INVALID_STATE", "manifest.artifacts.root invalid", { manifest_path: manifestPath, root: runRoot });
  }

  let fixtureDriverRaw: OrchestratorFixtureDriverResult;
  try {
    fixtureDriverRaw = await args.fixture_driver({ run_id: runId, stage: from, run_root: runRoot });
  } catch (e) {
    return fail("FIXTURE_DRIVER_FAILED", "fixture driver failed", { message: String(e), stage: from });
  }

  if (!isPlainObject(fixtureDriverRaw)) {
    return fail("SCHEMA_VALIDATION_FAILED", "fixture driver result must be object");
  }

  const waveOutputs = normalizeWaveOutputs(fixtureDriverRaw.wave_outputs);
  if (!waveOutputs) {
    return fail("SCHEMA_VALIDATION_FAILED", "fixture driver wave_outputs invalid", {
      expected: "Array<{ perspective_id: string; output_path?: string }>",
    });
  }

  const requestedNextRaw = fixtureDriverRaw.requested_next;
  const requestedNext = typeof requestedNextRaw === "string" && requestedNextRaw.trim()
    ? requestedNextRaw.trim()
    : undefined;

  const stageAdvanceTool = args.stage_advance_tool ?? (stage_advance as unknown as ToolWithExecute);
  if (!stageAdvanceTool || typeof stageAdvanceTool.execute !== "function") {
    return fail("INVALID_ARGS", "stage_advance_tool.execute missing");
  }

  const stageAdvanceExecuteArgs = {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    requested_next: requestedNext,
    reason,
  };

  let stageAdvanceRaw: unknown;
  try {
    stageAdvanceRaw = await stageAdvanceTool.execute(stageAdvanceExecuteArgs, args.tool_context);
  } catch (e) {
    return fail("STAGE_ADVANCE_FAILED", "stage_advance execution threw", {
      message: String(e),
      from,
      requested_next: requestedNext ?? null,
    });
  }

  if (typeof stageAdvanceRaw !== "string") {
    return fail("STAGE_ADVANCE_FAILED", "stage_advance returned non-string response", {
      response_type: typeof stageAdvanceRaw,
    });
  }

  const stageAdvanceParsed = parseJsonSafe(stageAdvanceRaw);
  if (!stageAdvanceParsed.ok || !isPlainObject(stageAdvanceParsed.value)) {
    return fail("STAGE_ADVANCE_FAILED", "stage_advance returned non-JSON response", {
      raw: stageAdvanceRaw,
    });
  }

  const stageAdvance = stageAdvanceParsed.value as Record<string, unknown>;
  const stageAdvanceOk = stageAdvance.ok === true;
  if (!stageAdvanceOk) {
    const stageAdvanceError = isPlainObject(stageAdvance.error)
      ? (stageAdvance.error as Record<string, unknown>)
      : null;

    const code = String(stageAdvanceError?.code ?? "STAGE_ADVANCE_FAILED");
    const message = String(stageAdvanceError?.message ?? "stage_advance rejected transition");

    return fail(code, message, {
      from,
      requested_next: requestedNext ?? null,
      wave_outputs_count: waveOutputs.length,
      stage_advance_error_code: code,
      stage_advance: stageAdvance,
    });
  }

  const to = String(stageAdvance.to ?? "").trim();
  const decision = isPlainObject(stageAdvance.decision)
    ? (stageAdvance.decision as Record<string, unknown>)
    : null;
  const inputsDigest = decision && typeof decision.inputs_digest === "string" ? decision.inputs_digest : null;

  return {
    ok: true,
    schema_version: "orchestrator_tick.fixture.v1",
    run_id: runId,
    from,
    to,
    requested_next: requestedNext ?? null,
    wave_outputs_count: waveOutputs.length,
    wave_outputs: waveOutputs,
    decision_inputs_digest: inputsDigest,
  };
}
