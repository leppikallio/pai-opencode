import {
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
} from "../../../tools/deep_research.ts";
import { defaultFixtureDriver } from "../drivers/fixture-driver";
import { readJsonObject } from "../lib/io-json";
import { summarizeManifest } from "../lib/run-handle";
import { makeToolContext } from "../runtime/tool-context";

export type TickDriver = "fixture" | "live" | "task";

export type TickResult =
  | OrchestratorTickFixtureResult
  | OrchestratorTickLiveResult
  | OrchestratorTickPostPivotResult
  | OrchestratorTickPostSummariesResult;

export type TickLiveDriver = (
  input: OrchestratorLiveRunAgentInput,
) => Promise<OrchestratorLiveRunAgentResult>;

export async function runOneOrchestratorTick(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  driver: TickDriver;
  stageHint?: string;
  liveDriver?: TickLiveDriver | null;
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
