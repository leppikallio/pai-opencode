import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  gates_write,
  type OrchestratorLiveRunAgentInput,
  orchestrator_tick_live,
  run_init,
  stage_advance,
} from "../../tools/deep_research.ts";
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

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<string> {
  const fixture = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;

  const target = path.join(runRoot, "perspectives.json");
  await fs.writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return target;
}

describe("deep_research_orchestrator_tick_live (entity)", () => {
  test("drives wave1 -> pivot through injected runAgent boundary", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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
        expect(out.wave_outputs_count).toBe(1);

        expect(driverCalls.length).toBe(1);
        expect(driverCalls[0]).toMatchObject({
          run_id: runId,
          stage: "wave1",
          perspective_id: "p1",
          agent_type: "ClaudeResearcher",
          output_md: "wave-1/p1.md",
        });

        const waveMarkdown = await fs.readFile(path.join(runRoot, "wave-1", "p1.md"), "utf8");
        expect(waveMarkdown).toContain("## Findings");

        const waveReview = JSON.parse(await fs.readFile(path.join(runRoot, "wave-review.json"), "utf8"));
        expect(waveReview.ok).toBe(true);
        expect(waveReview.pass).toBe(true);
        expect(waveReview.validated).toBe(1);
        expect(waveReview.failed).toBe(0);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.B.status).toBe("pass");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("pivot");
      });
    });
  });

  test("can advance from init directly to pivot in one tick", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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

        await fs.mkdir(path.join(runRoot, "wave-1"), { recursive: true });
        await fs.writeFile(
          path.join(runRoot, "wave-1", "wave1-plan.json"),
          `${JSON.stringify(
            {
              schema_version: "wave1_plan.v1",
              run_id: runId,
              generated_at: "2026-02-16T10:00:00.000Z",
              inputs_digest: "digest",
              entries: [
                {
                  perspective_id: "p1",
                  agent_type: "ClaudeResearcher",
                  output_md: "wave-1/p1.md",
                  prompt_md: "Prompt",
                },
              ],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await fs.writeFile(path.join(runRoot, "wave-1", "p1.md"), validMarkdown("p1"), "utf8");
        await fs.writeFile(
          path.join(runRoot, "wave-review.json"),
          `${JSON.stringify({ ok: true, pass: true, validated: 1, failed: 0, total: 1 }, null, 2)}\n`,
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
      });
    });
  });

  test("passes expected_revision to gates_write (mismatch path proves optimistic lock wiring)", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_live_005";

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
});
