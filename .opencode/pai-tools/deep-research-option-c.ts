#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import type { Type } from "cmd-ts";
import {
  boolean,
  command,
  flag,
  number,
  oneOf,
  option,
  optional,
  positional,
  run,
  string,
  subcommands,
} from "cmd-ts";

import {
  acquireRunLock,
  releaseRunLock,
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
  perspectives_write,
  run_init,
  stage_advance,
  watchdog_check,
  wave1_plan,
} from "../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../tools/deep_research/lifecycle_lib";

type ToolEnvelope = Record<string, unknown> & { ok: boolean };
type ToolWithExecute = {
  execute: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
};

type InitCliArgs = {
  query: string;
  runId?: string;
  sensitivity: "normal" | "restricted" | "no_web";
  mode: "quick" | "standard" | "deep";
  writePerspectives: boolean;
  force: boolean;
};

type RunHandleCliArgs = {
  runId?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

type TickCliArgs = RunHandleCliArgs & {
  reason: string;
  driver: "fixture" | "live";
};

type RunCliArgs = TickCliArgs & {
  maxTicks: number;
  until?: string;
};

type PauseResumeCliArgs = RunHandleCliArgs & {
  reason: string;
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

function makeToolContext() {
  return {
    sessionID: "ses_option_c_cli",
    messageID: "msg_option_c_cli",
    agent: "deep-research-option-c-cli",
    directory: process.cwd(),
    worktree: process.cwd(),
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
    process.env.PAI_DR_OPTION_C_ENABLED = "1";
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
    && !normalized.split(path.sep).some((segment) => segment === "..");
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

  const relFromRoot = path.relative(runRootReal, candidate);
  if (relFromRoot === "" || relFromRoot === ".") {
    return path.join(runRootReal, path.basename(candidate));
  }
  if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
    throw new Error(`${field} escapes runRoot`);
  }

  return candidate;
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

    const isSafeSegment = (value: string): boolean => /^[A-Za-z0-9_-]+$/.test(value);

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
    const flags = resolveDeepResearchFlagsV1();
    const runsRoot = requireAbsolutePath(flags.runsRoot, "PAI_DR_RUNS_ROOT");
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

async function printAutoTriage(args: { manifestPath: string; gatesPath: string; reason: string }): Promise<void> {
  try {
    const dryRun = await stageAdvanceDryRun({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.reason,
    });
    const triage = triageFromStageAdvanceResult(dryRun);
    printBlockersSummary(triage);
  } catch (error) {
    console.log("blockers.summary:");
    console.log(`  unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const init = await callTool("run_init", run_init as unknown as ToolWithExecute, {
    query: args.query,
    mode: args.mode,
    sensitivity: args.sensitivity,
    run_id: args.runId,
  });

  const runId = String(init.run_id ?? "").trim();
  const runRoot = requireAbsolutePath(String(init.root ?? ""), "run_init root");
  const manifestPath = requireAbsolutePath(String(init.manifest_path ?? ""), "run_init manifest_path");
  const gatesPath = requireAbsolutePath(String(init.gates_path ?? ""), "run_init gates_path");

  const created = Boolean(init.created);

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
      console.log("perspectives.note: existing perspectives preserved (use --force to overwrite)");
    }
    console.log(`perspectives_path: ${perspectivesPath}`);

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
      console.log(`wave1_plan_path: ${produced}`);
    } else {
      console.log(`wave1_plan_path: ${wave1PlanPath}`);
      console.log("wave1_plan.note: existing plan preserved (use --force to overwrite)");
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

async function runTick(args: TickCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  if (args.driver === "fixture") {
    const fixtureResult = await orchestrator_tick_fixture({
      manifest_path: runHandle.manifestPath,
      gates_path: runHandle.gatesPath,
      reason: args.reason,
      fixture_driver: ({ stage, run_root }) => defaultFixtureDriver({ stage, run_root }),
      tool_context: makeToolContext(),
    });

    if (!fixtureResult.ok) {
      console.log(`tick.driver: fixture`);
      console.log(`tick.ok: false`);
      console.log(`tick.error.code: ${fixtureResult.error.code}`);
      console.log(`tick.error.message: ${fixtureResult.error.message}`);
      console.log(`tick.error.details: ${JSON.stringify(fixtureResult.error.details ?? {}, null, 2)}`);
      await printAutoTriage({
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: `operator-cli tick auto-triage: ${args.reason}`,
      });
    } else {
      console.log(`tick.driver: fixture`);
      console.log(`tick.ok: true`);
      console.log(`tick.from: ${fixtureResult.from}`);
      console.log(`tick.to: ${fixtureResult.to}`);
      console.log(`tick.wave_outputs_count: ${fixtureResult.wave_outputs_count}`);
    }
  } else {
    const driver = createOperatorInputDriver();

    await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [pre_tick]`,
    });

    const manifest = await readJsonObject(runHandle.manifestPath);
    const summary = await summarizeManifest(manifest);
    const stage = summary.stageCurrent;

    let result: OrchestratorTickLiveResult | OrchestratorTickPostPivotResult | OrchestratorTickPostSummariesResult;
    if (stage === "init" || stage === "wave1") {
      result = await orchestrator_tick_live({
        manifest_path: runHandle.manifestPath,
        gates_path: runHandle.gatesPath,
        reason: args.reason,
        drivers: { runAgent: driver },
        tool_context: makeToolContext(),
      });
    } else if (stage === "pivot" || stage === "citations") {
      result = await orchestrator_tick_post_pivot({
        manifest_path: runHandle.manifestPath,
        gates_path: runHandle.gatesPath,
        reason: args.reason,
        tool_context: makeToolContext(),
      });
    } else {
      result = await orchestrator_tick_post_summaries({
        manifest_path: runHandle.manifestPath,
        gates_path: runHandle.gatesPath,
        reason: args.reason,
        tool_context: makeToolContext(),
      });
    }

    if (!result.ok) {
      console.log(`tick.driver: live`);
      console.log(`tick.ok: false`);
      console.log(`tick.error.code: ${result.error.code}`);
      console.log(`tick.error.message: ${result.error.message}`);
      console.log(`tick.error.details: ${JSON.stringify(result.error.details ?? {}, null, 2)}`);
      await printAutoTriage({
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: `operator-cli tick auto-triage: ${args.reason}`,
      });
    } else {
      console.log(`tick.driver: live`);
      console.log(`tick.ok: true`);
      console.log(`tick.from: ${String(result.from ?? "")}`);
      console.log(`tick.to: ${String(result.to ?? "")}`);
      if ("wave_outputs_count" in result && typeof result.wave_outputs_count === "number") {
        console.log(`tick.wave_outputs_count: ${result.wave_outputs_count}`);
      }
    }

    await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [post_tick]`,
    });
  }

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runStatus(args: RunHandleCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runInspect(args: RunHandleCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gatesDoc = await readJsonObject(summary.gatesPath);
  const gateStatuses = parseGateStatuses(gatesDoc);
  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli inspect: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

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

async function runTriage(args: RunHandleCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli triage: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

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

  for (let i = 1; i <= args.maxTicks; i += 1) {
    const pre = (await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [pre_tick_${i}]`,
    })) as ToolEnvelope & { timed_out?: boolean; checkpoint_path?: string };
    if (pre.timed_out === true) {
      console.log("run.ok: false");
      console.log("run.error.code: WATCHDOG_TIMEOUT");
      console.log("run.error.message: stage timed out before tick execution");
      console.log(`run.checkpoint_path: ${String(pre.checkpoint_path ?? "")}`);
      return;
    }

    const manifest = await readJsonObject(runHandle.manifestPath);
    const summary = await summarizeManifest(manifest);

    if (summary.status === "completed" || summary.status === "failed" || summary.status === "cancelled") {
      console.log("run.ok: true");
      printContract({
        runId: summary.runId,
        runRoot: summary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        stageCurrent: summary.stageCurrent,
        status: summary.status,
      });
      return;
    }

    if (args.until && summary.stageCurrent === args.until) {
      console.log("run.ok: true");
      console.log(`run.until_reached: ${args.until}`);
      printContract({
        runId: summary.runId,
        runRoot: summary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        stageCurrent: summary.stageCurrent,
        status: summary.status,
      });
      return;
    }

    if (summary.status === "paused") {
      console.log("run.ok: false");
      console.log("run.error.code: PAUSED");
      console.log("run.error.message: run is paused; resume first");
      printContract({
        runId: summary.runId,
        runRoot: summary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: summary.gatesPath,
        stageCurrent: summary.stageCurrent,
        status: summary.status,
      });
      return;
    }

    let result:
      | OrchestratorTickFixtureResult
      | OrchestratorTickLiveResult
      | OrchestratorTickPostPivotResult
      | OrchestratorTickPostSummariesResult;
    if (args.driver === "fixture") {
      result = await orchestrator_tick_fixture({
        manifest_path: runHandle.manifestPath,
        gates_path: runHandle.gatesPath,
        reason: `${args.reason} [tick_${i}]`,
        fixture_driver: ({ stage, run_root }) => defaultFixtureDriver({ stage, run_root }),
        tool_context: makeToolContext(),
      });
    } else {
      const stage = summary.stageCurrent;
      if (stage === "init" || stage === "wave1") {
        if (!liveDriver) {
          throw new Error("internal: live driver missing");
        }
        result = await orchestrator_tick_live({
          manifest_path: runHandle.manifestPath,
          gates_path: runHandle.gatesPath,
          reason: `${args.reason} [tick_${i}]`,
          drivers: { runAgent: liveDriver },
          tool_context: makeToolContext(),
        });
      } else if (stage === "pivot" || stage === "citations") {
        result = await orchestrator_tick_post_pivot({
          manifest_path: runHandle.manifestPath,
          gates_path: runHandle.gatesPath,
          reason: `${args.reason} [tick_${i}]`,
          tool_context: makeToolContext(),
        });
      } else {
        result = await orchestrator_tick_post_summaries({
          manifest_path: runHandle.manifestPath,
          gates_path: runHandle.gatesPath,
          reason: `${args.reason} [tick_${i}]`,
          tool_context: makeToolContext(),
        });
      }
    }

    if (!result.ok) {
      if (result.error.code === "CANCELLED") {
        const current = await readJsonObject(runHandle.manifestPath);
        const currentSummary = await summarizeManifest(current);
        console.log("run.ok: true");
        printContract({
          runId: currentSummary.runId,
          runRoot: currentSummary.runRoot,
          manifestPath: runHandle.manifestPath,
          gatesPath: currentSummary.gatesPath,
          stageCurrent: currentSummary.stageCurrent,
          status: currentSummary.status,
        });
        return;
      }

      console.log("run.ok: false");
      console.log(`run.error.code: ${result.error.code}`);
      console.log(`run.error.message: ${result.error.message}`);
      console.log(`run.error.details: ${JSON.stringify(result.error.details ?? {}, null, 2)}`);
      await printAutoTriage({
        manifestPath: runHandle.manifestPath,
        gatesPath: runHandle.gatesPath,
        reason: `operator-cli run auto-triage: ${args.reason}`,
      });
      return;
    }

    console.log(`run.tick_${i}.from: ${String(result.from ?? "")}`);
    console.log(`run.tick_${i}.to: ${String(result.to ?? "")}`);
    if ("wave_outputs_count" in result && typeof result.wave_outputs_count === "number") {
      console.log(`run.tick_${i}.wave_outputs_count: ${result.wave_outputs_count}`);
    }

    const post = (await callTool("watchdog_check", watchdog_check as unknown as ToolWithExecute, {
      manifest_path: runHandle.manifestPath,
      reason: `${args.reason} [post_tick_${i}]`,
    })) as ToolEnvelope & { timed_out?: boolean; checkpoint_path?: string };
    if (post.timed_out === true) {
      console.log("run.ok: false");
      console.log("run.error.code: WATCHDOG_TIMEOUT");
      console.log("run.error.message: stage timed out after tick execution");
      console.log(`run.checkpoint_path: ${String(post.checkpoint_path ?? "")}`);
      return;
    }

    const after = await readJsonObject(runHandle.manifestPath);
    const afterSummary = await summarizeManifest(after);
    if (afterSummary.status === "completed" || afterSummary.status === "failed" || afterSummary.status === "cancelled") {
      console.log("run.ok: true");
      printContract({
        runId: afterSummary.runId,
        runRoot: afterSummary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: afterSummary.gatesPath,
        stageCurrent: afterSummary.stageCurrent,
        status: afterSummary.status,
      });
      return;
    }

    if (args.until && afterSummary.stageCurrent === args.until) {
      console.log("run.ok: true");
      console.log(`run.until_reached: ${args.until}`);
      printContract({
        runId: afterSummary.runId,
        runRoot: afterSummary.runRoot,
        manifestPath: runHandle.manifestPath,
        gatesPath: afterSummary.gatesPath,
        stageCurrent: afterSummary.stageCurrent,
        status: afterSummary.status,
      });
      return;
    }

    if (String(result.to ?? "") === String(result.from ?? "")) {
      console.log("run.note: stage did not advance");
      return;
    }
  }

  console.log("run.ok: false");
  console.log("run.error.code: TICK_CAP_EXCEEDED");
  console.log("run.error.message: max ticks reached before completion");
}

async function runPause(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");

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

      const checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "pause-checkpoint.md",
        content: [
          "# Pause Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: bun "pai-tools/deep-research-option-c.ts" resume --manifest "${runHandle.manifestPath}" --reason "operator resume"`,
        ].join("\n"),
      });

      console.log("pause.ok: true");
      console.log(`pause.checkpoint_path: ${checkpointPath}`);
    },
  });
}

async function runResume(args: PauseResumeCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");

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

      const checkpointPath = await writeCheckpoint({
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

      console.log("resume.ok: true");
      console.log(`resume.checkpoint_path: ${checkpointPath}`);
    },
  });
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
    console.log("cancel.ok: true");
    console.log("cancel.note: already cancelled");
    return;
  }

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

      const checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "cancel-checkpoint.md",
        content: [
          "# Cancel Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: bun \"pai-tools/deep-research-option-c.ts\" status --manifest \"${runHandle.manifestPath}\"`,
        ].join("\n"),
      });

      console.log("cancel.ok: true");
      console.log(`cancel.checkpoint_path: ${checkpointPath}`);
    },
  });
}

const AbsolutePath: Type<string, string> = {
  async from(str) {
    return requireAbsolutePath(str, "path");
  },
};

const initCmd = command({
  name: "init",
  description: "Initialize a new Option C run",
  args: {
    query: positional({ type: string, displayName: "query" }),
    runId: option({ long: "run-id", type: optional(string) }),
    sensitivity: option({ long: "sensitivity", type: optional(oneOf(["normal", "restricted", "no_web"])) }),
    mode: option({ long: "mode", type: optional(oneOf(["quick", "standard", "deep"])) }),
    noPerspectives: flag({ long: "no-perspectives", type: boolean }),
    force: flag({ long: "force", type: boolean }),
  },
  handler: async (args) => {
    await runInit({
      query: args.query,
      runId: args.runId,
      sensitivity: (args.sensitivity ?? "normal") as InitCliArgs["sensitivity"],
      mode: (args.mode ?? "standard") as InitCliArgs["mode"],
      writePerspectives: !args.noPerspectives,
      force: args.force,
    });
  },
});

const runUntilStages = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"] as const;

const tickCmd = command({
  name: "tick",
  description: "Run exactly one orchestrator tick (driver-specific, run-handle aware)",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
    gates: option({ long: "gates", type: optional(AbsolutePath) }),
    reason: option({ long: "reason", type: string }),
    driver: option({ long: "driver", type: oneOf(["fixture", "live"]) }),
  },
  handler: async (args) => {
    await runTick({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
      gates: args.gates,
      reason: args.reason,
      driver: args.driver as TickCliArgs["driver"],
    });
  },
});

const runCmd = command({
  name: "run",
  description: "Run multiple ticks with watchdog enforcement and stage stops",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
    gates: option({ long: "gates", type: optional(AbsolutePath) }),
    reason: option({ long: "reason", type: string }),
    driver: option({ long: "driver", type: oneOf(["fixture", "live"]) }),
    maxTicks: option({ long: "max-ticks", type: optional(number) }),
    until: option({ long: "until", type: optional(oneOf([...runUntilStages])) }),
  },
  handler: async (args) => {
    await runRun({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
      gates: args.gates,
      reason: args.reason,
      driver: args.driver as RunCliArgs["driver"],
      maxTicks: args.maxTicks ?? 10,
      until: args.until,
    });
  },
});

const statusCmd = command({
  name: "status",
  description: "Print the run contract fields (run-id-first)",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
  },
  handler: async (args) => {
    await runStatus({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
    });
  },
});

const inspectCmd = command({
  name: "inspect",
  description: "Print gate status + next-stage blockers",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
  },
  handler: async (args) => {
    await runInspect({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
    });
  },
});

const triageCmd = command({
  name: "triage",
  description: "Print a compact blocker summary from stage_advance dry-run",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
  },
  handler: async (args) => {
    await runTriage({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
    });
  },
});

const pauseCmd = command({
  name: "pause",
  description: "Pause a run durably and write a checkpoint artifact",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
    reason: option({ long: "reason", type: optional(string) }),
  },
  handler: async (args) => {
    await runPause({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
      reason: args.reason ?? "operator-cli pause",
    });
  },
});

const resumeCmd = command({
  name: "resume",
  description: "Resume a paused run and reset stage timer semantics",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
    reason: option({ long: "reason", type: optional(string) }),
  },
  handler: async (args) => {
    await runResume({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
      reason: args.reason ?? "operator-cli resume",
    });
  },
});

const cancelCmd = command({
  name: "cancel",
  description: "Cancel a run durably and write a cancel checkpoint",
  args: {
    runId: option({ long: "run-id", type: optional(string) }),
    runRoot: option({ long: "run-root", type: optional(AbsolutePath) }),
    manifest: option({ long: "manifest", type: optional(AbsolutePath) }),
    reason: option({ long: "reason", type: optional(string) }),
  },
  handler: async (args) => {
    await runCancel({
      runId: args.runId,
      runRoot: args.runRoot,
      manifest: args.manifest,
      reason: args.reason ?? "operator-cli cancel",
    });
  },
});

const app = subcommands({
  name: "deep-research-option-c",
  cmds: {
    init: initCmd,
    tick: tickCmd,
    run: runCmd,
    status: statusCmd,
    inspect: inspectCmd,
    triage: triageCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    cancel: cancelCmd,
  },
});

run(app, process.argv.slice(2)).catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
