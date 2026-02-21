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

  const toSummaries = await orchestrator_run_post_pivot({
    manifest_path: manifestPath,
    gates_path: gatesPath,
    reason: "test: post pivot to summaries",
    max_ticks: 3,
    tool_context: makeToolContext(),
  });
  expect(toSummaries.ok).toBe(true);
  if (!toSummaries.ok) throw new Error("expected summaries stage");

  await fs.copyFile(
    fixturePath("summaries", "phase05", "citations.jsonl"),
    path.join(runRoot, "citations", "citations.jsonl"),
  );

  return { manifestPath, gatesPath, runRoot };
}

describe("deep_research orchestrator bounded review loop (entity)", () => {
  test("runs one review->synthesis iteration then finalizes", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_review_loop_001";
        const { manifestPath, gatesPath } = await setupRunToSummaries(base, runId);

        const out = await orchestrator_run_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: review loop one iteration",
          max_ticks: 8,
          fixture_summaries_dir: fixturePath("summaries", "phase05", "summaries-pass"),
          fixture_draft_path: fixturePath("summaries", "phase05", "synthesis", "final-synthesis-pass.md"),
          drivers: {
            getReviewFixtureBundleDir: (iteration: number) => {
              if (iteration === 1) {
                return fixturePath("summaries", "phase05", "review-fixture", "changes");
              }
              return fixturePath("summaries", "phase05", "review-fixture", "pass");
            },
          },
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.end_stage).toBe("finalize");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        const history = Array.isArray(manifest.stage?.history)
          ? (manifest.stage.history as Array<Record<string, unknown>>)
          : [];
        const reviewToSynthesisCount = history.filter(
          (entry) => String(entry.from ?? "") === "review" && String(entry.to ?? "") === "synthesis",
        ).length;

        expect(reviewToSynthesisCount).toBe(1);
      });
    });
  });
});
