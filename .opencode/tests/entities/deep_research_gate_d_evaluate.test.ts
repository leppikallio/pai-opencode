import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gate_d_evaluate, run_init, summary_pack_build } from "../../tools/deep_research.ts";
import { asRecord, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

function perspectives(runId: string) {
  return {
    schema_version: "perspectives.v1",
    run_id: runId,
    created_at: "2026-02-14T00:00:00Z",
    perspectives: [
      {
        id: "p1",
        title: "P1",
        track: "standard",
        agent_type: "ClaudeResearcher",
        prompt_contract: { max_words: 300, max_sources: 10, tool_budget: { search_calls: 1 }, must_include_sections: ["Findings", "Sources", "Gaps"] },
      },
      {
        id: "p2",
        title: "P2",
        track: "standard",
        agent_type: "ClaudeResearcher",
        prompt_contract: { max_words: 300, max_sources: 10, tool_budget: { search_calls: 1 }, must_include_sections: ["Findings", "Sources", "Gaps"] },
      },
    ],
  };
}

async function seedSummaryPack(base: string, runId: string) {
  const initRaw = (await run_init.execute(
    { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = String(init.manifest_path);
  const runRoot = path.dirname(manifestPath);

  await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(perspectives(runId), null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(runRoot, "citations", "citations.jsonl"),
    `${[
      JSON.stringify({ cid: "cid_alpha", status: "valid", normalized_url: "https://a.test" }),
      JSON.stringify({ cid: "cid_beta", status: "paywalled", normalized_url: "https://b.test" }),
    ].join("\n")}\n`,
    "utf8",
  );

  const fixtureDir = path.join(base, "fixture-summaries");
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(path.join(fixtureDir, "p1.md"), "## Findings\nA [@cid_alpha]\n", "utf8");
  await fs.writeFile(path.join(fixtureDir, "p2.md"), "## Findings\nB [@cid_beta]\n", "utf8");

  const buildRaw = (await summary_pack_build.execute(
    {
      manifest_path: manifestPath,
      mode: "fixture",
      fixture_summaries_dir: fixtureDir,
      reason: "test: seed summary pack",
    },
    makeToolContext(),
  )) as string;
  const build = parseToolJson(buildRaw);
  expect(build.ok).toBe(true);

  return { manifestPath, summaryPackPath: String(build.summary_pack_path) };
}

describe("deep_research_gate_d_evaluate (entity)", () => {
  test("returns pass when thresholds meet manifest limits", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath } = await seedSummaryPack(base, "dr_test_p05_gate_d_001");

        const outRaw = (await gate_d_evaluate.execute(
          { manifest_path: manifestPath, reason: "test: gate d pass" },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        const metrics = asRecord(out.metrics, "metrics");
        expect(out.ok).toBe(true);
        expect(String(out.gate_id)).toBe("D");
        expect(String(out.status)).toBe("pass");
        expect(Number(metrics.summary_count_ratio)).toBe(1);
      });
    });
  });

  test("fails when summary_count_ratio drops below 0.90", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath, summaryPackPath } = await seedSummaryPack(base, "dr_test_p05_gate_d_002");
        const pack = JSON.parse(await fs.readFile(summaryPackPath, "utf8"));
        pack.summaries = [pack.summaries[0]];
        await fs.writeFile(summaryPackPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");

        const outRaw = (await gate_d_evaluate.execute(
          { manifest_path: manifestPath, reason: "test: gate d fail ratio" },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        const metrics = asRecord(out.metrics, "metrics");
        expect(out.ok).toBe(true);
        expect(String(out.status)).toBe("fail");
        expect(Number(metrics.summary_count_ratio)).toBe(0.5);
      });
    });
  });
});
