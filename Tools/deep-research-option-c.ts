#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  orchestrator_tick_fixture,
  orchestrator_tick_live,
  perspectives_write,
  run_init,
  stage_advance,
} from "../.opencode/tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../.opencode/tools/deep_research/lifecycle_lib";

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
};

type TickCliArgs = {
  manifest: string;
  gates: string;
  reason: string;
  driver: "fixture" | "live";
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

function usage(): string {
  return [
    "Option C operator CLI (WS1)",
    "",
    "Usage:",
    "  bun Tools/deep-research-option-c.ts init \"<query>\" [--run-id <id>] [--sensitivity normal|restricted|no_web] [--mode quick|standard|deep] [--no-perspectives]",
    "  bun Tools/deep-research-option-c.ts tick --manifest <abs> --gates <abs> --reason \"...\" --driver <fixture|live>",
    "  bun Tools/deep-research-option-c.ts status --manifest <abs>",
    "  bun Tools/deep-research-option-c.ts inspect --manifest <abs>",
    "  bun Tools/deep-research-option-c.ts triage --manifest <abs>",
    "  bun Tools/deep-research-option-c.ts --help",
  ].join("\n");
}

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

  const candidate = path.resolve(runRoot, relTrimmed);
  const runRootReal = await fs.realpath(runRoot);

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

function parseInitArgs(argv: string[]): InitCliArgs {
  if (argv.length === 0) throw new Error("init requires \"<query>\"");

  const query = argv[0]?.trim();
  if (!query || query.startsWith("--")) {
    throw new Error("init requires \"<query>\" as first positional argument");
  }

  const out: InitCliArgs = {
    query,
    sensitivity: "normal",
    mode: "standard",
    writePerspectives: true,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-id") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--run-id requires a value");
      out.runId = value;
      i += 1;
      continue;
    }
    if (arg === "--sensitivity") {
      const value = argv[i + 1]?.trim();
      if (value !== "normal" && value !== "restricted" && value !== "no_web") {
        throw new Error("--sensitivity must be one of: normal|restricted|no_web");
      }
      out.sensitivity = value;
      i += 1;
      continue;
    }
    if (arg === "--mode") {
      const value = argv[i + 1]?.trim();
      if (value !== "quick" && value !== "standard" && value !== "deep") {
        throw new Error("--mode must be one of: quick|standard|deep");
      }
      out.mode = value;
      i += 1;
      continue;
    }
    if (arg === "--no-perspectives") {
      out.writePerspectives = false;
      continue;
    }
    throw new Error(`Unknown init argument: ${arg}`);
  }

  return out;
}

function parseTickArgs(argv: string[]): TickCliArgs {
  const out: Partial<TickCliArgs> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--manifest requires a value");
      out.manifest = requireAbsolutePath(value, "--manifest");
      i += 1;
      continue;
    }
    if (arg === "--gates") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--gates requires a value");
      out.gates = requireAbsolutePath(value, "--gates");
      i += 1;
      continue;
    }
    if (arg === "--reason") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--reason requires a value");
      out.reason = value;
      i += 1;
      continue;
    }
    if (arg === "--driver") {
      const value = argv[i + 1]?.trim();
      if (value !== "fixture" && value !== "live") {
        throw new Error("--driver must be fixture|live");
      }
      out.driver = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown tick argument: ${arg}`);
  }

  if (!out.manifest || !out.gates || !out.reason || !out.driver) {
    throw new Error("tick requires --manifest, --gates, --reason, and --driver");
  }

  return out as TickCliArgs;
}

function parseManifestOnlyArgs(argv: string[], command: "status" | "inspect" | "triage"): string {
  if (argv.length !== 2 || argv[0] !== "--manifest") {
    throw new Error(`${command} requires --manifest <abs>`);
  }
  return requireAbsolutePath(argv[1], "--manifest");
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

async function resolveGatesPathFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const gatesRel = String(pathsObj.gates_file ?? "gates.json").trim() || "gates.json";
  return safeResolveManifestPath(runRoot, gatesRel, "manifest.artifacts.paths.gates_file");
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

async function runInit(argv: string[]): Promise<void> {
  ensureOptionCEnabledForCli();
  const args = parseInitArgs(argv);

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

  if (args.writePerspectives) {
    const perspectivesPath = path.join(runRoot, "perspectives.json");
    await callTool("perspectives_write", perspectives_write as unknown as ToolWithExecute, {
      perspectives_path: perspectivesPath,
      value: defaultPerspectivePayload(runId),
      reason: "operator-cli init: default perspectives",
    });
    console.log(`perspectives_path: ${perspectivesPath}`);
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
    gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log(`run_config_path: ${runConfigPath}`);
}

async function runTick(argv: string[]): Promise<void> {
  ensureOptionCEnabledForCli();
  const args = parseTickArgs(argv);

  if (args.driver === "fixture") {
    const fixtureResult = await orchestrator_tick_fixture({
      manifest_path: args.manifest,
      gates_path: args.gates,
      reason: args.reason,
      fixture_driver: ({ stage, run_root }) => defaultFixtureDriver({ stage, run_root }),
      tool_context: makeToolContext(),
    });

    if (!fixtureResult.ok) {
      console.log(`tick.driver: fixture`);
      console.log(`tick.ok: false`);
      console.log(`tick.error.code: ${fixtureResult.error.code}`);
      console.log(`tick.error.message: ${fixtureResult.error.message}`);
    } else {
      console.log(`tick.driver: fixture`);
      console.log(`tick.ok: true`);
      console.log(`tick.from: ${fixtureResult.from}`);
      console.log(`tick.to: ${fixtureResult.to}`);
      console.log(`tick.wave_outputs_count: ${fixtureResult.wave_outputs_count}`);
    }
  } else {
    const liveResult = await orchestrator_tick_live({
      manifest_path: args.manifest,
      gates_path: args.gates,
      reason: args.reason,
      drivers: {
        runAgent: async () => ({
          markdown: "",
          error: {
            code: "NOT_IMPLEMENTED",
            message: "WS1 intentionally omits generate-mode live runAgent execution",
          },
        }),
      },
      tool_context: makeToolContext(),
    });

    if (!liveResult.ok) {
      console.log(`tick.driver: live`);
      console.log(`tick.ok: false`);
      console.log(`tick.error.code: ${liveResult.error.code}`);
      console.log(`tick.error.message: ${liveResult.error.message}`);
    } else {
      console.log(`tick.driver: live`);
      console.log(`tick.ok: true`);
      console.log(`tick.from: ${liveResult.from}`);
      console.log(`tick.to: ${liveResult.to}`);
      console.log(`tick.wave_outputs_count: ${liveResult.wave_outputs_count}`);
    }
  }

  const manifest = await readJsonObject(args.manifest);
  const summary = await summarizeManifest(manifest);
  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: args.manifest,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runStatus(argv: string[]): Promise<void> {
  const manifestPath = parseManifestOnlyArgs(argv, "status");
  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
}

async function runInspect(argv: string[]): Promise<void> {
  const manifestPath = parseManifestOnlyArgs(argv, "inspect");
  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const gatesDoc = await readJsonObject(summary.gatesPath);
  const gateStatuses = parseGateStatuses(gatesDoc);
  const dryRun = await stageAdvanceDryRun({
    manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli inspect: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
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
    return;
  }

  if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log(`  - ${triage.errorCode ?? "UNKNOWN"}: ${triage.errorMessage ?? "Unknown blocker"}`);
    return;
  }

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

async function runTriage(argv: string[]): Promise<void> {
  const manifestPath = parseManifestOnlyArgs(argv, "triage");
  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);

  const dryRun = await stageAdvanceDryRun({
    manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli triage: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const rest = argv.slice(1);

  if (command === "init") {
    await runInit(rest);
    return;
  }
  if (command === "tick") {
    await runTick(rest);
    return;
  }
  if (command === "status") {
    await runStatus(rest);
    return;
  }
  if (command === "inspect") {
    await runInspect(rest);
    return;
  }
  if (command === "triage") {
    await runTriage(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

await main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage());
  process.exit(1);
});
