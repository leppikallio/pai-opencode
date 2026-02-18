import * as path from "node:path";

import { type ToolWithExecute, isPlainObject, readJson, validateManifestV1 } from "./lifecycle_lib";
import {
  orchestrator_tick_post_pivot,
  type OrchestratorTickPostPivotArgs,
} from "./orchestrator_tick_post_pivot";
import { executeWatchdogJson } from "./orchestrator_watchdog";
import { watchdog_check } from "./watchdog_check";

const DEFAULT_MAX_TICKS = 5;

export type OrchestratorRunPostPivotArgs = Omit<OrchestratorTickPostPivotArgs, "reason"> & {
  reason: string;
  max_ticks?: number;
  watchdog_check_tool?: ToolWithExecute;
};

export type OrchestratorRunPostPivotSuccess = {
  ok: true;
  schema_version: "orchestrator_run.post_pivot.v1";
  run_id: string;
  start_stage: string;
  end_stage: string;
  ticks_executed: number;
  decision_inputs_digest: string | null;
};

export type OrchestratorRunPostPivotFailure = {
  ok: false;
  schema_version: "orchestrator_run.post_pivot.v1";
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

export type OrchestratorRunPostPivotResult =
  | OrchestratorRunPostPivotSuccess
  | OrchestratorRunPostPivotFailure;

function fail(args: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  run_id: string | null;
  start_stage: string | null;
  end_stage: string | null;
  ticks_executed: number;
  decision_inputs_digest: string | null;
}): OrchestratorRunPostPivotFailure {
  return {
    ok: false,
    schema_version: "orchestrator_run.post_pivot.v1",
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

export async function orchestrator_run_post_pivot(
  args: OrchestratorRunPostPivotArgs,
): Promise<OrchestratorRunPostPivotResult> {
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

  const watchdogTool = args.watchdog_check_tool ?? (watchdog_check as unknown as ToolWithExecute);
  if (!watchdogTool || typeof watchdogTool.execute !== "function") {
    return fail({
      code: "INVALID_ARGS",
      message: "watchdog_check_tool.execute missing",
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
      details: { run_id: runId || null, start_stage: startStage || null },
      run_id: runId || null,
      start_stage: startStage || null,
      end_stage: startStage || null,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (startStage !== "pivot" && startStage !== "citations" && startStage !== "summaries") {
    return fail({
      code: "INVALID_STATE",
      message: "orchestrator_run_post_pivot requires pivot|citations|summaries stage",
      details: { start_stage: startStage },
      run_id: runId,
      start_stage: startStage,
      end_stage: startStage,
      ticks_executed: 0,
      decision_inputs_digest: null,
    });
  }

  if (startStage === "summaries") {
    return {
      ok: true,
      schema_version: "orchestrator_run.post_pivot.v1",
      run_id: runId,
      start_stage: startStage,
      end_stage: "summaries",
      ticks_executed: 0,
      decision_inputs_digest: null,
    };
  }

  let currentStage = startStage;
  let ticksExecuted = 0;
  let decisionInputsDigest: string | null = null;

  while (ticksExecuted < maxTicks) {
    const preWatchdog = await executeWatchdogJson({
      watchdogTool,
      payload: {
        manifest_path: manifestPath,
        stage: currentStage,
        reason: `${reason} [pre_tick_${ticksExecuted + 1}]`,
      },
      tool_context: args.tool_context,
    });
    if (!preWatchdog.ok) {
      return fail({
        code: preWatchdog.code,
        message: preWatchdog.message,
        details: {
          ...preWatchdog.details,
          phase: "pre_tick",
          tick_index: ticksExecuted + 1,
          stage: currentStage,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }
    if (preWatchdog.timed_out) {
      return fail({
        code: "WATCHDOG_TIMEOUT",
        message: "stage timed out before tick execution",
        details: {
          phase: "pre_tick",
          tick_index: ticksExecuted + 1,
          stage: preWatchdog.stage ?? currentStage,
          elapsed_s: preWatchdog.elapsed_s ?? null,
          timeout_s: preWatchdog.timeout_s ?? null,
          checkpoint_path: preWatchdog.checkpoint_path ?? null,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }

    const tick = await orchestrator_tick_post_pivot({
      ...args,
      manifest_path: manifestPath,
      gates_path: gatesPath,
      reason,
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
        message: "orchestrator_tick_post_pivot returned mismatched run_id",
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

    const postWatchdog = await executeWatchdogJson({
      watchdogTool,
      payload: {
        manifest_path: manifestPath,
        stage: currentStage,
        reason: `${reason} [post_tick_${ticksExecuted}]`,
      },
      tool_context: args.tool_context,
    });
    if (!postWatchdog.ok) {
      return fail({
        code: postWatchdog.code,
        message: postWatchdog.message,
        details: {
          ...postWatchdog.details,
          phase: "post_tick",
          tick_index: ticksExecuted,
          stage: currentStage,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }
    if (postWatchdog.timed_out) {
      return fail({
        code: "WATCHDOG_TIMEOUT",
        message: "stage timed out after tick execution",
        details: {
          phase: "post_tick",
          tick_index: ticksExecuted,
          stage: postWatchdog.stage ?? currentStage,
          elapsed_s: postWatchdog.elapsed_s ?? null,
          timeout_s: postWatchdog.timeout_s ?? null,
          checkpoint_path: postWatchdog.checkpoint_path ?? null,
        },
        run_id: runId,
        start_stage: startStage,
        end_stage: currentStage,
        ticks_executed: ticksExecuted,
        decision_inputs_digest: decisionInputsDigest,
      });
    }

    if (currentStage === "summaries") {
      return {
        ok: true,
        schema_version: "orchestrator_run.post_pivot.v1",
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
        message: "post-pivot orchestrator made no stage progress",
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
    message: "max_ticks reached before summaries",
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
