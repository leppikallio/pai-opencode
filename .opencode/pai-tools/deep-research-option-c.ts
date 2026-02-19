#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import type { Type } from "cmd-ts";
import {
  command,
  option,
  runSafely,
  string,
  subcommands,
} from "cmd-ts";

import {
  acquireRunLock,
  fixture_bundle_capture,
  releaseRunLock,
  manifest_write,
  orchestrator_tick_fixture,
  orchestrator_tick_live,
  orchestrator_tick_post_pivot,
  orchestrator_tick_post_summaries,
  run_metrics_write,
  telemetry_append,
  tick_ledger_append,
  type OrchestratorLiveRunAgentInput,
  type OrchestratorLiveRunAgentResult,
  type OrchestratorTickFixtureResult,
  type OrchestratorTickLiveResult,
  type OrchestratorTickPostPivotResult,
  type OrchestratorTickPostSummariesResult,
  perspectives_write,
  run_init,
  stage_advance,
  watchdog_check,
  wave1_plan,
} from "../tools/deep_research.ts";
import {
  resolveDeepResearchFlagsV1,
  sha256HexLowerUtf8,
} from "../tools/deep_research/lifecycle_lib";
import { createAgentResultCmd } from "./deep-research-option-c/cmd/agent-result";
import { createCancelCmd } from "./deep-research-option-c/cmd/cancel";
import { createCaptureFixturesCmd } from "./deep-research-option-c/cmd/capture-fixtures";
import { createInitCmd } from "./deep-research-option-c/cmd/init";
import { createInspectCmd } from "./deep-research-option-c/cmd/inspect";
import { createPauseCmd } from "./deep-research-option-c/cmd/pause";
import { createResumeCmd } from "./deep-research-option-c/cmd/resume";
import { createRunCmd } from "./deep-research-option-c/cmd/run";
import { createStatusCmd } from "./deep-research-option-c/cmd/status";
import { createTickCmd } from "./deep-research-option-c/cmd/tick";
import { createTriageCmd } from "./deep-research-option-c/cmd/triage";
import { resolveRuntimeRootFromMainScript } from "./resolveRuntimeRootFromMainScript";

type ToolEnvelope = Record<string, unknown> & { ok: boolean };
type ToolWithExecute = {
  execute: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
};

type InitCliArgs = {
  query: string;
  runId?: string;
  runsRoot?: string;
  sensitivity: "normal" | "restricted" | "no_web";
  mode: "quick" | "standard" | "deep";
  writePerspectives: boolean;
  force: boolean;
  json?: boolean;
};

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

type PauseResumeCliArgs = RunHandleCliArgs & {
  reason: string;
  json?: boolean;
};

type RunStatusInspectTriageCliArgs = RunHandleCliArgs & {
  json: boolean;
};

type RerunWave1CliArgs = {
  manifest: string;
  perspective: string;
  reason: string;
};

type AgentResultCliArgs = {
  manifest: string;
  stage: "wave1" | "wave2" | "summaries" | "synthesis";
  perspective: string;
  input: string;
  agentRunId: string;
  reason: string;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  json?: boolean;
};

type TaskDriverMissingPerspective = {
  perspectiveId: string;
  promptPath: string;
  outputPath: string;
  metaPath: string;
  promptDigest: string;
};

type RunHandleResolution = {
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
  manifest: Record<string, unknown>;
};

type ManifestSummary = {
  runId: string;
  runRoot: string;
  stageCurrent: string;
  status: string;
  gatesPath: string;
};

type GateStatusSummary = {
  id: string;
  status: string;
  checked_at: string | null;
};

type TriageBlockers = {
  from: string;
  to: string;
  errorCode: string | null;
  errorMessage: string | null;
  missingArtifacts: Array<{ name: string; path: string | null }>;
  blockedGates: Array<{ gate: string; status: string | null }>;
  failedChecks: Array<{ kind: string; name: string }>;
  allowed: boolean;
};

type HaltRelatedPaths = {
  manifest_path: string;
  gates_path: string;
  retry_directives_path?: string;
  blocked_urls_path?: string;
  online_fixtures_latest_path?: string;
};

type HaltArtifactV1 = {
  schema_version: "halt.v1";
  created_at: string;
  run_id: string;
  run_root: string;
  tick_index: number;
  stage_current: string;
  blocked_transition: { from: string; to: string };
  error: { code: string; message: string };
  blockers: {
    missing_artifacts: Array<{ name: string; path?: string }>;
    blocked_gates: Array<{ gate: string; status?: string }>;
    failed_checks: Array<{ kind: string; name: string }>;
  };
  related_paths: HaltRelatedPaths;
  next_commands: string[];
  notes: string;
};

type BlockedUrlsInspectSummary = {
  artifactPath: string;
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
};

type TickResult =
  | OrchestratorTickFixtureResult
  | OrchestratorTickLiveResult
  | OrchestratorTickPostPivotResult
  | OrchestratorTickPostSummariesResult;

type TickObservabilityContext = {
  manifestPath: string;
  gatesPath: string;
  runId: string;
  runRoot: string;
  logsDirAbs: string;
  telemetryPath: string;
  stageBefore: string;
  statusBefore: string;
  stageAttempt: number;
  tickIndex: number;
  stageStartedDigest: string;
  startedAtMs: number;
};

type TickOutcome = {
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled";
  failureKind?: "timeout" | "tool_error" | "invalid_output" | "gate_failed" | "unknown";
  retryable?: boolean;
  message?: string;
};

const TICK_METRICS_INTERVAL = 1;
const CLI_ARGV = process.argv.slice(2);
const JSON_MODE_REQUESTED = CLI_ARGV.includes("--json");
const TOOL_CONTEXT_RUNTIME_ROOT = resolveRuntimeRootFromMainScript(import.meta.url);

function nextStepCliInvocation(): string {
  return 'bun "pai-tools/deep-research-option-c.ts"';
}

if (JSON_MODE_REQUESTED) {
  // Hard contract: in --json mode, reserve stdout for exactly one JSON object.
  // Any incidental console.log output is redirected to stderr.
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };
}

function stableDigest(value: Record<string, unknown>): string {
  return `sha256:${sha256HexLowerUtf8(JSON.stringify(value))}`;
}

function toolErrorDetails(error: unknown): { code: string; message: string } {
  const text = String(error ?? "unknown error");
  const match = /failed:\s+([^\s]+)\s+([^{]+)(?:\{.*)?$/.exec(text);
  if (!match) {
    return { code: "TOOL_FAILED", message: text };
  }
  return { code: match[1] ?? "TOOL_FAILED", message: (match[2] ?? text).trim() };
}

function resultErrorDetails(result: TickResult): { code: string; message: string } | null {
  if (result.ok) return null;
  return {
    code: String(result.error.code ?? "UNKNOWN"),
    message: String(result.error.message ?? "tick failed"),
  };
}

function safePositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

async function readJsonlRecords(filePath: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function nextTickIndex(logsDirAbs: string): Promise<number> {
  const ledgerPath = path.join(logsDirAbs, "ticks.jsonl");
  const rows = await readJsonlRecords(ledgerPath);
  let maxTick = 0;
  for (const row of rows) {
    const value = safePositiveInt(row.tick_index, 0);
    if (value > maxTick) maxTick = value;
  }
  return maxTick + 1;
}

async function nextHaltTickIndex(haltDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(haltDir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return 1;
    throw error;
  }

  let maxTick = 0;
  for (const entry of entries) {
    const match = /^tick-(\d+)\.json$/u.exec(entry);
    if (!match) continue;
    const value = safePositiveInt(match[1], 0);
    if (value > maxTick) maxTick = value;
  }
  return maxTick + 1;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function nextStageAttempt(telemetryPath: string, stageId: string): Promise<number> {
  const rows = await readJsonlRecords(telemetryPath);
  let count = 0;
  for (const row of rows) {
    if (String(row.event_type ?? "") !== "stage_started") continue;
    if (String(row.stage_id ?? "") !== stageId) continue;
    count += 1;
  }
  return count + 1;
}

async function appendTickLedgerBestEffort(args: {
  manifestPath: string;
  reason: string;
  entry: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const envelope = await callTool("tick_ledger_append", tick_ledger_append as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      entry: args.entry,
      reason: args.reason,
    });
    const ledgerPath = String(envelope.ledger_path ?? "").trim();
    return ledgerPath || null;
  } catch (error) {
    console.error(`warn.tick_ledger: ${String(error)}`);
    return null;
  }
}

async function appendTelemetryBestEffort(args: {
  manifestPath: string;
  reason: string;
  event: Record<string, unknown>;
}): Promise<void> {
  try {
    await callTool("telemetry_append", telemetry_append as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      event: args.event,
      reason: args.reason,
    });
  } catch (error) {
    console.error(`warn.telemetry_append: ${String(error)}`);
  }
}

async function writeRunMetricsBestEffort(args: {
  manifestPath: string;
  reason: string;
  tickIndex: number;
  stageBefore: string;
  stageAfter: string;
}): Promise<string | null> {
  const boundary = args.stageBefore !== args.stageAfter;
  if (!boundary && args.tickIndex % TICK_METRICS_INTERVAL !== 0) return null;

  try {
    const envelope = await callTool("run_metrics_write", run_metrics_write as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      reason: args.reason,
    });
    const metricsPath = String(envelope.metrics_path ?? "").trim();
    return metricsPath || null;
  } catch (error) {
    console.error(`warn.run_metrics_write: ${String(error)}`);
    return null;
  }
}

function computeTickOutcome(args: {
  tickResult: TickResult;
  stageBefore: string;
  stageAfter: string;
  statusAfter: string;
  toolError: { code: string; message: string } | null;
}): TickOutcome {
  if (args.statusAfter === "cancelled") {
    return {
      outcome: "cancelled",
      failureKind: "unknown",
      retryable: false,
      message: "run cancelled",
    };
  }

  if (args.tickResult.ok) {
    if (args.stageAfter !== args.stageBefore) {
      return { outcome: "succeeded" };
    }
    return {
      outcome: "failed",
      failureKind: "invalid_output",
      retryable: args.statusAfter === "running",
      message: "stage did not advance",
    };
  }

  const errorCodeUpper = String(args.toolError?.code ?? args.tickResult.error.code ?? "").toUpperCase();
  if (errorCodeUpper.includes("TIMEOUT")) {
    return {
      outcome: "timed_out",
      failureKind: "timeout",
      retryable: false,
      message: args.toolError?.message ?? args.tickResult.error.message,
    };
  }

  return {
    outcome: "failed",
    failureKind: "tool_error",
    retryable: false,
    message: args.toolError?.message ?? args.tickResult.error.message,
  };
}

async function beginTickObservability(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<TickObservabilityContext> {
  const manifest = await readJsonObject(args.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const telemetryPath = path.join(logsDirAbs, "telemetry.jsonl");
  const tickIndex = await nextTickIndex(logsDirAbs);
  const stageAttempt = await nextStageAttempt(telemetryPath, summary.stageCurrent);
  const manifestRevision = safePositiveInt(manifest.revision, 1);
  const stageStartedDigest = stableDigest({
    schema: "tick.stage_started.inputs.v1",
    run_id: summary.runId,
    stage: summary.stageCurrent,
    tick_index: tickIndex,
    stage_attempt: stageAttempt,
    manifest_revision: manifestRevision,
  });

  const context: TickObservabilityContext = {
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    runId: summary.runId,
    runRoot: summary.runRoot,
    logsDirAbs,
    telemetryPath,
    stageBefore: summary.stageCurrent,
    statusBefore: summary.status,
    stageAttempt,
    tickIndex,
    stageStartedDigest,
    startedAtMs: Date.now(),
  };

  await appendTickLedgerBestEffort({
    manifestPath: args.manifestPath,
    reason: `${args.reason} [tick_${tickIndex}_start]`,
    entry: {
      tick_index: tickIndex,
      phase: "start",
      stage_before: context.stageBefore,
      stage_after: context.stageBefore,
      status_before: context.statusBefore,
      status_after: context.statusBefore,
      result: { ok: true },
      inputs_digest: stageStartedDigest,
      artifacts: {
        manifest_path: args.manifestPath,
        gates_path: args.gatesPath,
        telemetry_path: context.telemetryPath,
      },
    },
  });

  await appendTelemetryBestEffort({
    manifestPath: args.manifestPath,
    reason: `${args.reason} [tick_${tickIndex}_stage_started]`,
    event: {
      event_type: "stage_started",
      stage_id: context.stageBefore,
      stage_attempt: context.stageAttempt,
      inputs_digest: context.stageStartedDigest,
      message: `tick ${tickIndex} started`,
    },
  });

  return context;
}

async function finalizeTickObservability(args: {
  context: TickObservabilityContext;
  tickResult: TickResult;
  reason: string;
  toolError: { code: string; message: string } | null;
}): Promise<void> {
  const manifestAfter = await readJsonObject(args.context.manifestPath);
  const afterSummary = await summarizeManifest(manifestAfter);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - args.context.startedAtMs) / 1000));
  const tickError = args.toolError ?? resultErrorDetails(args.tickResult);
  const outcome = computeTickOutcome({
    tickResult: args.tickResult,
    stageBefore: args.context.stageBefore,
    stageAfter: afterSummary.stageCurrent,
    statusAfter: afterSummary.status,
    toolError: args.toolError,
  });

  await appendTelemetryBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_stage_finished]`,
    event: {
      event_type: "stage_finished",
      stage_id: args.context.stageBefore,
      stage_attempt: args.context.stageAttempt,
      outcome: outcome.outcome,
      elapsed_s: elapsedSeconds,
      ...(outcome.failureKind ? { failure_kind: outcome.failureKind } : {}),
      ...(typeof outcome.retryable === "boolean" ? { retryable: outcome.retryable } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
    },
  });

  const shouldPlanRetry = outcome.outcome === "failed"
    && outcome.retryable === true
    && afterSummary.status === "running";

  if (shouldPlanRetry) {
    await appendTelemetryBestEffort({
      manifestPath: args.context.manifestPath,
      reason: `${args.reason} [tick_${args.context.tickIndex}_stage_retry_planned]`,
      event: {
        event_type: "stage_retry_planned",
        stage_id: args.context.stageBefore,
        from_attempt: args.context.stageAttempt,
        to_attempt: args.context.stageAttempt + 1,
        retry_index: args.context.stageAttempt,
        change_summary: `tick ${args.context.tickIndex} did not advance stage; retry planned`,
      },
    });
  }

  const metricsPath = await writeRunMetricsBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_metrics]`,
    tickIndex: args.context.tickIndex,
    stageBefore: args.context.stageBefore,
    stageAfter: afterSummary.stageCurrent,
  });

  await appendTickLedgerBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_finish]`,
    entry: {
      tick_index: args.context.tickIndex,
      phase: "finish",
      stage_before: args.context.stageBefore,
      stage_after: afterSummary.stageCurrent,
      status_before: args.context.statusBefore,
      status_after: afterSummary.status,
      result: tickError
        ? { ok: false, error: { code: tickError.code, message: tickError.message } }
        : { ok: true },
      inputs_digest: args.tickResult.ok ? (args.tickResult.decision_inputs_digest ?? args.context.stageStartedDigest) : args.context.stageStartedDigest,
      artifacts: {
        manifest_path: args.context.manifestPath,
        gates_path: args.context.gatesPath,
        telemetry_path: args.context.telemetryPath,
        ...(metricsPath ? { metrics_path: metricsPath } : {}),
      },
    },
  });
}
function makeToolContext() {
  return {
    sessionID: "ses_option_c_cli",
    messageID: "msg_option_c_cli",
    agent: "deep-research-option-c-cli",
    directory: TOOL_CONTEXT_RUNTIME_ROOT,
    worktree: TOOL_CONTEXT_RUNTIME_ROOT,
    abort: new AbortController().signal,
    metadata(..._args: unknown[]) {},
    ask: async (..._args: unknown[]) => {},
  };
}

function parseToolEnvelope(name: string, raw: unknown): ToolEnvelope {
  if (typeof raw !== "string") {
    throw new Error(`${name} returned non-string response`);
  }
  const parsed = JSON.parse(raw) as ToolEnvelope;
  if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
    throw new Error(`${name} returned invalid JSON envelope`);
  }
  return parsed;
}

function toolErrorMessage(name: string, envelope: ToolEnvelope): string {
  const errorRaw = envelope.error;
  if (!errorRaw || typeof errorRaw !== "object") {
    return `${name} failed`;
  }
  const error = errorRaw as Record<string, unknown>;
  const code = String(error.code ?? "UNKNOWN");
  const message = String(error.message ?? "Unknown failure");
  const details = JSON.stringify(error.details ?? {});
  return `${name} failed: ${code} ${message} ${details}`;
}

async function callTool(name: string, tool: ToolWithExecute, args: Record<string, unknown>): Promise<ToolEnvelope> {
  const raw = await tool.execute(args, makeToolContext());
  const envelope = parseToolEnvelope(name, raw);
  if (!envelope.ok) {
    throw new Error(toolErrorMessage(name, envelope));
  }
  return envelope;
}

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

function requireAbsolutePath(value: string, flagName: string): string {
  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw new Error(`${flagName} must be an absolute path`);
  }
  return trimmed;
}

function isManifestRelativePathSafe(value: string): boolean {
  if (!value || value.startsWith(path.sep) || value.includes("/../") || value.includes("\\..\\")) {
    return false;
  }
  const normalized = path.normalize(value);
  return normalized !== ".."
    && !normalized.startsWith(`..${path.sep}`)
    && !normalized.split(path.sep).some((segment: string) => segment === "..");
}

async function safeResolveManifestPath(runRoot: string, rel: string, field: string): Promise<string> {
  const relTrimmed = String(rel ?? "").trim() || "gates.json";
  if (!isManifestRelativePathSafe(relTrimmed)) {
    throw new Error(`${field} must be a relative path without traversal`);
  }

  // Normalize run root to a real path first so containment checks work on macOS
  // where `/var` is a symlink to `/private/var`.
  let runRootReal = runRoot;
  try {
    runRootReal = await fs.realpath(runRoot);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  const candidate = path.resolve(runRootReal, relTrimmed);

  let parentPath = path.dirname(candidate);
  try {
    const parentReal = await fs.realpath(parentPath);
    parentPath = parentReal;
    const relFromRoot = path.relative(runRootReal, parentReal);
    if (relFromRoot === "" || relFromRoot === ".") {
      // keep candidate below runRoot when parent is root or direct child
    } else if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
      throw new Error(`${field} escapes runRoot`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  let candidateForCheck = path.resolve(parentPath, path.basename(candidate));
  try {
    candidateForCheck = await fs.realpath(candidateForCheck);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  const relFromRoot = path.relative(runRootReal, candidateForCheck);
  if (relFromRoot === "" || relFromRoot === ".") {
    return path.join(runRootReal, path.basename(candidateForCheck));
  }
  if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
    throw new Error(`${field} escapes runRoot`);
  }

  return candidateForCheck;
}

async function writeCheckpoint(args: {
  logsDirAbs: string;
  filename: string;
  content: string;
}): Promise<string> {
  const outPath = path.join(args.logsDirAbs, args.filename);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${args.content.trim()}\n`, "utf8");
  return outPath;
}

async function withRunLock<T>(args: { runRoot: string; reason: string; fn: () => Promise<T> }): Promise<T> {
  const lock = await acquireRunLock({ run_root: args.runRoot, lease_seconds: 60, reason: args.reason });
  if (!lock.ok) {
    throw new Error(`run lock failed: ${lock.code} ${lock.message} ${JSON.stringify(lock.details ?? {})}`);
  }

  try {
    return await args.fn();
  } finally {
    await releaseRunLock(lock.handle).catch(() => undefined);
  }
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function promptDigestFromPromptMarkdown(promptMd: string): string {
  return `sha256:${sha256HexLowerUtf8(promptMd)}`;
}

function normalizePromptDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^sha256:[a-f0-9]{64}$/u.test(trimmed)) return trimmed;
  if (/^[a-f0-9]{64}$/u.test(trimmed)) return `sha256:${trimmed}`;
  return null;
}

async function readWave1PlanEntries(runRoot: string): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave1PlanPath = path.join(runRoot, "wave-1", "wave1-plan.json");
  const wave1Plan = await readJsonObject(wave1PlanPath);
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
  const exists = await fileExists(metaPath);
  if (!exists) return false;

  let metaRaw: Record<string, unknown>;
  try {
    metaRaw = await readJsonObject(metaPath);
  } catch {
    return false;
  }
  const normalized = normalizePromptDigest(metaRaw.prompt_digest);
  return normalized === expectedPromptDigest;
}

async function collectTaskDriverMissingWave1Perspectives(args: {
  runRoot: string;
}): Promise<TaskDriverMissingPerspective[]> {
  const planEntries = await readWave1PlanEntries(args.runRoot);
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`JSON object expected at ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function resolveRunRoot(manifest: Record<string, unknown>): string {
  const artifacts = asObject(manifest.artifacts);
  const root = String(artifacts.root ?? "").trim();
  if (!root || !path.isAbsolute(root)) {
    throw new Error("manifest.artifacts.root is missing or invalid");
  }
  return root;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function resolveLogsDirFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const logsRel = String(pathsObj.logs_dir ?? "logs").trim() || "logs";
  return await safeResolveManifestPath(runRoot, logsRel, "manifest.artifacts.paths.logs_dir");
}

async function resolveGatesPathFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const gatesRel = String(pathsObj.gates_file ?? "gates.json").trim() || "gates.json";
  return safeResolveManifestPath(runRoot, gatesRel, "manifest.artifacts.paths.gates_file");
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emitJson(payload: unknown): void {
  // LLM/operator contract: JSON mode prints exactly one parseable object.
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function validateRunId(runId: string): void {
  if (!runId) throw new Error("--run-id must be non-empty");
  if (path.isAbsolute(runId)) throw new Error("--run-id must not be an absolute path");
  if (runId === "." || runId === "..") throw new Error("--run-id must not be '.' or '..'");
  if (runId.includes("/") || runId.includes("\\")) throw new Error("--run-id must not contain path separators");
  if (runId.includes("..")) throw new Error("--run-id must not contain '..'");
}

function assertWithinRoot(rootAbs: string, candidateAbs: string, field: string): void {
  const rel = path.relative(rootAbs, candidateAbs);
  if (rel === "" || rel === ".") return;
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    throw new Error(`${field} resolves outside runs root`);
  }
}

async function resolveRunHandle(args: RunHandleCliArgs): Promise<RunHandleResolution> {
  const manifestArg = normalizeOptional(args.manifest);
  const runRootArg = normalizeOptional(args.runRoot);
  const runIdArg = normalizeOptional(args.runId);
  const runsRootArg = normalizeOptional(args.runsRoot);

  const selectors = [manifestArg, runRootArg, runIdArg].filter((value) => typeof value === "string").length;
  if (selectors === 0) {
    throw new Error("one of --manifest, --run-root, or --run-id is required");
  }
  if (selectors > 1) {
    throw new Error("provide only one of --manifest, --run-root, or --run-id");
  }

  let manifestPath: string;
  if (manifestArg) {
    manifestPath = requireAbsolutePath(manifestArg, "--manifest");
  } else if (runRootArg) {
    const runRootAbs = requireAbsolutePath(runRootArg, "--run-root");
    manifestPath = path.join(runRootAbs, "manifest.json");
  } else {
    validateRunId(runIdArg as string);
    if (!runsRootArg) {
      throw new Error("--runs-root is required when using --run-id");
    }
    const runsRoot = requireAbsolutePath(runsRootArg, "--runs-root");
    const runRootFromId = path.resolve(runsRoot, runIdArg as string);
    assertWithinRoot(runsRoot, runRootFromId, "--run-id");
    manifestPath = path.join(runRootFromId, "manifest.json");
  }

  const manifest = await readJsonObject(manifestPath);
  const runRoot = resolveRunRoot(manifest);
  const gatesDerived = await resolveGatesPathFromManifest(manifest);
  const gatesArg = normalizeOptional(args.gates);
  const gatesPath = gatesArg ? requireAbsolutePath(gatesArg, "--gates") : gatesDerived;

  if (runRootArg) {
    const expected = path.resolve(requireAbsolutePath(runRootArg, "--run-root"));
    const actual = path.resolve(runRoot);
    if (expected !== actual) {
      throw new Error(`--run-root mismatch: manifest resolves root ${actual}`);
    }
  }

  if (runIdArg) {
    const manifestRunId = String(manifest.run_id ?? "").trim();
    if (manifestRunId && manifestRunId !== runIdArg) {
      throw new Error(`--run-id mismatch: manifest run_id is ${manifestRunId}`);
    }
  }

  return {
    runRoot,
    manifestPath,
    gatesPath,
    manifest,
  };
}

async function summarizeManifest(manifest: Record<string, unknown>): Promise<ManifestSummary> {
  const stage = asObject(manifest.stage);
  return {
    runId: String(manifest.run_id ?? ""),
    runRoot: resolveRunRoot(manifest),
    stageCurrent: String(stage.current ?? ""),
    status: String(manifest.status ?? ""),
    gatesPath: await resolveGatesPathFromManifest(manifest),
  };
}

function printContract(args: {
  runId: string;
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
  stageCurrent: string;
  status: string;
}): void {
  console.log(`run_id: ${args.runId}`);
  console.log(`run_root: ${args.runRoot}`);
  console.log(`manifest_path: ${args.manifestPath}`);
  console.log(`gates_path: ${args.gatesPath}`);
  console.log(`stage.current: ${args.stageCurrent}`);
  console.log(`status: ${args.status}`);
}

type CliContractJson = {
  run_id: string;
  run_root: string;
  manifest_path: string;
  gates_path: string | null;
  stage_current: string;
  status: string;
  gate_statuses_summary: Record<string, { status: string; checked_at: string | null }>;
};

function gateStatusesSummaryRecord(gateStatuses: GateStatusSummary[]): Record<string, { status: string; checked_at: string | null }> {
  const out: Record<string, { status: string; checked_at: string | null }> = {};
  for (const gate of gateStatuses) {
    out[gate.id] = {
      status: gate.status,
      checked_at: gate.checked_at,
    };
  }
  return out;
}

async function readGateStatusesSummary(gatesPath: string): Promise<Record<string, { status: string; checked_at: string | null }>> {
  try {
    const gatesDoc = await readJsonObject(gatesPath);
    return gateStatusesSummaryRecord(parseGateStatuses(gatesDoc));
  } catch {
    return {};
  }
}

function contractJson(args: {
  summary: ManifestSummary;
  manifestPath: string;
  gatesPath?: string;
  gateStatusesSummary: Record<string, { status: string; checked_at: string | null }>;
}): CliContractJson {
  return {
    run_id: args.summary.runId,
    run_root: args.summary.runRoot,
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath ?? args.summary.gatesPath ?? null,
    stage_current: args.summary.stageCurrent,
    status: args.summary.status,
    gate_statuses_summary: args.gateStatusesSummary,
  };
}

function emitContractCommandJson(args: {
  command: "status" | "inspect" | "triage";
  summary: ManifestSummary;
  manifestPath: string;
  gatesPath?: string;
  gateStatusesSummary: Record<string, { status: string; checked_at: string | null }>;
  extra?: Record<string, unknown>;
}): void {
  emitJson({
    ok: true,
    command: args.command,
    ...contractJson({
      summary: args.summary,
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      gateStatusesSummary: args.gateStatusesSummary,
    }),
    ...(args.extra ?? {}),
  });
}

function blockersSummaryJson(triage: TriageBlockers): {
  missing_artifacts: Array<{ name: string; path: string | null }>;
  blocked_gates: Array<{ gate: string; status: string | null }>;
} {
  return {
    missing_artifacts: triage.missingArtifacts.map((item) => ({
      name: item.name,
      path: item.path,
    })),
    blocked_gates: triage.blockedGates.map((item) => ({
      gate: item.gate,
      status: item.status,
    })),
  };
}

function defaultPerspectivePayload(runId: string): Record<string, unknown> {
  return {
    schema_version: "perspectives.v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    perspectives: [
      {
        id: "p1",
        title: "Default synthesis perspective",
        track: "standard",
        agent_type: "ClaudeResearcher",
        prompt_contract: {
          max_words: 900,
          max_sources: 12,
          tool_budget: { search_calls: 4, fetch_calls: 6 },
          must_include_sections: ["Findings", "Sources", "Gaps"],
        },
      },
    ],
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function citationModeFromSensitivity(sensitivity: string): "offline" | "online" | "dry_run" {
  if (sensitivity === "no_web") return "offline";
  if (sensitivity === "restricted") return "dry_run";
  return "online";
}

function readManifestDeepFlags(manifest: Record<string, unknown>): Record<string, unknown> {
  const query = asObject(manifest.query);
  const constraints = asObject(query.constraints);
  return asObject(constraints.deep_research_flags);
}

function timestampTokenFromIso(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\..*Z$/, "Z").replace("T", "T");
}

async function writeRunConfig(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  manifest: Record<string, unknown>;
}): Promise<string> {
  const flags = resolveDeepResearchFlagsV1();
  const limits = asObject(args.manifest.limits);
  const query = asObject(args.manifest.query);
  const effectiveSensitivity = String(query.sensitivity ?? "normal");
  const deepFlags = readManifestDeepFlags(args.manifest);

  const manifestBrightDataEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT);
  const manifestApifyEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_APIFY_ENDPOINT);
  const effectiveBrightDataEndpoint = (manifestBrightDataEndpoint ?? flags.citationsBrightDataEndpoint ?? "").trim();
  const effectiveApifyEndpoint = (manifestApifyEndpoint ?? flags.citationsApifyEndpoint ?? "").trim();
  const citationMode = citationModeFromSensitivity(effectiveSensitivity);

  const brightDataSource = manifestBrightDataEndpoint
    ? "manifest"
    : flags.citationsBrightDataEndpoint
      ? "settings"
      : "run-config";
  const apifySource = manifestApifyEndpoint
    ? "manifest"
    : flags.citationsApifyEndpoint
      ? "settings"
      : "run-config";

  const runConfig = {
    schema_version: "run_config.v1",
    run_id: args.runId,
    created_at: new Date().toISOString(),
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
    effective: {
      sensitivity: effectiveSensitivity,
      flags: {
        option_c_enabled: true,
        no_web: effectiveSensitivity === "no_web" || flags.noWeb,
        citation_validation_tier: flags.citationValidationTier,
      },
      citation_endpoints: {
        extract_urls: "deep_research_citations_extract_urls",
        normalize: "deep_research_citations_normalize",
        validate: "deep_research_citations_validate",
        render_md: "deep_research_citations_render_md",
      },
      citations: {
        mode: citationMode,
        endpoints: {
          brightdata: effectiveBrightDataEndpoint,
          apify: effectiveApifyEndpoint,
        },
        source: {
          mode: "manifest",
          endpoints: {
            brightdata: brightDataSource,
            apify: apifySource,
          },
          authority: "run-config",
        },
      },
      caps: {
        max_wave1_agents: Number(limits.max_wave1_agents ?? 0),
        max_wave2_agents: Number(limits.max_wave2_agents ?? 0),
        max_summary_kb: Number(limits.max_summary_kb ?? 0),
        max_total_summary_kb: Number(limits.max_total_summary_kb ?? 0),
        max_review_iterations: Number(limits.max_review_iterations ?? 0),
      },
      source: flags.source,
    },
  };

  const outPath = path.join(args.runRoot, "run-config.json");
  await fs.writeFile(outPath, `${JSON.stringify(runConfig, null, 2)}\n`, "utf8");
  return outPath;
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

function parseGateStatuses(gatesDoc: Record<string, unknown>): GateStatusSummary[] {
  const gatesObj = asObject(gatesDoc.gates);
  const out: GateStatusSummary[] = [];

  for (const gateId of ["A", "B", "C", "D", "E", "F"]) {
    const gate = asObject(gatesObj[gateId]);
    out.push({
      id: gateId,
      status: String(gate.status ?? "unknown"),
      checked_at: gate.checked_at == null ? null : String(gate.checked_at),
    });
  }

  return out;
}

async function readBlockedUrlsInspectSummary(runRoot: string): Promise<BlockedUrlsInspectSummary | null> {
  const blockedUrlsPath = path.join(runRoot, "citations", "blocked-urls.json");

  let raw: Record<string, unknown>;
  try {
    raw = await readJsonObject(blockedUrlsPath);
  } catch {
    return null;
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  const statusCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();

  for (const item of items) {
    const obj = asObject(item);
    const status = String(obj.status ?? "blocked").trim() || "blocked";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const action = String(obj.action ?? "").trim();
    if (action) {
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }
  }

  const byStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));

  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, 5);

  return {
    artifactPath: blockedUrlsPath,
    total: items.length,
    byStatus,
    topActions,
  };
}

async function stageAdvanceDryRun(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<ToolEnvelope> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dr-stage-advance-"));
  const tempManifest = path.join(tempDir, "manifest.json");
  const tempGates = path.join(tempDir, "gates.json");

  try {
    await fs.copyFile(args.manifestPath, tempManifest);
    await fs.copyFile(args.gatesPath, tempGates);
    const raw = await (stage_advance as unknown as ToolWithExecute).execute(
      {
        manifest_path: tempManifest,
        gates_path: tempGates,
        reason: args.reason,
      },
      makeToolContext(),
    );
    return parseToolEnvelope("stage_advance", raw);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function triageFromStageAdvanceResult(envelope: ToolEnvelope): TriageBlockers {
  const error = asObject(envelope.error);
  const errorDetails = asObject(error.details);
  const decision = asObject(errorDetails.decision);
  const evaluated = Array.isArray(decision.evaluated)
    ? (decision.evaluated as Array<Record<string, unknown>>)
    : [];

  const missingArtifacts: Array<{ name: string; path: string | null }> = [];
  const blockedGates: Array<{ gate: string; status: string | null }> = [];
  const failedChecks: Array<{ kind: string; name: string }> = [];

  for (const item of evaluated) {
    if (item.ok === true) continue;
    const kind = String(item.kind ?? "unknown");
    const name = String(item.name ?? "unknown");
    const details = asObject(item.details);

    if (kind === "artifact") {
      missingArtifacts.push({
        name,
        path: details.path == null ? null : String(details.path),
      });
      continue;
    }

    if (kind === "gate") {
      blockedGates.push({
        gate: String(details.gate ?? name),
        status: details.status == null ? null : String(details.status),
      });
      continue;
    }

    failedChecks.push({ kind, name });
  }

  if (envelope.ok === true) {
    return {
      from: String(envelope.from ?? ""),
      to: String(envelope.to ?? ""),
      errorCode: null,
      errorMessage: null,
      missingArtifacts,
      blockedGates,
      failedChecks,
      allowed: true,
    };
  }

  return {
    from: String(errorDetails.from ?? ""),
    to: String(errorDetails.to ?? ""),
    errorCode: error.code == null ? null : String(error.code),
    errorMessage: error.message == null ? null : String(error.message),
    missingArtifacts,
    blockedGates,
    failedChecks,
    allowed: false,
  };
}

function printBlockersSummary(triage: TriageBlockers): void {
  console.log("blockers.summary:");
  console.log(`  transition: ${triage.from || "?"} -> ${triage.to || "?"}`);

  if (triage.allowed) {
    console.log("  status: no transition blockers detected");
    console.log("  remediation: inspect tick error details for non-stage failures");
    return;
  }

  if (triage.errorCode || triage.errorMessage) {
    console.log(`  error: ${triage.errorCode ?? "UNKNOWN"} ${triage.errorMessage ?? ""}`.trim());
  }

  if (triage.missingArtifacts.length > 0) {
    console.log("  missing_artifacts:");
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  if (triage.blockedGates.length > 0) {
    console.log("  blocked_gates:");
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  if (triage.failedChecks.length > 0) {
    console.log("  failed_checks:");
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }

  console.log("  remediation: run inspect for full guidance and produce required artifacts/gate passes");
}

async function computeTriageBlockers(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<TriageBlockers | null> {
  try {
    const dryRun = await stageAdvanceDryRun({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.reason,
    });
    return triageFromStageAdvanceResult(dryRun);
  } catch {
    return null;
  }
}

async function resolveHaltRelatedPaths(args: {
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
}): Promise<HaltRelatedPaths> {
  const related: HaltRelatedPaths = {
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
  };

  const retryDirectivesPath = await safeResolveManifestPath(args.runRoot, "retry/retry-directives.json", "retry.retry_directives");
  if (await fileExists(retryDirectivesPath)) {
    related.retry_directives_path = retryDirectivesPath;
  }

  const blockedUrlsPath = await safeResolveManifestPath(args.runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  if (await fileExists(blockedUrlsPath)) {
    related.blocked_urls_path = blockedUrlsPath;
  }

  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(args.runRoot);
  if (latestOnlineFixturesPath) {
    related.online_fixtures_latest_path = latestOnlineFixturesPath;
  }

  return related;
}

function nextHaltCommands(args: {
  manifestPath: string;
  stageCurrent: string;
  tickIndex: number;
  nextCommandsOverride?: string[];
}): string[] {
  if (Array.isArray(args.nextCommandsOverride) && args.nextCommandsOverride.length > 0) {
    return args.nextCommandsOverride;
  }
  const cli = nextStepCliInvocation();
  return [
    `${cli} inspect --manifest "${args.manifestPath}"`,
    `${cli} triage --manifest "${args.manifestPath}"`,
    `${cli} tick --manifest "${args.manifestPath}" --driver fixture --reason "halt retry from ${args.stageCurrent} (halt_tick_${args.tickIndex})"`,
  ];
}

async function writeHaltArtifact(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  stageCurrent: string;
  reason: string;
  error: { code: string; message: string };
  triage: TriageBlockers | null;
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number }> {
  const haltDir = path.join(args.runRoot, "operator", "halt");
  await fs.mkdir(haltDir, { recursive: true });

  const tickIndex = await nextHaltTickIndex(haltDir);
  const padded = String(tickIndex).padStart(4, "0");
  const tickPath = path.join(haltDir, `tick-${padded}.json`);
  const latestPath = path.join(haltDir, "latest.json");
  const relatedPaths = await resolveHaltRelatedPaths({
    runRoot: args.runRoot,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
  });

  const triage = args.triage;
  const artifact: HaltArtifactV1 = {
    schema_version: "halt.v1",
    created_at: nowIso(),
    run_id: args.runId,
    run_root: args.runRoot,
    tick_index: tickIndex,
    stage_current: args.stageCurrent,
    blocked_transition: {
      from: triage?.from || args.stageCurrent,
      to: triage?.to || args.stageCurrent,
    },
    error: {
      code: args.error.code,
      message: args.error.message,
    },
    blockers: {
      missing_artifacts: (triage?.missingArtifacts ?? []).map((item) => ({
        name: item.name,
        ...(item.path ? { path: item.path } : {}),
      })),
      blocked_gates: (triage?.blockedGates ?? []).map((item) => ({
        gate: item.gate,
        ...(item.status ? { status: item.status } : {}),
      })),
      failed_checks: (triage?.failedChecks ?? []).map((item) => ({
        kind: item.kind,
        name: item.name,
      })),
    },
    related_paths: relatedPaths,
    next_commands: nextHaltCommands({
      manifestPath: args.manifestPath,
      stageCurrent: args.stageCurrent,
      tickIndex,
      nextCommandsOverride: args.nextCommandsOverride,
    }),
    notes: `Tick failure captured by operator CLI (${args.reason})`,
  };

  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await fs.writeFile(tickPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");

  return { tickPath, latestPath, tickIndex };
}

async function writeHaltArtifactForFailure(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string };
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; triage: TriageBlockers | null }> {
  const triage = await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: `${args.reason} [halt_triage]`,
  });

  const halt = await writeHaltArtifact({
    runRoot: args.runRoot,
    runId: args.runId,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    stageCurrent: args.stageCurrent,
    reason: args.reason,
    error: args.error,
    triage,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  return { ...halt, triage };
}

async function printAutoTriage(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  triage?: TriageBlockers | null;
}): Promise<void> {
  const triage = args.triage ?? await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
  });

  if (triage) {
    printBlockersSummary(triage);
    return;
  }

  console.log("blockers.summary:");
  console.log("  unavailable: stage_advance dry-run failed");
}

async function printHaltArtifactSummary(args: {
  tickPath: string;
  latestPath: string;
  tickIndex: number;
}): Promise<void> {
  console.log(`halt.tick_index: ${args.tickIndex}`);
  console.log(`halt.path: ${args.tickPath}`);
  console.log(`halt.latest_path: ${args.latestPath}`);
}

async function handleTickFailureArtifacts(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string };
  triageReason: string;
  nextCommandsOverride?: string[];
  emitLogs?: boolean;
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; triage: TriageBlockers | null }> {
  const halt = await writeHaltArtifactForFailure({
    runRoot: args.runRoot,
    runId: args.runId,
    stageCurrent: args.stageCurrent,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
    error: args.error,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  if (args.emitLogs !== false) {
    await printHaltArtifactSummary(halt);
    await printAutoTriage({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.triageReason,
      triage: halt.triage,
    });
  }

  return halt;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonObject(filePath);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function resolveLatestOnlineFixtures(runRoot: string): Promise<string | null> {
  const latestPointerPath = await safeResolveManifestPath(
    runRoot,
    "citations/online-fixtures.latest.json",
    "citations.online_fixtures.latest",
  );
  const latestPointer = await readJsonIfExists(latestPointerPath);
  if (latestPointer) {
    const candidateRaw = String(latestPointer.path ?? latestPointer.latest_path ?? "").trim();
    if (candidateRaw) {
      return await safeResolveManifestPath(runRoot, candidateRaw, "citations.online_fixtures.path");
    }
    return latestPointerPath;
  }

  const citationsDir = await safeResolveManifestPath(runRoot, "citations", "citations.dir");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(citationsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => /^online-fixtures\.[^.]+\.json$/u.test(entry))
    .sort();
  if (candidates.length === 0) return null;
  return path.join(citationsDir, candidates[candidates.length - 1]);
}

async function printInspectOperatorGuidance(runRoot: string): Promise<void> {
  const blockedUrlsPath = await safeResolveManifestPath(runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  const retryDirectivesPath = await safeResolveManifestPath(runRoot, "retry/retry-directives.json", "retry.retry_directives");

  const blockedUrls = await readJsonIfExists(blockedUrlsPath);
  const retryDirectives = await readJsonIfExists(retryDirectivesPath);
  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(runRoot);

  if (blockedUrls) {
    const items = Array.isArray(blockedUrls.items) ? blockedUrls.items : [];
    console.log("citations.blocked_urls:");
    console.log(`  path: ${blockedUrlsPath}`);
    console.log(`  count: ${items.length}`);
    for (const raw of items.slice(0, 5)) {
      const item = asObject(raw);
      console.log(`  - ${String(item.url ?? item.normalized_url ?? "unknown")}`);
      console.log(`    action: ${String(item.action ?? "review citation access path")}`);
    }
    if (items.length > 0) {
      console.log("  next: replace blocked URLs or add acceptable sources, then re-run citations stage");
    }
  }

  if (retryDirectives) {
    const directives = Array.isArray(retryDirectives.retry_directives) ? retryDirectives.retry_directives : [];
    const consumedAt = String(retryDirectives.consumed_at ?? "").trim();
    console.log("retry.directives:");
    console.log(`  path: ${retryDirectivesPath}`);
    console.log(`  count: ${directives.length}`);
    if (consumedAt) {
      console.log(`  consumed_at: ${consumedAt}`);
    } else if (directives.length > 0) {
      console.log("  next: apply retry directives and run tick again");
    }
  }

  if (latestOnlineFixturesPath) {
    console.log("citations.online_fixtures_latest:");
    console.log(`  path: ${latestOnlineFixturesPath}`);
    console.log("  next: use this fixture for deterministic replay/debug");
  }
}

async function runInit(args: InitCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const rootOverride = normalizeOptional(args.runsRoot);
  const init = await callTool("run_init", run_init as unknown as ToolWithExecute, {
    query: args.query,
    mode: args.mode,
    sensitivity: args.sensitivity,
    run_id: args.runId,
    ...(rootOverride ? { root_override: requireAbsolutePath(rootOverride, "--runs-root") } : {}),
  });

  const runId = String(init.run_id ?? "").trim();
  const runRoot = requireAbsolutePath(String(init.root ?? ""), "run_init root");
  const manifestPath = requireAbsolutePath(String(init.manifest_path ?? ""), "run_init manifest_path");
  const gatesPath = requireAbsolutePath(String(init.gates_path ?? ""), "run_init gates_path");

  const created = Boolean(init.created);
  const notes: string[] = [];
  let perspectivesPathOut: string | null = null;
  let wave1PlanPathOut: string | null = null;

  if (!created) {
    // Defensive: when reusing an existing run_id, ensure the run root in the manifest
    // matches what run_init resolved. This prevents accidental cross-root reuse.
    const existingManifest = await readJsonObject(manifestPath);
    const manifestRunRoot = resolveRunRoot(existingManifest);
    let expected = runRoot;
    let actual = manifestRunRoot;
    try {
      expected = await fs.realpath(runRoot);
    } catch {
      // best effort only
    }
    try {
      actual = await fs.realpath(manifestRunRoot);
    } catch {
      // best effort only
    }
    if (path.resolve(expected) !== path.resolve(actual)) {
      throw new Error(
        `manifest.artifacts.root mismatch for existing run (expected ${expected}, actual ${actual})`,
      );
    }
  }

  if (args.writePerspectives) {
    const perspectivesPath = path.join(runRoot, "perspectives.json");
    perspectivesPathOut = perspectivesPath;
    const perspectivesExists = await fs.stat(perspectivesPath).then(() => true).catch(() => false);

    if (!perspectivesExists || args.force || created) {
      await callTool("perspectives_write", perspectives_write as unknown as ToolWithExecute, {
        perspectives_path: perspectivesPath,
        value: defaultPerspectivePayload(runId),
        reason: created
          ? "operator-cli init: default perspectives (new run)"
          : (args.force ? "operator-cli init: default perspectives (forced overwrite)" : "operator-cli init: default perspectives (missing file)"),
      });
    } else {
      const message = "existing perspectives preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`perspectives.note: ${message}`);
      }
    }
    if (!args.json) {
      console.log(`perspectives_path: ${perspectivesPath}`);
    }

    // wave1_plan writes a new artifact with a generated_at timestamp; only create it
    // when missing/new, or when forced.
    const wave1PlanPath = path.join(runRoot, "wave-1", "wave1-plan.json");
    const wave1PlanExists = await fs.stat(wave1PlanPath).then(() => true).catch(() => false);

    if (!wave1PlanExists || args.force || created) {
      const wave1Plan = await callTool("wave1_plan", wave1_plan as unknown as ToolWithExecute, {
        manifest_path: manifestPath,
        reason: created
          ? "operator-cli init: deterministic wave1 plan (new run)"
          : (args.force ? "operator-cli init: deterministic wave1 plan (forced overwrite)" : "operator-cli init: deterministic wave1 plan (missing file)"),
      });

      const produced = String(wave1Plan.plan_path ?? "").trim();
      if (!produced || !path.isAbsolute(produced)) {
        throw new Error("wave1_plan returned invalid plan_path");
      }
      wave1PlanPathOut = produced;
      if (!args.json) {
        console.log(`wave1_plan_path: ${produced}`);
      }
    } else {
      wave1PlanPathOut = wave1PlanPath;
      const message = "existing plan preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`wave1_plan_path: ${wave1PlanPath}`);
        console.log(`wave1_plan.note: ${message}`);
      }
    }

    // Resume-safe: if this run is already in wave1, do not attempt a redundant stage_advance.
    // But if a run exists in init, it's still reasonable to advance to wave1.
    const preStageManifest = await readJsonObject(manifestPath);
    const preStage = asObject(preStageManifest.stage);
    const preCurrent = String(preStage.current ?? "").trim();
    if (preCurrent === "init") {
      const stageAdvance = await callTool(
        "stage_advance:init->wave1",
        stage_advance as unknown as ToolWithExecute,
        {
          manifest_path: manifestPath,
          gates_path: gatesPath,
          requested_next: "wave1",
          reason: created
            ? "operator-cli init: deterministic init->wave1 (new run)"
            : "operator-cli init: deterministic init->wave1 (resume)",
        },
      );

      if (String(stageAdvance.from ?? "") !== "init" || String(stageAdvance.to ?? "") !== "wave1") {
        throw new Error("stage_advance init->wave1 returned unexpected transition");
      }
    }
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runConfigPath = await writeRunConfig({
    runRoot,
    runId,
    manifestPath,
    gatesPath,
    manifest,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "init",
      run_id: runId,
      run_root: runRoot,
      manifest_path: manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      run_config_path: runConfigPath,
      perspectives_path: perspectivesPathOut,
      wave1_plan_path: wave1PlanPathOut,
      notes,
    });
    return;
  }

  printContract({
    runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log(`run_config_path: ${runConfigPath}`);
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

async function runStatus(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);
    emitContractCommandJson({
      command: "status",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary,
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

async function runInspect(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gatesDoc = await readJsonObject(summary.gatesPath);
  const gateStatuses = parseGateStatuses(gatesDoc);
  const blockedUrlsSummary = await readBlockedUrlsInspectSummary(summary.runRoot);
  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli inspect: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  if (args.json) {
    emitContractCommandJson({
      command: "inspect",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary: gateStatusesSummaryRecord(gateStatuses),
      extra: {
        blockers_summary: blockersSummaryJson(triage),
      },
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

  console.log("gate_statuses:");
  for (const gate of gateStatuses) {
    console.log(`  - ${gate.id}: ${gate.status}${gate.checked_at ? ` @ ${gate.checked_at}` : ""}`);
  }

  if (blockedUrlsSummary) {
    console.log("citations_blockers:");
    console.log(`  artifact_path: ${blockedUrlsSummary.artifactPath}`);
    console.log(`  total: ${blockedUrlsSummary.total}`);

    console.log("  by_status:");
    if (blockedUrlsSummary.byStatus.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.byStatus) {
        console.log(`    - ${row.status}: ${row.count}`);
      }
    }

    console.log("  next_steps:");
    if (blockedUrlsSummary.topActions.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.topActions) {
        console.log(`    - ${row.action} (count=${row.count})`);
      }
    }
  }

  console.log("blockers:");
  if (triage.allowed) {
    console.log(`  - none (next transition allowed: ${triage.from} -> ${triage.to})`);
  } else if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log(`  - ${triage.errorCode ?? "UNKNOWN"}: ${triage.errorMessage ?? "Unknown blocker"}`);
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`  - missing artifact: ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
    for (const gate of triage.blockedGates) {
      console.log(`  - blocked gate: ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
    for (const check of triage.failedChecks) {
      console.log(`  - failed ${check.kind}: ${check.name}`);
    }
  }

  await printInspectOperatorGuidance(summary.runRoot);
}

async function runTriage(args: RunStatusInspectTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);

  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli triage: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  if (args.json) {
    emitContractCommandJson({
      command: "triage",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary,
      extra: {
        blockers_summary: blockersSummaryJson(triage),
      },
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

  console.log("triage:");
  console.log(`  allowed: ${triage.allowed}`);
  console.log(`  from: ${triage.from}`);
  console.log(`  to: ${triage.to}`);
  if (triage.errorCode) console.log(`  error.code: ${triage.errorCode}`);
  if (triage.errorMessage) console.log(`  error.message: ${triage.errorMessage}`);

  if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log("  missing_artifacts: none");
    console.log("  blocked_gates: none");
    console.log("  failed_checks: none");
    return;
  }

  console.log("  missing_artifacts:");
  if (triage.missingArtifacts.length === 0) {
    console.log("    - none");
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  console.log("  blocked_gates:");
  if (triage.blockedGates.length === 0) {
    console.log("    - none");
  } else {
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  console.log("  failed_checks:");
  if (triage.failedChecks.length === 0) {
    console.log("    - none");
  } else {
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }
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

async function runPause(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");
  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli pause: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "paused" },
        expected_revision: manifestRevision,
        reason: `operator-cli pause: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "pause-checkpoint.md",
        content: [
          "# Pause Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} resume --manifest "${runHandle.manifestPath}" --reason "operator resume"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("pause.ok: true");
        console.log(`pause.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "pause",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runResume(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");
  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli resume: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "running", stage: { started_at: nowIso() } },
        expected_revision: manifestRevision,
        reason: `operator-cli resume: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "resume-checkpoint.md",
        content: [
          "# Resume Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("resume.ok: true");
        console.log(`resume.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "resume",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runCancel(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");

  if (summary.status === "cancelled") {
    if (args.json) {
      emitJson({
        ok: true,
        command: "cancel",
        note: "already cancelled",
        run_id: summary.runId,
        run_root: summary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: summary.gatesPath,
        stage_current: summary.stageCurrent,
        status: summary.status,
      });
    } else {
      console.log("cancel.ok: true");
      console.log("cancel.note: already cancelled");
    }
    return;
  }

  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli cancel: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "cancelled" },
        expected_revision: manifestRevision,
        reason: `operator-cli cancel: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "cancel-checkpoint.md",
        content: [
          "# Cancel Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} status --manifest "${runHandle.manifestPath}"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("cancel.ok: true");
        console.log(`cancel.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "cancel",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}

async function runCaptureFixtures(args: {
  manifest: string;
  outputDir?: string;
  bundleId?: string;
  reason: string;
  json?: boolean;
}): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifest = await readJsonObject(args.manifest);
  const summary = await summarizeManifest(manifest);
  const runId = summary.runId;
  const createdAt = nowIso();

  const outputDir = args.outputDir
    ? requireAbsolutePath(args.outputDir, "--output-dir")
    : path.join(summary.runRoot, "fixtures");
  const defaultBundleId = `${runId}_bundle_${timestampTokenFromIso(createdAt)}`;
  const bundleId = String(args.bundleId ?? defaultBundleId).trim();
  if (!bundleId) throw new Error("--bundle-id must be non-empty");

  const capture = await callTool("fixture_bundle_capture", fixture_bundle_capture as unknown as ToolWithExecute, {
    manifest_path: args.manifest,
    output_dir: outputDir,
    bundle_id: bundleId,
    reason: args.reason,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "capture-fixtures",
      run_id: runId,
      run_root: summary.runRoot,
      manifest_path: args.manifest,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      bundle_id: String(capture.bundle_id ?? bundleId),
      bundle_root: String(capture.bundle_root ?? ""),
      replay_command: "deep_research_fixture_replay --bundle_root <bundle_root>",
    });
    return;
  }

  printContract({
    runId,
    runRoot: summary.runRoot,
    manifestPath: args.manifest,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("capture_fixtures.ok: true");
  console.log(`capture_fixtures.bundle_id: ${String(capture.bundle_id ?? bundleId)}`);
  console.log(`capture_fixtures.bundle_root: ${String(capture.bundle_root ?? "")}`);
  console.log("capture_fixtures.replay: deep_research_fixture_replay --bundle_root <bundle_root>");
}

async function runRerunWave1(args: RerunWave1CliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const perspective = args.perspective.trim();
  const reason = args.reason.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(perspective)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const retryDirectivesPath = await safeResolveManifestPath(
    summary.runRoot,
    "retry/retry-directives.json",
    "retry.retry_directives_file",
  );

  const retryArtifact = {
    schema_version: "wave1.retry_directives.v1",
    run_id: summary.runId,
    stage: "wave1",
    generated_at: nowIso(),
    consumed_at: null,
    retry_directives: [
      {
        perspective_id: perspective,
        action: "retry",
        change_note: reason,
      },
    ],
    deferred_validation_failures: [],
  };

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli rerun wave1: ${reason}`,
    fn: async () => {
      await fs.mkdir(path.dirname(retryDirectivesPath), { recursive: true });
      await fs.writeFile(retryDirectivesPath, `${JSON.stringify(retryArtifact, null, 2)}\n`, "utf8");
    },
  });

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("rerun.wave1.ok: true");
  console.log(`rerun.wave1.retry_directives_path: ${retryDirectivesPath}`);
  console.log(`rerun.wave1.perspective_id: ${perspective}`);
}

async function runAgentResult(args: AgentResultCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const inputPath = requireAbsolutePath(args.input, "--input");
  const stage = args.stage;
  const perspectiveId = args.perspective.trim();
  const agentRunId = args.agentRunId.trim();
  const reason = args.reason.trim();

  if (stage !== "wave1" && stage !== "wave2" && stage !== "summaries" && stage !== "synthesis") {
    throw new Error("--stage must be wave1|wave2|summaries|synthesis");
  }
  if (!isSafeSegment(perspectiveId)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!agentRunId) {
    throw new Error("--agent-run-id must be non-empty");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const sourceMarkdown = await fs.readFile(inputPath, "utf8");
  if (!sourceMarkdown.trim()) {
    throw new Error("--input markdown is empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runRoot = summary.runRoot;
  let promptMd: string;
  let promptDigest: string;
  let outputPath: string;
  let metaPath: string;

  if (stage === "wave1" || stage === "wave2") {
    const planEntries = stage === "wave1"
      ? await readWave1PlanEntries(runRoot)
      : await readWave2PlanEntries(runRoot);
    const planEntry = planEntries.find((entry) => entry.perspectiveId === perspectiveId);
    if (!planEntry) {
      throw new Error(`perspective ${perspectiveId} not found in ${stage} plan`);
    }
    promptMd = planEntry.promptMd;
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    const waveDir = stage === "wave1" ? "wave-1" : "wave-2";
    outputPath = path.join(runRoot, waveDir, `${perspectiveId}.md`);
    metaPath = path.join(runRoot, waveDir, `${perspectiveId}.meta.json`);
  } else if (stage === "summaries") {
    const promptPath = path.join(runRoot, "operator", "prompts", "summaries", `${perspectiveId}.md`);
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`summary prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "summaries", `${perspectiveId}.md`);
    metaPath = path.join(runRoot, "summaries", `${perspectiveId}.meta.json`);
  } else {
    // synthesis
    const promptPath = path.join(runRoot, "operator", "prompts", "synthesis", "final-synthesis.md");
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`synthesis prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "synthesis", "final-synthesis.md");
    metaPath = path.join(runRoot, "synthesis", "final-synthesis.meta.json");
  }

  assertWithinRoot(runRoot, outputPath, `${stage} output`);
  assertWithinRoot(runRoot, metaPath, `${stage} meta sidecar`);

  const startedAt = normalizeOptional(args.startedAt);
  const finishedAt = normalizeOptional(args.finishedAt);
  const model = normalizeOptional(args.model);
  const ingestedAt = nowIso();

  const sidecar = {
    schema_version: "wave-output-meta.v1",
    prompt_digest: promptDigest,
    agent_run_id: agentRunId,
    ingested_at: ingestedAt,
    source_input_path: inputPath,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(model ? { model } : {}),
  };

  await withRunLock({
    runRoot,
    reason: `operator-cli agent-result: ${reason}`,
    fn: async () => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${sourceMarkdown.trim()}\n`, "utf8");
      await fs.writeFile(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    },
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "agent-result",
      run_id: summary.runId,
      run_root: runRoot,
      manifest_path: manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      stage,
      perspective_id: perspectiveId,
      output_path: outputPath,
      meta_path: metaPath,
      prompt_digest: promptDigest,
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("agent_result.ok: true");
  console.log(`agent_result.stage: ${stage}`);
  console.log(`agent_result.perspective_id: ${perspectiveId}`);
  console.log(`agent_result.output_path: ${outputPath}`);
  console.log(`agent_result.meta_path: ${metaPath}`);
  console.log(`agent_result.prompt_digest: ${promptDigest}`);
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

const statusCmd = createStatusCmd({ AbsolutePath, runStatus });

const inspectCmd = createInspectCmd({ AbsolutePath, runInspect });

const triageCmd = createTriageCmd({ AbsolutePath, runTriage });

const pauseCmd = createPauseCmd({ AbsolutePath, runPause });

const resumeCmd = createResumeCmd({ AbsolutePath, runResume });

const cancelCmd = createCancelCmd({ AbsolutePath, runCancel });

const captureFixturesCmd = createCaptureFixturesCmd({ AbsolutePath, runCaptureFixtures });

const rerunWave1Cmd = command({
  name: "wave1",
  description: "Write/overwrite wave1 retry directives for one perspective",
  args: {
    manifest: option({ long: "manifest", type: AbsolutePath }),
    perspective: option({ long: "perspective", type: string }),
    reason: option({ long: "reason", type: string }),
  },
  handler: async (args) => {
    await runRerunWave1({
      manifest: args.manifest,
      perspective: args.perspective,
      reason: args.reason,
    });
  },
});

const rerunCmd = subcommands({
  name: "rerun",
  cmds: {
    wave1: rerunWave1Cmd,
  },
});

const app = subcommands({
  name: "deep-research-option-c",
  cmds: {
    init: initCmd,
    tick: tickCmd,
    "agent-result": agentResultCmd,
    run: runCmd,
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
