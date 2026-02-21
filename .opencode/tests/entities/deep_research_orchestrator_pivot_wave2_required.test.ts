import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  type OrchestratorLiveRunAgentInput,
  orchestrator_run_live,
  orchestrator_run_post_pivot,
  orchestrator_tick_post_pivot,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
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
    "- https://www.iana.org/domains/reserved",
    "",
    "## Gaps",
    gapsSection,
    "",
  ].join("\n");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

      // 1) pivot -> wave2
      const toWave2 = await orchestrator_tick_post_pivot({
        manifest_path: manifestPath,
        gates_path: gatesPath,
        reason: "test: pivot -> wave2",
        tool_context: makeToolContext(),
      });
      expect(toWave2.ok).toBe(true);
      if (!toWave2.ok) throw new Error("expected pivot->wave2 success");
      expect(toWave2.from).toBe("pivot");
      expect(toWave2.to).toBe("wave2");

      // 2) wave2 stage writes plan + requires external outputs
      const wave2Setup = await orchestrator_tick_post_pivot({
        manifest_path: manifestPath,
        gates_path: gatesPath,
        reason: "test: wave2 setup",
        tool_context: makeToolContext(),
      });
      expect(wave2Setup.ok).toBe(false);
      if (wave2Setup.ok) throw new Error("expected wave2 missing artifacts");
      expect(wave2Setup.error.code).toBe("MISSING_ARTIFACT");

      const manifestWave2 = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      expect(manifestWave2.stage.current).toBe("wave2");

      const stageHistoryWave2 = Array.isArray(manifestWave2.stage?.history)
        ? (manifestWave2.stage.history as Array<Record<string, unknown>>)
        : [];
      const transitionsWave2 = stageHistoryWave2.map((entry) => `${String(entry.from ?? "")}->${String(entry.to ?? "")}`);
      expect(transitionsWave2).toContain("pivot->wave2");

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
        const perspectiveId = String(entry.perspective_id ?? "");
        const promptMd = String(entry.prompt_md ?? "");
        const promptDigest = `sha256:${sha256Hex(promptMd)}`;
        const outputMd = String(entry.output_md ?? "");
        expect(outputMd.length).toBeGreaterThan(0);
        const outputPath = path.join(runRoot, outputMd);
        const metaPath = path.join(path.dirname(outputPath), `${perspectiveId}.meta.json`);

        const outputMarkdown = [
          "## Findings",
          `Wave 2 follow-up for ${perspectiveId}.`,
          "",
          "## Sources",
          "- https://www.iana.org/domains/reserved",
          "",
          "## Gaps",
          "No additional unresolved gaps identified.",
          "",
        ].join("\n");

        await fs.writeFile(outputPath, `${outputMarkdown}\n`, "utf8");
        await fs.writeFile(
          metaPath,
          `${JSON.stringify(
            {
              schema_version: "wave-output-meta.v1",
              prompt_digest: promptDigest,
              agent_run_id: `fixture-${perspectiveId}`,
              ingested_at: new Date().toISOString(),
              source_input_path: "fixture",
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }

      // 3) wave2 -> citations -> summaries
      const postPivot = await orchestrator_run_post_pivot({
        manifest_path: manifestPath,
        gates_path: gatesPath,
        reason: "test: post pivot wave2 route",
        max_ticks: 8,
        tool_context: makeToolContext(),
      });

      expect(postPivot.ok).toBe(true);
      if (!postPivot.ok) throw new Error("expected post-pivot success");
      expect(postPivot.start_stage).toBe("wave2");
      expect(postPivot.end_stage).toBe("summaries");

      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      expect(manifest.stage.current).toBe("summaries");

      const stageHistory = Array.isArray(manifest.stage?.history)
        ? (manifest.stage.history as Array<Record<string, unknown>>)
        : [];
      const transitions = stageHistory.map((entry) => `${String(entry.from ?? "")}->${String(entry.to ?? "")}`);
      expect(transitions).toContain("wave2->citations");
      expect(transitions).toContain("citations->summaries");

      const citationsPath = path.join(runRoot, "citations", "citations.jsonl");
      await expect(fs.stat(citationsPath)).resolves.toBeDefined();

      const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
      expect(gates.gates.C.status).toBe("pass");
    });
  });
});
