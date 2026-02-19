#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gate_c_compute,
  gates_write,
  orchestrator_run_post_summaries,
  pivot_decide,
  run_init,
  stage_advance,
  wave_output_validate,
} from "../.opencode/tools/deep_research.ts";

type ToolEnvelope = Record<string, unknown> & { ok: boolean };
type ToolWithExecute = {
  execute: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
};

type CliArgs = {
  help: boolean;
  runId?: string;
};

const EXTRACTED_URLS = [
  "https://example.com/source-a",
  "https://example.com/source-b",
  "https://example.com/source-c",
];

function usage(): string {
  return [
    "Option C deterministic fixture runner (no web)",
    "",
    "Usage:",
    "  bun Tools/deep-research-option-c-fixture-run.ts [--run-id <id>]",
    "  bun Tools/deep-research-option-c-fixture-run.ts --help",
    "",
    "Flags:",
    "  --run-id   Optional run id (default: timestamp-based)",
    "  --help     Show this help message",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--run-id") {
      const value = argv[i + 1]?.trim();
      if (!value) {
        throw new Error("--run-id requires a value");
      }
      out.runId = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

function defaultRunId(): string {
  const stamp = new Date().toISOString().replace(/[.:TZ-]/g, "");
  return `dr_fixture_${stamp}`;
}

function makeToolContext() {
  return {
    sessionID: "ses_fixture_runner",
    messageID: "msg_fixture_runner",
    agent: "fixture-runner",
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

function formatError(name: string, envelope: ToolEnvelope): string {
  const errorObj = envelope.error;
  if (!errorObj || typeof errorObj !== "object") {
    return `${name} failed`;
  }
  const error = errorObj as Record<string, unknown>;
  const code = String(error.code ?? "UNKNOWN");
  const message = String(error.message ?? "Unknown failure");
  const details = JSON.stringify(error.details ?? {});
  return `${name} failed: ${code} ${message} ${details}`;
}

async function callTool(name: string, tool: ToolWithExecute, args: Record<string, unknown>): Promise<ToolEnvelope> {
  const raw = await tool.execute(args, makeToolContext());
  const out = parseToolEnvelope(name, raw);
  if (!out.ok) {
    throw new Error(formatError(name, out));
  }
  return out;
}

function requireString(envelope: ToolEnvelope, key: string, label: string): string {
  const value = envelope[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} missing '${key}'`);
  }
  return value;
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  try {
    await fs.stat(filePath);
  } catch {
    throw new Error(`${label} missing at ${filePath}`);
  }
}

function buildWaveMarkdown(perspectiveId: string): string {
  return [
    "## Findings",
    `Deterministic fixture finding for ${perspectiveId} with bounded evidence.`,
    "",
    "## Sources",
    "- https://example.com/source-a",
    "",
    "## Gaps",
    "No critical gaps identified.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const runIdRequested = args.runId ?? defaultRunId();

  const toolsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(toolsDir, "..");
  const phase05FixtureRoot = path.join(repoRoot, ".opencode", "tests", "fixtures", "summaries", "phase05");

  const perspectivesFixturePath = path.join(phase05FixtureRoot, "perspectives.json");
  const citationsFixturePath = path.join(phase05FixtureRoot, "citations.jsonl");
  const summariesFixtureDir = path.join(phase05FixtureRoot, "summaries-pass");
  const synthesisFixturePath = path.join(phase05FixtureRoot, "synthesis", "final-synthesis-pass.md");
  const reviewFixtureDir = path.join(phase05FixtureRoot, "review-fixture", "pass");

  await assertFileExists(perspectivesFixturePath, "perspectives fixture");
  await assertFileExists(citationsFixturePath, "citations fixture");
  await assertFileExists(synthesisFixturePath, "synthesis fixture");
  await assertFileExists(path.join(reviewFixtureDir, "review-bundle.json"), "review fixture");

  const init = await callTool("run_init", run_init as unknown as ToolWithExecute, {
    query: "Deterministic Option C fixture pipeline to finalize",
    mode: "standard",
    sensitivity: "no_web",
    run_id: runIdRequested,
  });

  const runId = requireString(init, "run_id", "run_init output");
  const runRoot = requireString(init, "root", "run_init output");
  const manifestPath = requireString(init, "manifest_path", "run_init output");
  const gatesPath = requireString(init, "gates_path", "run_init output");

  const perspectivesRaw = JSON.parse(await fs.readFile(perspectivesFixturePath, "utf8")) as Record<string, unknown>;
  perspectivesRaw.run_id = runId;
  const perspectivesPath = path.join(runRoot, "perspectives.json");
  await fs.writeFile(perspectivesPath, `${JSON.stringify(perspectivesRaw, null, 2)}\n`, "utf8");

  await callTool("stage_advance:init->wave1", stage_advance as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    requested_next: "wave1",
    reason: "fixture runner: init->wave1",
  });

  const wave1Dir = path.join(runRoot, "wave-1");
  const perspectiveIds = ["p1", "p2", "p3"] as const;
  const waveOutputPaths = new Map<string, string>();
  for (const perspectiveId of perspectiveIds) {
    const outputPath = path.join(wave1Dir, `${perspectiveId}.md`);
    await fs.writeFile(outputPath, buildWaveMarkdown(perspectiveId), "utf8");
    waveOutputPaths.set(perspectiveId, outputPath);
  }

  const waveValidationReports: Array<Record<string, unknown>> = [];
  for (const perspectiveId of perspectiveIds) {
    const markdownPath = waveOutputPaths.get(perspectiveId);
    if (!markdownPath) {
      throw new Error(`Missing markdown path for ${perspectiveId}`);
    }
    const report = await callTool(
      `wave_output_validate:${perspectiveId}`,
      wave_output_validate as unknown as ToolWithExecute,
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: markdownPath,
      },
    );
    waveValidationReports.push(report);
  }

  const waveReviewPath = path.join(runRoot, "wave-review.json");
  const waveReviewFixture = {
    schema_version: "wave_review.v1",
    run_id: runId,
    ok: true,
    pass: true,
    validated: perspectiveIds.length,
    failed: 0,
    results: perspectiveIds.map((perspectiveId) => ({
      perspective_id: perspectiveId,
      pass: true,
      failure: null,
    })),
    retry_directives: [],
  };
  await fs.writeFile(waveReviewPath, `${JSON.stringify(waveReviewFixture, null, 2)}\n`, "utf8");

  const gateBCheckedAt = new Date().toISOString();
  await callTool("gates_write:B", gates_write as unknown as ToolWithExecute, {
    gates_path: gatesPath,
    inputs_digest: "sha256:fixture-gate-b-pass",
    reason: "fixture runner: gate B pass",
    update: {
      B: {
        status: "pass",
        checked_at: gateBCheckedAt,
        metrics: { validated: perspectiveIds.length, failed: 0 },
        artifacts: [
          "wave-review.json",
          "wave-1/p1.md",
          "wave-1/p2.md",
          "wave-1/p3.md",
        ],
        warnings: [],
        notes: "Fixture pass seeded by deep-research-option-c-fixture-run",
      },
    },
  });

  await callTool("stage_advance:wave1->pivot", stage_advance as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    requested_next: "pivot",
    reason: "fixture runner: wave1->pivot",
  });

  const wave1Outputs = perspectiveIds.map((perspectiveId) => ({
    perspective_id: perspectiveId,
    output_md_path: waveOutputPaths.get(perspectiveId),
  }));

  const pivot = await callTool("pivot_decide", pivot_decide as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    wave1_outputs: wave1Outputs,
    wave1_validation_reports: waveValidationReports,
    reason: "fixture runner: pivot decision",
  });
  if (pivot.wave2_required !== false) {
    throw new Error(`pivot_decide expected wave2_required=false, got ${String(pivot.wave2_required)}`);
  }

  await callTool("stage_advance:pivot->citations", stage_advance as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    requested_next: "citations",
    reason: "fixture runner: pivot->citations",
  });

  const citationsDir = path.join(runRoot, "citations");
  const citationsPath = path.join(citationsDir, "citations.jsonl");
  const extractedUrlsPath = path.join(citationsDir, "extracted-urls.txt");
  await fs.cp(citationsFixturePath, citationsPath);
  await fs.writeFile(extractedUrlsPath, `${EXTRACTED_URLS.join("\n")}\n`, "utf8");

  const gateC = await callTool("gate_c_compute", gate_c_compute as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    reason: "fixture runner: gate C compute",
  });
  if (gateC.status !== "pass") {
    throw new Error(`gate_c_compute expected pass, got ${String(gateC.status)}`);
  }

  const gateCUpdate = gateC.update;
  const gateCInputsDigest = gateC.inputs_digest;
  if (!gateCUpdate || typeof gateCUpdate !== "object") {
    throw new Error("gate_c_compute returned missing update patch");
  }
  if (typeof gateCInputsDigest !== "string" || !gateCInputsDigest) {
    throw new Error("gate_c_compute returned missing inputs_digest");
  }

  await callTool("gates_write:C", gates_write as unknown as ToolWithExecute, {
    gates_path: gatesPath,
    update: gateCUpdate as Record<string, unknown>,
    inputs_digest: gateCInputsDigest,
    reason: "fixture runner: persist Gate C",
  });

  await callTool("stage_advance:citations->summaries", stage_advance as unknown as ToolWithExecute, {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    requested_next: "summaries",
    reason: "fixture runner: citations->summaries",
  });

  const postSummaries = await orchestrator_run_post_summaries({
    manifest_path: manifestPath,
    gates_path: gatesPath,
    reason: "fixture runner: summaries->finalize",
    max_ticks: 8,
    fixture_summaries_dir: summariesFixtureDir,
    fixture_draft_path: synthesisFixturePath,
    review_fixture_bundle_dir: reviewFixtureDir,
    tool_context: makeToolContext(),
  });

  if (!postSummaries.ok) {
    const details = JSON.stringify(postSummaries.error.details ?? {});
    throw new Error(
      `orchestrator_run_post_summaries failed: ${postSummaries.error.code} ${postSummaries.error.message} ${details}`,
    );
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const stageObj = (manifest.stage ?? {}) as Record<string, unknown>;
  const finalStage = String(stageObj.current ?? "");
  if (finalStage !== "finalize") {
    throw new Error(`Expected final stage finalize, got '${finalStage || "<empty>"}'`);
  }

  const keyArtifacts = {
    manifest_path: manifestPath,
    gates_path: gatesPath,
    perspectives_path: perspectivesPath,
    wave_review_path: waveReviewPath,
    pivot_path: path.join(runRoot, "pivot.json"),
    citations_path: citationsPath,
    extracted_urls_path: extractedUrlsPath,
    summary_pack_path: path.join(runRoot, "summaries", "summary-pack.json"),
    final_synthesis_path: path.join(runRoot, "synthesis", "final-synthesis.md"),
    gate_e_report_path: path.join(runRoot, "reports", "gate-e-status.json"),
  };

  console.log(`run_id: ${runId}`);
  console.log(`run_root: ${runRoot}`);
  console.log(`final_stage: ${finalStage}`);
  console.log("artifacts:");
  for (const [key, value] of Object.entries(keyArtifacts)) {
    console.log(`  ${key}: ${value}`);
  }
}

await main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
