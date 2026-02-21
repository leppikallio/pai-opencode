import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  gates_write,
  type OrchestratorLiveRunAgentInput,
  orchestrator_tick_live,
  run_init,
  stage_advance,
  wave1_plan,
} from "../../tools/deep_research_cli.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdown(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label}.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    "- (P1) Need deeper evidence",
    "",
  ].join("\n");
}

function invalidMarkdown(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label}.`,
    "",
    "## Sources",
    "not-a-bullet-source-line",
    "",
  ].join("\n");
}

function promptDigest(promptMd: string): string {
  return `sha256:${createHash("sha256").update(promptMd, "utf8").digest("hex")}`;
}

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<string> {
  const fixture = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;

  const target = path.join(runRoot, "perspectives.json");
  await fs.writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return target;
}

async function seedWave1OutputsWithMatchingPromptDigests(args: {
  manifestPath: string;
  runRoot: string;
  markdownForPerspective: (perspectiveId: string) => string;
}): Promise<void> {
  const planRaw = (await (wave1_plan as any).execute(
    {
      manifest_path: args.manifestPath,
      reason: "test: preseed wave1 plan",
    },
    makeToolContext(),
  )) as string;
  const planResult = parseToolJson(planRaw);
  if (!planResult.ok) {
    throw new Error(`failed to seed wave1 plan: ${JSON.stringify(planResult)}`);
  }

  const planPath = path.join(args.runRoot, "wave-1", "wave1-plan.json");
  const planDoc = JSON.parse(await fs.readFile(planPath, "utf8")) as Record<string, unknown>;
  const entries: Array<Record<string, unknown>> = Array.isArray(planDoc.entries)
    ? (planDoc.entries as Array<Record<string, unknown>>)
    : [];

  for (const entry of entries) {
    const perspectiveId = String(entry.perspective_id ?? "").trim();
    const outputMd = String(entry.output_md ?? "").trim();
    const promptMd = String(entry.prompt_md ?? "");
    if (!perspectiveId || !outputMd || !promptMd) {
      throw new Error(`invalid plan entry for seeding: ${JSON.stringify(entry)}`);
    }

    const outputPath = path.join(args.runRoot, outputMd);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, args.markdownForPerspective(perspectiveId), "utf8");

    const sidecarPath = outputMd.endsWith(".md")
      ? path.join(args.runRoot, `${outputMd.slice(0, -3)}.meta.json`)
      : path.join(args.runRoot, `${outputMd}.meta.json`);
    await fs.writeFile(
      sidecarPath,
      `${JSON.stringify(
        {
          schema_version: "wave-output-meta.v1",
          prompt_digest: promptDigest(promptMd),
          agent_run_id: `seed:${perspectiveId}`,
          ingested_at: "2026-02-16T10:00:00.000Z",
          source_input_path: outputPath,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

describe("deep_research_orchestrator_tick_live (entity)", () => {
  test("drives wave1 -> pivot through injected runAgent boundary", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_001";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const driverCalls: Array<Record<string, unknown>> = [];

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator live tick",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              driverCalls.push(input as unknown as Record<string, unknown>);
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;

        expect(out.from).toBe("wave1");
        expect(out.to).toBe("pivot");
        expect(typeof out.decision_inputs_digest).toBe("string");
        expect(out.wave_outputs_count).toBe(3);

        expect(driverCalls.length).toBe(3);
        expect(driverCalls.map((call) => call.perspective_id)).toEqual(["p3", "p1", "p2"]);
        expect(driverCalls[0]).toMatchObject({
          run_id: runId,
          stage: "wave1",
          perspective_id: "p3",
          agent_type: "GrokResearcher",
          output_md: "wave-1/p3.md",
        });

        const p1Markdown = await fs.readFile(path.join(runRoot, "wave-1", "p1.md"), "utf8");
        const p2Markdown = await fs.readFile(path.join(runRoot, "wave-1", "p2.md"), "utf8");
        const p3Markdown = await fs.readFile(path.join(runRoot, "wave-1", "p3.md"), "utf8");
        expect(p1Markdown).toContain("## Findings");
        expect(p2Markdown).toContain("## Findings");
        expect(p3Markdown).toContain("## Findings");

        const p1Meta = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "p1.meta.json"), "utf8"));
        const p2Meta = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "p2.meta.json"), "utf8"));
        const p3Meta = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "p3.meta.json"), "utf8"));
        for (const [perspectiveId, sidecar, outputPath] of [
          ["p1", p1Meta, path.join(runRoot, "wave-1", "p1.md")],
          ["p2", p2Meta, path.join(runRoot, "wave-1", "p2.md")],
          ["p3", p3Meta, path.join(runRoot, "wave-1", "p3.md")],
        ]) {
          expect(sidecar.schema_version).toBe("wave-output-meta.v1");
          expect(typeof sidecar.prompt_digest).toBe("string");
          expect(sidecar.prompt_digest.startsWith("sha256:")).toBe(true);
          expect(sidecar.agent_run_id).toBe(`live:${perspectiveId}:${sidecar.prompt_digest}:r0`);
          expect(typeof sidecar.ingested_at).toBe("string");
          expect(sidecar.source_input_path).toBe(outputPath);
        }

        const waveReview = JSON.parse(await fs.readFile(path.join(runRoot, "wave-review.json"), "utf8"));
        expect(waveReview.ok).toBe(true);
        expect(waveReview.pass).toBe(true);
        expect(waveReview.validated).toBe(3);
        expect(waveReview.failed).toBe(0);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.B.status).toBe("pass");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("pivot");
        expect(typeof manifest.stage.last_progress_at).toBe("string");
        expect(manifest.revision).toBeGreaterThan(3);
      });
    });
  });

  test("can advance from init directly to pivot in one tick", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_002";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator live from init",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({ markdown: validMarkdown(input.perspective_id) }),
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;

        expect(out.from).toBe("init");
        expect(out.to).toBe("pivot");
        expect(typeof out.decision_inputs_digest).toBe("string");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("pivot");
      });
    });
  });

  test("rejects traversal in manifest wave_review_report_file path", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_003";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.artifacts.paths.wave_review_report_file = "../escape.json";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: traversal reject",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({ markdown: validMarkdown(input.perspective_id) }),
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("PATH_TRAVERSAL");
      });
    });
  });

  test("rejects symlinked wave1_dir that realpath-escapes run root", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_003b";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const outsideDir = path.join(base, "outside-wave1");
        await fs.mkdir(outsideDir, { recursive: true });
        await fs.rm(path.join(runRoot, "wave-1"), { recursive: true, force: true });
        await fs.symlink(outsideDir, path.join(runRoot, "wave-1"), "dir");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: symlink containment",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({ markdown: validMarkdown(input.perspective_id) }),
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("PATH_TRAVERSAL");
      });
    });
  });

  test("idempotent rerun skips runAgent/ingest/review/gates_write and still advances", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_004";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const planRaw = (await (wave1_plan as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: preseed wave1 plan",
          },
          makeToolContext(),
        )) as string;
        const planResult = parseToolJson(planRaw);
        expect(planResult.ok).toBe(true);

        const planDoc = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "wave1-plan.json"), "utf8")) as {
          entries?: Array<Record<string, unknown>>;
        };
        const promptByPerspective = new Map<string, string>();
        for (const entry of planDoc.entries ?? []) {
          const perspectiveId = String(entry.perspective_id ?? "").trim();
          const promptMd = String(entry.prompt_md ?? "");
          if (perspectiveId && promptMd.trim()) promptByPerspective.set(perspectiveId, promptMd);
        }
        const p1Prompt = promptByPerspective.get("p1");
        const p2Prompt = promptByPerspective.get("p2");
        const p3Prompt = promptByPerspective.get("p3");
        if (!p1Prompt || !p2Prompt || !p3Prompt) {
          throw new Error("expected wave1 plan prompts for p1/p2/p3");
        }

        await fs.writeFile(path.join(runRoot, "wave-1", "p1.md"), validMarkdown("p1"), "utf8");
        await fs.writeFile(path.join(runRoot, "wave-1", "p2.md"), validMarkdown("p2"), "utf8");
        await fs.writeFile(path.join(runRoot, "wave-1", "p3.md"), validMarkdown("p3"), "utf8");
        await fs.writeFile(
          path.join(runRoot, "wave-1", "p1.meta.json"),
          `${JSON.stringify(
            {
              schema_version: "wave-output-meta.v1",
              prompt_digest: promptDigest(p1Prompt),
              agent_run_id: "agent-run-p1-seeded",
              ingested_at: "2026-02-16T10:00:00.000Z",
              source_input_path: path.join(runRoot, "wave-1", "p1.md"),
              started_at: "2026-02-16T09:59:00.000Z",
              finished_at: "2026-02-16T10:00:00.000Z",
              model: "seed-model",
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(runRoot, "wave-1", "p2.meta.json"),
          `${JSON.stringify(
            {
              schema_version: "wave-output-meta.v1",
              prompt_digest: promptDigest(p2Prompt),
              agent_run_id: "agent-run-p2-seeded",
              ingested_at: "2026-02-16T10:00:00.000Z",
              source_input_path: path.join(runRoot, "wave-1", "p2.md"),
              started_at: "2026-02-16T09:59:00.000Z",
              finished_at: "2026-02-16T10:00:00.000Z",
              model: "seed-model",
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(runRoot, "wave-1", "p3.meta.json"),
          `${JSON.stringify(
            {
              schema_version: "wave-output-meta.v1",
              prompt_digest: promptDigest(p3Prompt),
              agent_run_id: "agent-run-p3-seeded",
              ingested_at: "2026-02-16T10:00:00.000Z",
              source_input_path: path.join(runRoot, "wave-1", "p3.md"),
              started_at: "2026-02-16T09:59:00.000Z",
              finished_at: "2026-02-16T10:00:00.000Z",
              model: "seed-model",
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(runRoot, "wave-review.json"),
          `${JSON.stringify(
            {
              ok: true,
              pass: true,
              validated: 3,
              failed: 0,
              results: [
                {
                  perspective_id: "p1",
                  markdown_path: path.join(runRoot, "wave-1", "p1.md"),
                  pass: true,
                  metrics: { words: 20, sources: 1, missing_sections: [] },
                  failure: null,
                },
                {
                  perspective_id: "p2",
                  markdown_path: path.join(runRoot, "wave-1", "p2.md"),
                  pass: true,
                  metrics: { words: 20, sources: 1, missing_sections: [] },
                  failure: null,
                },
                {
                  perspective_id: "p3",
                  markdown_path: path.join(runRoot, "wave-1", "p3.md"),
                  pass: true,
                  metrics: { words: 20, sources: 1, missing_sections: [] },
                  failure: null,
                },
              ],
              retry_directives: [],
              report: {
                failures_sample: [],
                failures_omitted: 0,
                notes: "ok",
              },
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        gates.gates.B.status = "pass";
        gates.gates.B.checked_at = "2026-02-16T10:00:00.000Z";
        await fs.writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: idempotent rerun",
          drivers: {
            runAgent: async () => {
              throw new Error("should not run");
            },
          },
          wave1_plan_tool: {
            execute: async () => {
              throw new Error("should not call wave1_plan when plan exists");
            },
          } as any,
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        if (!out.ok) {
          throw new Error(`unexpected failure: ${JSON.stringify(out.error, null, 2)}`);
        }
        expect(out.ok).toBe(true);
        expect(out.from).toBe("wave1");
        expect(out.to).toBe("pivot");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("pivot");

        const preservedMeta = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "p1.meta.json"), "utf8"));
        expect(preservedMeta.schema_version).toBe("wave-output-meta.v1");
        expect(preservedMeta.prompt_digest).toBe(promptDigest(p1Prompt));
        expect(preservedMeta.agent_run_id).toBe("agent-run-p1-seeded");
        expect(preservedMeta.ingested_at).toBe("2026-02-16T10:00:00.000Z");
        expect(preservedMeta.source_input_path).toBe(path.join(runRoot, "wave-1", "p1.md"));
        expect(preservedMeta.started_at).toBe("2026-02-16T09:59:00.000Z");
        expect(preservedMeta.finished_at).toBe("2026-02-16T10:00:00.000Z");
        expect(preservedMeta.model).toBe("seed-model");
      });
    });
  });

  test("reruns only perspective whose prompt digest no longer matches sidecar", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_prompt_digest_009";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const firstDriverCalls: Array<Record<string, unknown>> = [];
        const firstTick = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: prompt digest first tick",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              firstDriverCalls.push(input as unknown as Record<string, unknown>);
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(firstTick.ok).toBe(true);
        if (!firstTick.ok) return;
        expect(firstDriverCalls.length).toBe(3);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.stage.current = "wave1";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const planPath = path.join(runRoot, "wave-1", "wave1-plan.json");
        const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
        const entries: Array<Record<string, unknown>> = Array.isArray(plan.entries)
          ? (plan.entries as Array<Record<string, unknown>>)
          : [];
        const p2Entry = entries.find((entry) => entry.perspective_id === "p2");
        if (!p2Entry || typeof p2Entry.prompt_md !== "string") {
          throw new Error("expected p2 entry with prompt_md in wave1 plan");
        }
        const mutatedPrompt = `${p2Entry.prompt_md}\n- prompt changed for rerun`;
        p2Entry.prompt_md = mutatedPrompt;
        await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

        const secondDriverCalls: Array<Record<string, unknown>> = [];
        const secondTick = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: prompt digest second tick",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              secondDriverCalls.push(input as unknown as Record<string, unknown>);
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(secondTick.ok).toBe(true);
        if (!secondTick.ok) return;
        expect(secondDriverCalls.map((call) => call.perspective_id)).toEqual(["p2"]);
        expect(secondDriverCalls[0].prompt_md).toBe(mutatedPrompt);

        const p2Meta = JSON.parse(await fs.readFile(path.join(runRoot, "wave-1", "p2.meta.json"), "utf8"));
        expect(p2Meta.prompt_digest).toBe(promptDigest(mutatedPrompt));
      });
    });
  });

  test("fails fast with WAVE1_PLAN_STALE when perspectives mutate after wave1 plan creation", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_wave1_plan_stale_010";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const planRaw = (await (wave1_plan as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: preseed wave1 plan",
          },
          makeToolContext(),
        )) as string;
        const planResult = parseToolJson(planRaw);
        expect(planResult.ok).toBe(true);

        const planPath = path.join(runRoot, "wave-1", "wave1-plan.json");
        const planDoc = JSON.parse(await fs.readFile(planPath, "utf8")) as Record<string, unknown>;
        const planPerspectivesDigest = String(planDoc.perspectives_digest ?? "");
        expect(planPerspectivesDigest.startsWith("sha256:")).toBe(true);

        const perspectivesDoc = JSON.parse(await fs.readFile(perspectivesPath, "utf8")) as Record<string, unknown>;
        const perspectives = Array.isArray(perspectivesDoc.perspectives)
          ? (perspectivesDoc.perspectives as Array<Record<string, unknown>>)
          : [];
        expect(perspectives.length).toBeGreaterThan(0);
        // Add an extra field to change the digest without breaking wave1-plan prompt alignment.
        perspectives[0].notes = "mutated after plan creation";
        await fs.writeFile(perspectivesPath, `${JSON.stringify(perspectivesDoc, null, 2)}\n`, "utf8");

        const { sha256DigestForJson } = await import("../../tools/deep_research_cli/wave_tools_shared");
        const expectedDigest = sha256DigestForJson(perspectivesDoc);
        expect(expectedDigest).not.toBe(planPerspectivesDigest);

        let runAgentCalls = 0;

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: wave1 plan stale",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              runAgentCalls += 1;
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("WAVE1_PLAN_STALE");
        expect(runAgentCalls).toBe(0);
        expect(String(out.error.details.expected_digest ?? "")).toBe(expectedDigest);
        expect(String(out.error.details.actual_digest ?? "")).toBe(planPerspectivesDigest);
        expect(JSON.stringify(out.error.details)).toContain("expected_digest");
        expect(JSON.stringify(out.error.details)).toContain("actual_digest");
      });
    });
  });

  test("fails Gate A when scope.json is missing and records typed reason in gates", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_gate_a_missing_scope_008";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        const planRaw = (await (wave1_plan as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: preseed wave1 plan",
          },
          makeToolContext(),
        )) as string;
        const plan = parseToolJson(planRaw);
        expect(plan.ok).toBe(true);

        await fs.rm(path.join(runRoot, "operator", "scope.json"), { force: true });

        let runAgentCalls = 0;
        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: gate A missing scope",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              runAgentCalls += 1;
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("GATE_A_FAILED");
        expect(out.error.details.reason).toBe("SCOPE_NOT_FOUND");
        expect(runAgentCalls).toBe(0);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.A.status).toBe("fail");
        expect(gates.gates.A.warnings).toContain("SCOPE_NOT_FOUND");
      });
    });
  });

  test("passes expected_revision to gates_write (mismatch path proves optimistic lock wiring)", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_optlock_005";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const seenExpectedRevisions: number[] = [];
        const gatesWriteProxy = {
          execute: async (payload: Record<string, unknown>, toolContext: unknown) => {
            const expectedRevision = Number(payload.expected_revision ?? Number.NaN);
            if (Number.isFinite(expectedRevision)) seenExpectedRevisions.push(expectedRevision);

            return (gates_write as any).execute(
              {
                ...payload,
                expected_revision: Number(payload.expected_revision ?? 0) + 1,
              },
              toolContext,
            );
          },
        } as any;

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: optimistic lock mismatch",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({ markdown: validMarkdown(input.perspective_id) }),
          },
          gates_write_tool: gatesWriteProxy,
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(seenExpectedRevisions.length).toBe(1);
        expect(seenExpectedRevisions[0]).toBeGreaterThan(0);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("REVISION_MISMATCH");
      });
    });
  });

  test("records retry directives and bounded retry state when wave review fails", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_retry_005";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        await seedWave1OutputsWithMatchingPromptDigests({
          manifestPath,
          runRoot,
          markdownForPerspective: (perspectiveId) => invalidMarkdown(perspectiveId),
        });

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: retry directives",
          drivers: {
            runAgent: async () => {
              throw new Error("runAgent should be skipped when outputs already exist");
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("RETRY_REQUIRED");

        const retryPath = String(out.error.details.retry_directives_path ?? "");
        expect(retryPath.endsWith(path.join("retry", "retry-directives.json"))).toBe(true);

        const retryArtifact = JSON.parse(await fs.readFile(retryPath, "utf8"));
        expect(retryArtifact.schema_version).toBe("wave1.retry_directives.v1");
        expect(Array.isArray(retryArtifact.retry_directives)).toBe(true);
        expect(retryArtifact.retry_directives.length).toBeGreaterThan(0);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.metrics.retry_counts.B).toBe(1);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.B.status).toBe("fail");
      });
    });
  });

  test("consumes retry directives and reruns targeted outputs even when files already exist", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_retry_consume_007";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        await seedWave1OutputsWithMatchingPromptDigests({
          manifestPath,
          runRoot,
          markdownForPerspective: (perspectiveId) => invalidMarkdown(perspectiveId),
        });

        const first = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: retry consume first tick",
          drivers: {
            runAgent: async () => {
              throw new Error("runAgent should be skipped when outputs already exist (initial) ");
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(first.ok).toBe(false);
        if (first.ok) return;
        expect(first.error.code).toBe("RETRY_REQUIRED");
        const retryPath = String(first.error.details.retry_directives_path ?? "");
        expect(retryPath.endsWith(path.join("retry", "retry-directives.json"))).toBe(true);

        const driverCalls: Array<Record<string, unknown>> = [];
        const second = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: retry consume second tick",
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => {
              driverCalls.push(input as unknown as Record<string, unknown>);
              return { markdown: validMarkdown(input.perspective_id) };
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.from).toBe("wave1");
        expect(second.to).toBe("pivot");
        expect(driverCalls.length).toBe(3);

        const retryArtifact = JSON.parse(await fs.readFile(retryPath, "utf8"));
        expect(typeof retryArtifact.consumed_at).toBe("string");
        expect(String(retryArtifact.consumed_at).length).toBeGreaterThan(10);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("pivot");
      });
    });
  });

  test("returns typed cap exhaustion when retry cap for gate B is reached", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_006";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const toWave1Raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: init -> wave1",
            requested_next: "wave1",
          },
          makeToolContext(),
        )) as string;
        const toWave1 = parseToolJson(toWave1Raw);
        expect(toWave1.ok).toBe(true);

        await seedWave1OutputsWithMatchingPromptDigests({
          manifestPath,
          runRoot,
          markdownForPerspective: (perspectiveId) => invalidMarkdown(perspectiveId),
        });

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.metrics = {
          ...(manifest.metrics ?? {}),
          retry_counts: {
            ...(manifest.metrics?.retry_counts ?? {}),
            B: 2,
          },
        };
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: retry cap exhaustion",
          drivers: {
            runAgent: async () => {
              throw new Error("runAgent should be skipped when outputs already exist");
            },
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("RETRY_CAP_EXHAUSTED");
        expect(out.error.details.max_retries).toBe(2);

        const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(updatedManifest.metrics.retry_counts.B).toBe(2);
      });
    });
  });
});
