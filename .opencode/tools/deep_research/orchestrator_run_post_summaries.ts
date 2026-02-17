import * as path from "node:path";

import { isPlainObject, readJson, validateManifestV1 } from "./lifecycle_lib";
import {
  orchestrator_tick_post_summaries,
  type OrchestratorTickPostSummariesArgs,
} from "./orchestrator_tick_post_summaries";

const DEFAULT_MAX_TICKS = 8;

export type OrchestratorPostSummariesDrivers = {
  getReviewFixtureBundleDir?: (iteration: number) => string | null | undefined;
};

export type OrchestratorRunPostSummariesArgs = Omit<
  OrchestratorTickPostSummariesArgs,
  "reason" | "fixture_bundle_dir"
> & {
  reason: string;
  max_ticks?: number;
  review_fixture_bundle_dir?: string;
  drivers?: OrchestratorPostSummariesDrivers;
};

export type OrchestratorRunPostSummariesSuccess = {
  ok: true;
  schema_version: "orchestrator_run.post_summaries.v1";
  run_id: string;
  start_stage: string;
  end_stage: string;
  ticks_executed: number;
  decision_inputs_digest: string | null;
};

export type OrchestratorRunPostSummariesFailure = {
  ok: false;
  schema_version: "orchestrator_run.post_summaries.v1";
  run_id: string | null;
  start_stage: string | null;
  end_stage: string | null;
  ticks_executed: number;
  decision_inputs_digest: string | null;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type OrchestratorRunPostSummariesResult =
  | OrchestratorRunPostSummariesSuccess
  | OrchestratorRunPostSummariesFailure;

function fail(args: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  run_id: string | null;
  start_stage: string | null;
  end_stage: string | null;
  ticks_executed: number;
  decision_inputs_digest: string | null;
}): OrchestratorRunPostSummariesFailure {
  return {
    ok: false,
    schema_version: "orchestrator_run.post_summaries.v1",
    run_id: args.run_id,
    start_stage: args.start_stage,
    end_stage: args.end_stage,
    ticks_executed: args.ticks_executed,
    decision_inputs_digest: args.decision_inputs_digest,
    error: {
      code: args.code,
      message: args.message,
      details: args.details ?? {},
    },
  };
}

function normalizeMaxTicks(value: number | undefined): number | null {
  if (value === undefined) return DEFAULT_MAX_TICKS;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  if (normalized < 1) return null;
  return normalized;
}

export async function orchestrator_run_post_summaries(
  args: OrchestratorRunPostSummariesArgs,
): Promise<OrchestratorRunPostSummariesResult> {
  const manifestPath = args.manifest_path.trim();
  const gatesPath = args.gates_path.trim();
  const reason = args.reason.trim();
  const maxTicks = normalizeMaxTicks(args.max_ticks);

  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    return fail({
      code: "INVALID_ARGS",
      message: "manifest_path must be absolute",
      details: { manifest_path: args.manifest_path },
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (!gatesPath || !path.isAbsolute(gatesPath)) {
    return fail({
      code: "INVALID_ARGS",
      message: "gates_path must be absolute",
      details: { gates_path: args.gates_path },
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (!reason) {
    return fail({
      code: "INVALID_ARGS",
      message: "reason must be non-empty",
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (maxTicks === null) {
    return fail({
      code: "INVALID_ARGS",
      message: "max_ticks must be an integer >= 1",
      details: { max_ticks: args.max_ticks ?? null },
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(manifestPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return fail({
        code: "INVALID_JSON",
        message: "manifest_path contains invalid JSON",
        details: { manifest_path: manifestPath },
        run_id: null,
        start_stage: null,
        end_stage: null,
        ticks_executed: 0,
        decision_inputs_digest: null,
      });
    }

    return fail({
      code: "NOT_FOUND",
      message: "manifest_path not found",
      details: {
        manifest_path: manifestPath,
        message: String(e),
      },
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  const manifestValidation = validateManifestV1(manifestRaw);
  if (manifestValidation) {
    return fail({
      code: "SCHEMA_VALIDATION_FAILED",
      message: "manifest validation failed",
      details: {
        manifest_path: manifestPath,
        error: manifestValidation,
      },
      run_id: null,
      start_stage: null,
      end_stage: null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  const manifest = manifestRaw as Record<string, unknown>;
  const runId = String(manifest.run_id ?? "").trim();
  const stageObj = isPlainObject(manifest.stage)
    ? (manifest.stage as Record<string, unknown>)
    : {};
  const startStage = String(stageObj.current ?? "").trim();

  if (!runId || !startStage) {
    return fail({
      code: "INVALID_STATE",
      message: "manifest run metadata missing",
      details: {
        run_id: runId || null,
        start_stage: startStage || null,
      },
      run_id: runId || null,
      start_stage: startStage || null,
      end_stage: startStage || null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (
    startStage !== "summaries"
    && startStage !== "synthesis"
    && startStage !== "review"
    && startStage !== "finalize"
  ) {
    return fail({
      code: "INVALID_STATE",
      message: "orchestrator_run_post_summaries requires summaries|synthesis|review|finalize stage",
      details: { start_stage: startStage },
      run_id: runId,
      start_stage: startStage,
      end_stage: startStage,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (startStage === "finalize") {
    return {
      ok: true,
      schema_version: "orchestrator_run.post_summaries.v1",
      run_id: runId,
      start_stage: startStage,
      end_stage: "finalize",
      ticks_executed: 0,
      decision_inputs_digest: null,
    };
  }

  let currentStage = startStage;
  let ticksExecuted = 0;
  let decisionInputsDigest: string | null = null;
  let reviewIteration = 0;

  while (ticksExecuted < maxTicks) {
    let reviewFixtureBundleDir = args.review_fixture_bundle_dir;
    if (currentStage === "review") {
      reviewIteration += 1;
      const chooser = args.drivers?.getReviewFixtureBundleDir;
      if (chooser) {
        try {
          const selected = chooser(reviewIteration);
          if (typeof selected === "string" && selected.trim()) {
            reviewFixtureBundleDir = selected.trim();
          }
        } catch (e) {
          return fail({
            code: "REVIEW_FIXTURE_DRIVER_FAILED",
            message: "drivers.getReviewFixtureBundleDir threw",
            details: {
              review_iteration: reviewIteration,
              message: String(e),
            },
            run_id: runId,
            start_stage: startStage,
            end_stage: currentStage,
            ticks_executed: ticksExecuted,
            decision_inputs_digest: decisionInputsDigest,
          });
        }
      }
    }

    const tick = await orchestrator_tick_post_summaries({
      manifest_path: manifestPath,
      gates_path: gatesPath,
      reason,
      fixture_summaries_dir: args.fixture_summaries_dir,
      fixture_draft_path: args.fixture_draft_path,
      fixture_bundle_dir: reviewFixtureBundleDir,
      summary_pack_build_tool: args.summary_pack_build_tool,
      gate_d_evaluate_tool: args.gate_d_evaluate_tool,
      synthesis_write_tool: args.synthesis_write_tool,
      review_factory_run_tool: args.review_factory_run_tool,
      gate_e_reports_tool: args.gate_e_reports_tool,
      gate_e_evaluate_tool: args.gate_e_evaluate_tool,
      revision_control_tool: args.revision_control_tool,
      gates_write_tool: args.gates_write_tool,
      stage_advance_tool: args.stage_advance_tool,
      tool_context: args.tool_context,
    });

    if (!tick.ok) {
      return fail({
        code: tick.error.code,
        message: tick.error.message,
        details: {
          ...tick.error.details,
          tick_index: ticksExecuted + 1,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }

    ticksExecuted += 1;

    if (tick.run_id !== runId) {
      return fail({
        code: "INVALID_STATE",
        message: "orchestrator_tick_post_summaries returned mismatched run_id",
        details: {
          expected_run_id: runId,
          tick_run_id: tick.run_id,
          tick_index: ticksExecuted,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }

    const previousStage = currentStage;
    currentStage = tick.to;

    if (typeof tick.decision_inputs_digest === "string" && tick.decision_inputs_digest.trim()) {
      decisionInputsDigest = tick.decision_inputs_digest;
    }

    if (currentStage === "finalize") {
      return {
        ok: true,
        schema_version: "orchestrator_run.post_summaries.v1",
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      };
    }

    if (currentStage === previousStage) {
      return fail({
        code: "INVALID_STATE",
        message: "post-summaries orchestrator made no stage progress",
        details: {
          stage: currentStage,
          tick_index: ticksExecuted,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }
  }

  return fail({
    code: "TICK_CAP_EXCEEDED",
    message: "max_ticks reached before finalize",
    details: {
      max_ticks: maxTicks,
      current_stage: currentStage,
    },
    run_id: runId,
    start_stage: startStage,
    end_stage: currentStage,
    ticks_executed: ticksExecuted,
    decision_inputs_digest: decisionInputsDigest,
  });
}
