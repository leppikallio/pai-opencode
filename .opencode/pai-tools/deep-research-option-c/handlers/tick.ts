import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type OrchestratorLiveRunAgentInput,
  type OrchestratorLiveRunAgentResult,
  watchdog_check,
} from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { sha256DigestForJson } from "../../../tools/deep_research/wave_tools_shared";
import { blockersSummaryJson, type TriageBlockers } from "../triage/blockers";
import {
  handleTickFailureArtifacts,
} from "../triage/halt-artifacts";
import { emitJson } from "../cli/json-mode";
import {
  isSafeSegment,
} from "../utils/paths";
import {
  asObject,
  readJsonObject,
} from "../utils/io-json";
import {
  fileExists,
} from "../utils/fs-utils";
import {
  printContract,
  resolveRunHandle,
  summarizeManifest,
} from "../utils/run-handle";
import {
  resultErrorDetails,
  throwWithCodeAndDetails,
  toolErrorDetails,
} from "../cli/errors";
import {
  beginTickObservability,
  finalizeTickObservability,
} from "../observability/tick-observability";
import {
  normalizePromptDigest,
  promptDigestFromPromptMarkdown,
} from "../utils/digest";
import { type TaskDriverMissingPerspective } from "../perspectives/state";
import {
  callTool,
  type ToolWithExecute,
} from "../tooling/tool-envelope";
import { createOperatorInputDriver } from "../drivers/operator-input-driver";
import {
  runOneOrchestratorTick,
  type TickDriver,
  type TickLiveDriver,
  type TickResult,
} from "./tick-internals";

export type RunHandleCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

export type TickCliArgs = RunHandleCliArgs & {
  reason: string;
  driver: TickDriver;
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

async function readWave1PlanEntries(args: {
  runRoot: string;
  manifest: Record<string, unknown>;
}): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave1PlanPath = path.join(args.runRoot, "wave-1", "wave1-plan.json");
  const wave1Plan = await readJsonObject(wave1PlanPath);

  const perspectivesPath = path.join(args.runRoot, "perspectives.json");
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

function createTaskPromptOutDriver(): TickLiveDriver {
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

function printTickResult(driver: TickDriver, result: TickResult): void {
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

export async function runTick(args: TickCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const liveDriver: TickLiveDriver | null = args.driver === "fixture"
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
      nextStepCliInvocation,
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
