import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type OrchestratorLiveRunAgentInput,
  orchestrator_run_live,
  orchestrator_run_post_pivot,
  run_init,
} from "../../tools/deep_research.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdown(label: string): string {
  const gapsSection = label === "p1"
    ? "- (P0) Missing primary source verification for key claim #verification"
    : "No critical gaps identified.";

  return [
    "## Findings",
    `Primary finding for ${label} with deterministic evidence.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    gapsSection,
    "",
  ].join("\n");
}

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<void> {
  const fixture = fixturePath("summaries", "phase05", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;
  await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

describe("deep_research orchestrator pivot wave2 routing (entity)", () => {
  test("routes pivot -> wave2, executes wave2 plan, then proceeds to citations/summaries", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_pivot_wave2_required_001";

        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        await writePerspectivesForRun(runRoot, runId);

        const toPivot = await orchestrator_run_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: run live to pivot",
          max_ticks: 3,
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({
              markdown: validMarkdown(input.perspective_id),
            }),
          },
          tool_context: makeToolContext(),
        });
        expect(toPivot.ok).toBe(true);
        if (!toPivot.ok) throw new Error("expected pivot stage");
        expect(toPivot.end_stage).toBe("pivot");

        const postPivot = await orchestrator_run_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: post pivot wave2 route",
          max_ticks: 5,
          tool_context: makeToolContext(),
        });

        expect(postPivot.ok).toBe(true);
        if (!postPivot.ok) throw new Error("expected post-pivot success");
        expect(postPivot.start_stage).toBe("pivot");
        expect(postPivot.end_stage).toBe("summaries");
        expect(postPivot.ticks_executed).toBeGreaterThanOrEqual(3);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("summaries");

        const stageHistory = Array.isArray(manifest.stage?.history)
          ? (manifest.stage.history as Array<Record<string, unknown>>)
          : [];
        const transitions = stageHistory.map((entry) => `${String(entry.from ?? "")}->${String(entry.to ?? "")}`);
        expect(transitions).toContain("pivot->wave2");
        expect(transitions).toContain("wave2->citations");
        expect(transitions).toContain("citations->summaries");

        const pivot = JSON.parse(await fs.readFile(path.join(runRoot, "pivot.json"), "utf8"));
        expect(pivot.decision?.wave2_required).toBe(true);
        const wave2GapIds = Array.isArray(pivot.decision?.wave2_gap_ids)
          ? (pivot.decision.wave2_gap_ids as string[])
          : [];
        expect(wave2GapIds.length).toBeGreaterThan(0);

        const wave2PlanPath = path.join(runRoot, "wave-2", "wave2-plan.json");
        const wave2Plan = JSON.parse(await fs.readFile(wave2PlanPath, "utf8"));
        expect(wave2Plan.schema_version).toBe("wave2_plan.v1");
        expect(Array.isArray(wave2Plan.entries)).toBe(true);
        expect(wave2Plan.entries.map((entry: any) => entry.gap_id)).toEqual(
          [...wave2GapIds].sort((a, b) => a.localeCompare(b)),
        );

        for (const entry of wave2Plan.entries as Array<Record<string, unknown>>) {
          const outputMd = String(entry.output_md ?? "");
          expect(outputMd.length).toBeGreaterThan(0);
          const outputPath = path.join(runRoot, outputMd);
          const outputMarkdown = await fs.readFile(outputPath, "utf8");
          expect(outputMarkdown).toContain("## Findings");
          expect(outputMarkdown).toContain("## Sources");
          expect(outputMarkdown).toContain("## Gaps");
        }

        const citationsPath = path.join(runRoot, "citations", "citations.jsonl");
        await expect(fs.stat(citationsPath)).resolves.toBeDefined();

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.C.status).toBe("pass");
      });
    });
  });
});
