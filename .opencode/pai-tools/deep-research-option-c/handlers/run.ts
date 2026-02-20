import {
  watchdog_check,
} from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { blockersSummaryJson } from "../triage/blockers";
import { handleTickFailureArtifacts } from "../triage/halt-artifacts";
import { readJsonObject } from "../lib/io-json";
import {
  printContract,
  resolveRunHandle,
  summarizeManifest,
  type ManifestSummary,
} from "../lib/run-handle";
import {
  resultErrorDetails,
  toolErrorDetails,
} from "../cli/errors";
import {
  beginTickObservability,
  finalizeTickObservability,
} from "../observability/tick-observability";
import {
  callTool,
  type ToolEnvelope,
  type ToolWithExecute,
} from "../runtime/tool-envelope";
import { emitJson } from "../cli/json-mode";
import { createOperatorInputDriver } from "../drivers/operator-input-driver";
import {
  runOneOrchestratorTick,
  type TickResult,
} from "./tick-internals";

type RunHandleCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

export type RunCliArgs = RunHandleCliArgs & {
  reason: string;
  driver: "fixture" | "live";
  maxTicks: number;
  until?: string;
  json?: boolean;
};

function nextStepCliInvocation(): string {
  return `bun "pai-tools/${["deep-research-option-c", "ts"].join(".")}"`;
}

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

export async function runRun(args: RunCliArgs): Promise<void> {
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
        nextStepCliInvocation,
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
