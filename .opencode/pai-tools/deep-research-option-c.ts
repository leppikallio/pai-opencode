#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import type { Type } from "cmd-ts";
import {
  runSafely,
  subcommands,
} from "cmd-ts";

import {
  manifest_write,
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
  watchdog_check,
} from "../tools/deep_research.ts";
import {
  resolveDeepResearchFlagsV1,
} from "../tools/deep_research/lifecycle_lib";
import { sha256DigestForJson } from "../tools/deep_research/wave_tools_shared";
import { createAgentResultCmd } from "./deep-research-option-c/cmd/agent-result";
import { createCancelCmd } from "./deep-research-option-c/cmd/cancel";
import { createCaptureFixturesCmd } from "./deep-research-option-c/cmd/capture-fixtures";
import { createInitCmd } from "./deep-research-option-c/cmd/init";
import { createInspectCmd } from "./deep-research-option-c/cmd/inspect";
import { createPauseCmd } from "./deep-research-option-c/cmd/pause";
import { createPerspectivesDraftCmd } from "./deep-research-option-c/cmd/perspectives-draft";
import { createResumeCmd } from "./deep-research-option-c/cmd/resume";
import { createRerunCmd } from "./deep-research-option-c/cmd/rerun";
import { createRunCmd } from "./deep-research-option-c/cmd/run";
import { createStageAdvanceCmd } from "./deep-research-option-c/cmd/stage-advance";
import { createStatusCmd } from "./deep-research-option-c/cmd/status";
import { createTickCmd } from "./deep-research-option-c/cmd/tick";
import { createTriageCmd } from "./deep-research-option-c/cmd/triage";
import { runInspect } from "./deep-research-option-c/handlers/inspect";
import { runAgentResult } from "./deep-research-option-c/handlers/agent-result";
import { runCancel } from "./deep-research-option-c/handlers/cancel";
import { runCaptureFixtures } from "./deep-research-option-c/handlers/capture-fixtures";
import { runInit } from "./deep-research-option-c/handlers/init";
import { runPause } from "./deep-research-option-c/handlers/pause";
import { runPerspectivesDraft } from "./deep-research-option-c/handlers/perspectives-draft";
import { runResume } from "./deep-research-option-c/handlers/resume";
import { runRerunWave1 } from "./deep-research-option-c/handlers/rerun";
import { runStageAdvance } from "./deep-research-option-c/handlers/stage-advance";
import { runStatus } from "./deep-research-option-c/handlers/status";
import { runTriage } from "./deep-research-option-c/handlers/triage";
import {
  blockersSummaryJson,
  type TriageBlockers,
} from "./deep-research-option-c/triage/blockers";
import {
  handleTickFailureArtifacts,
  printHaltArtifactSummary,
  writeHaltArtifactForFailure,
} from "./deep-research-option-c/triage/halt-artifacts";
import {
  configureStdoutForJsonMode,
  emitJson,
  getCliArgv,
  isJsonModeRequested,
} from "./deep-research-option-c/cli/json-mode";
import {
  isSafeSegment,
  normalizeOptional,
  requireAbsolutePath,
  safeResolveManifestPath,
} from "./deep-research-option-c/lib/paths";
import {
  asObject,
  readJsonObject,
} from "./deep-research-option-c/lib/io-json";
import {
  fileExists,
} from "./deep-research-option-c/lib/fs-utils";
import {
  printContract,
  resolveGatesPathFromManifest,
  resolvePerspectivesPathFromManifest,
  resolveRunHandle,
  summarizeManifest,
  type ManifestSummary,
} from "./deep-research-option-c/lib/run-handle";
import {
  resultErrorDetails,
  throwWithCodeAndDetails,
  toolErrorDetails,
} from "./deep-research-option-c/cli/errors";
import {
  beginTickObservability,
  finalizeTickObservability,
} from "./deep-research-option-c/observability/tick-observability";
import {
  normalizePromptDigest,
  promptDigestFromPromptMarkdown,
} from "./deep-research-option-c/lib/digest";
import { type TaskDriverMissingPerspective } from "./deep-research-option-c/perspectives/state";
import { makeToolContext } from "./deep-research-option-c/runtime/tool-context";
import {
  callTool,
  type ToolEnvelope,
  type ToolWithExecute,
} from "./deep-research-option-c/runtime/tool-envelope";

type RunHandleCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

type TickCliArgs = RunHandleCliArgs & {
  reason: string;
  driver: "fixture" | "live" | "task";
  json?: boolean;
};

type RunCliArgs = TickCliArgs & {
  maxTicks: number;
  until?: string;
};

type TickResult =
  | OrchestratorTickFixtureResult
  | OrchestratorTickLiveResult
  | OrchestratorTickPostPivotResult
  | OrchestratorTickPostSummariesResult;

const CLI_ARGV = getCliArgv();
const JSON_MODE_REQUESTED = isJsonModeRequested(CLI_ARGV);

function nextStepCliInvocation(): string {
  return 'bun "pai-tools/deep-research-option-c.ts"';
}

configureStdoutForJsonMode(JSON_MODE_REQUESTED);

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

  const perspectivesPath = await resolvePerspectivesPathFromManifest(args.manifest);
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

async function readWave2PlanEntries(runRoot: string): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave2PlanPath = path.join(runRoot, "wave-2", "wave2-plan.json");
  const wave2Plan = await readJsonObject(wave2PlanPath);
  const entries = Array.isArray(wave2Plan.entries)
    ? (wave2Plan.entries as Array<unknown>)
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
    throw new Error(`wave2 plan has no valid entries (${wave2PlanPath})`);
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

function createTaskPromptOutDriver(): (
  input: OrchestratorLiveRunAgentInput,
) => Promise<OrchestratorLiveRunAgentResult> {
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

function createOperatorInputDriver(): (
  input: OrchestratorLiveRunAgentInput,
) => Promise<OrchestratorLiveRunAgentResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const close = () => {
    try {
      rl.close();
    } catch {
      // best effort
    }
  };
  process.on("exit", close);
  process.on("SIGINT", () => {
    close();
    process.exit(130);
  });

  return async (input: OrchestratorLiveRunAgentInput): Promise<OrchestratorLiveRunAgentResult> => {
    const runRoot = String(input.run_root ?? "").trim();
    const stage = String(input.stage ?? "").trim();
    const perspectiveId = String(input.perspective_id ?? "").trim();
    const promptMd = String(input.prompt_md ?? "");

    if (!runRoot || !path.isAbsolute(runRoot)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "run_root missing/invalid" } };
    }
    if (!stage || !perspectiveId) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "stage/perspective_id missing" } };
    }
    if (!isSafeSegment(stage)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "stage contains unsafe characters" } };
    }
    if (!isSafeSegment(perspectiveId)) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "perspective_id contains unsafe characters" } };
    }
    if (!promptMd.trim()) {
      return { markdown: "", error: { code: "INVALID_ARGS", message: "prompt_md missing" } };
    }

    let runRootReal = runRoot;
    try {
      runRootReal = await fs.realpath(runRoot);
    } catch {
      // keep as-is; downstream writes will fail with a useful error
    }

    const promptPath = path.resolve(runRootReal, "operator", "prompts", stage, `${perspectiveId}.md`);
    const draftPath = path.resolve(runRootReal, "operator", "drafts", stage, `${perspectiveId}.md`);

    const contained = (absPath: string): boolean => {
      const rel = path.relative(runRootReal, absPath);
      return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
    };

    if (!contained(promptPath) || !contained(draftPath)) {
      return { markdown: "", error: { code: "PATH_TRAVERSAL", message: "operator paths escape run root" } };
    }
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(promptPath, `${promptMd.trim()}\n`, "utf8");

    try {
      await fs.access(draftPath);
    } catch {
      const template = [
        "## Findings",
        "",
        "(Write your findings here.)",
        "",
        "## Sources",
        "- ",
        "",
        "## Gaps",
        "- ",
        "",
      ].join("\n");
      await fs.writeFile(draftPath, `${template}\n`, "utf8");
    }

    console.log("\n--- Operator input required ---");
    console.log(`stage: ${stage}`);
    console.log(`perspective_id: ${perspectiveId}`);
    console.log(`prompt_path: ${promptPath}`);
    console.log(`draft_path: ${draftPath}`);
    console.log("Edit the draft file (use the prompt as instructions), then press ENTER to continue.");

    await rl.question("");

    const draft = await fs.readFile(draftPath, "utf8");
    if (!draft.trim()) {
      return { markdown: "", error: { code: "RUN_AGENT_FAILED", message: "draft is empty" } };
    }
    return { markdown: draft };
  };
}

async function collectWaveOutputs(absDir: string): Promise<Array<{ perspective_id: string; output_path: string }>> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return [];
  }

  const markdownFiles = entries.filter((entry) => entry.endsWith(".md") && !entry.startsWith("."));
  markdownFiles.sort();

  return markdownFiles.map((filename) => ({
    perspective_id: path.basename(filename, ".md"),
    output_path: path.join(absDir, filename),
  }));
}

async function defaultFixtureDriver(args: {
  stage: string;
  run_root: string;
}): Promise<{ wave_outputs: Array<{ perspective_id: string; output_path?: string }>; requested_next?: string }> {
  if (args.stage === "init") {
    return { wave_outputs: [], requested_next: "wave1" };
  }
  if (args.stage === "wave1") {
    return {
      wave_outputs: await collectWaveOutputs(path.join(args.run_root, "wave-1")),
      requested_next: "pivot",
    };
  }
  if (args.stage === "wave2") {
    return {
      wave_outputs: await collectWaveOutputs(path.join(args.run_root, "wave-2")),
      requested_next: "citations",
    };
  }
  if (args.stage === "citations") {
    return { wave_outputs: [], requested_next: "summaries" };
  }
  if (args.stage === "summaries") {
    return { wave_outputs: [], requested_next: "synthesis" };
  }
  if (args.stage === "synthesis") {
    return { wave_outputs: [], requested_next: "review" };
  }
  return { wave_outputs: [] };
}

async function runOneOrchestratorTick(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  driver: "fixture" | "live" | "task";
  stageHint?: string;
  liveDriver?: ReturnType<typeof createOperatorInputDriver> | null;
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

function printTickResult(driver: "fixture" | "live" | "task", result: TickResult): void {
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

async function runTick(args: TickCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const liveDriver = args.driver === "fixture"
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

async function runRun(args: RunCliArgs): Promise<void> {
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

const AbsolutePath: Type<string, string> = {
  async from(str) {
    return requireAbsolutePath(str, "path");
  },
};

const initCmd = createInitCmd({ AbsolutePath, runInit });

const tickCmd = createTickCmd({ AbsolutePath, runTick });

const agentResultCmd = createAgentResultCmd({ AbsolutePath, runAgentResult });

const runCmd = createRunCmd({ AbsolutePath, runRun });

const stageAdvanceCmd = createStageAdvanceCmd({ AbsolutePath, runStageAdvance });

const perspectivesDraftCmd = createPerspectivesDraftCmd({ AbsolutePath, runPerspectivesDraft });

const statusCmd = createStatusCmd({ AbsolutePath, runStatus });

const inspectCmd = createInspectCmd({ AbsolutePath, runInspect });

const triageCmd = createTriageCmd({ AbsolutePath, runTriage });

const pauseCmd = createPauseCmd({ AbsolutePath, runPause });

const resumeCmd = createResumeCmd({ AbsolutePath, runResume });

const cancelCmd = createCancelCmd({ AbsolutePath, runCancel });

const captureFixturesCmd = createCaptureFixturesCmd({ AbsolutePath, runCaptureFixtures });

const rerunCmd = createRerunCmd({ AbsolutePath, runRerunWave1 });

const app = subcommands({
  name: "deep-research-option-c",
  cmds: {
    init: initCmd,
    tick: tickCmd,
    "agent-result": agentResultCmd,
    run: runCmd,
    "stage-advance": stageAdvanceCmd,
    "perspectives-draft": perspectivesDraftCmd,
    status: statusCmd,
    inspect: inspectCmd,
    triage: triageCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    cancel: cancelCmd,
    "capture-fixtures": captureFixturesCmd,
    rerun: rerunCmd,
  },
});

runSafely(app, CLI_ARGV)
  .then((result) => {
    if (result._tag === "ok") return;

    const command = typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown";
    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command,
        error: {
          code: "CLI_PARSE_ERROR",
          message: result.error.config.message,
        },
      });
      process.exit(result.error.config.exitCode);
      return;
    }

    result.error.run();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : "CLI_ERROR";

    if (JSON_MODE_REQUESTED) {
      emitJson({
        ok: false,
        command: typeof CLI_ARGV[0] === "string" && CLI_ARGV[0].trim().length > 0 ? CLI_ARGV[0] : "unknown",
        error: {
          code: errorCode,
          message,
        },
      });
    } else {
      console.error(`ERROR: ${message}`);
    }

    process.exit(1);
  });
