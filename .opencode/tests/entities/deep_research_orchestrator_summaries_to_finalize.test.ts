import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type OrchestratorLiveRunAgentInput,
  orchestrator_run_live,
  orchestrator_run_post_pivot,
  orchestrator_run_post_summaries,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdownNoGaps(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label} with deterministic evidence.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    "No critical gaps identified.",
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

async function setupRunToSummaries(base: string, runId: string): Promise<{
  manifestPath: string;
  gatesPath: string;
  runRoot: string;
}> {
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
        markdown: validMarkdownNoGaps(input.perspective_id),
      }),
    },
    tool_context: makeToolContext(),
  });
  expect(toPivot.ok).toBe(true);
  if (!toPivot.ok) throw new Error("expected pivot stage");
  expect(toPivot.end_stage).toBe("pivot");

  const toSummaries = await orchestrator_run_post_pivot({
    manifest_path: manifestPath,
    gates_path: gatesPath,
    reason: "test: post pivot to summaries",
    max_ticks: 3,
    tool_context: makeToolContext(),
  });
  expect(toSummaries.ok).toBe(true);
  if (!toSummaries.ok) throw new Error("expected summaries stage");
  expect(toSummaries.end_stage).toBe("summaries");

  await fs.copyFile(
    fixturePath("summaries", "phase05", "citations.jsonl"),
    path.join(runRoot, "citations", "citations.jsonl"),
  );

  return { manifestPath, gatesPath, runRoot };
}

describe("deep_research orchestrator summaries -> finalize (entity)", () => {
  test("deterministically drives summaries -> synthesis -> review -> finalize", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_summaries_finalize_001";
        const { manifestPath, gatesPath, runRoot } = await setupRunToSummaries(base, runId);

        const out = await orchestrator_run_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: post summaries finalize",
          max_ticks: 6,
          fixture_summaries_dir: fixturePath("summaries", "phase05", "summaries-pass"),
          fixture_draft_path: fixturePath("summaries", "phase05", "synthesis", "final-synthesis-pass.md"),
          review_fixture_bundle_dir: fixturePath("summaries", "phase05", "review-fixture", "pass"),
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.end_stage).toBe("finalize");

        await expect(fs.stat(path.join(runRoot, "summaries", "summary-pack.json"))).resolves.toBeDefined();
        await expect(fs.stat(path.join(runRoot, "synthesis", "final-synthesis.md"))).resolves.toBeDefined();
        await expect(fs.stat(path.join(runRoot, "reports", "gate-e-status.json"))).resolves.toBeDefined();

        const gatesDoc = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(String(gatesDoc.gates.D.status)).toBe("pass");
        expect(typeof gatesDoc.gates.D.checked_at).toBe("string");
        expect(String(gatesDoc.gates.D.checked_at).length).toBeGreaterThan(0);

        expect(String(gatesDoc.gates.E.status)).toBe("pass");
        expect(typeof gatesDoc.gates.E.checked_at).toBe("string");
        expect(String(gatesDoc.gates.E.checked_at).length).toBeGreaterThan(0);
      });
    });
  });
});
