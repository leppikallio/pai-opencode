import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_post_summaries,
  run_init,
} from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function seedSummariesStage(base: string, runId: string): Promise<{
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
  if (!init.ok) {
    throw new Error("run_init failed");
  }

  const manifestPath = String((init as any).manifest_path);
  const gatesPath = String((init as any).gates_path);
  const runRoot = path.dirname(manifestPath);
  const sourceDir = path.join(runRoot, "agent-output");
  await fs.mkdir(sourceDir, { recursive: true });

  await fs.writeFile(
    path.join(runRoot, "perspectives.json"),
    `${JSON.stringify({
      schema_version: "perspectives.v1",
      run_id: runId,
      created_at: "2026-02-18T00:00:00Z",
      perspectives: [
        {
          id: "p1",
          title: "Perspective One",
          track: "standard",
          agent_type: "ClaudeResearcher",
          source_artifact: "agent-output/p1.md",
          prompt_contract: {
            max_words: 300,
            max_sources: 10,
            tool_budget: { search_calls: 1 },
            must_include_sections: ["Findings", "Sources", "Gaps"],
          },
        },
        {
          id: "p2",
          title: "Perspective Two",
          track: "independent",
          agent_type: "GeminiResearcher",
          source_artifact: "agent-output/p2.md",
          prompt_contract: {
            max_words: 300,
            max_sources: 10,
            tool_budget: { search_calls: 1 },
            must_include_sections: ["Findings", "Sources", "Gaps"],
          },
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(path.join(sourceDir, "p1.md"), "## Findings\nSignal A [@cid_a]\n", "utf8");
  await fs.writeFile(path.join(sourceDir, "p2.md"), "## Findings\nSignal B [@cid_b]\n", "utf8");
  await fs.writeFile(
    path.join(runRoot, "citations", "citations.jsonl"),
    `${[
      JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" }),
      JSON.stringify({ cid: "cid_b", status: "paywalled", normalized_url: "https://b.test" }),
    ].join("\n")}\n`,
    "utf8",
  );

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.stage = {
    ...(manifest.stage ?? {}),
    current: "summaries",
    started_at: "2026-02-18T00:00:00Z",
    history: [],
  };
  manifest.status = "running";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifestPath, gatesPath, runRoot };
}

describe("deep_research synthesis live runAgent seam regression", () => {
  test("live driver writes missing synthesis via runAgent", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_synthesis_live_runagent_${Date.now()}`;
        const { manifestPath, gatesPath, runRoot } = await seedSummariesStage(base, runId);

        const toSynthesis = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "regression: summaries setup",
          tool_context: makeToolContext(),
        });
        expect(toSynthesis.ok).toBe(true);
        if (!toSynthesis.ok) return;
        expect(toSynthesis.to).toBe("synthesis");

        const liveCalls: string[] = [];
        const tick = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "regression: synthesis live runAgent",
          driver: "live",
          drivers: {
            runAgent: async (input: { perspective_id: string }) => {
              liveCalls.push(input.perspective_id);
              return {
                markdown: [
                  "## Summary",
                  "Deterministic LIVE synthesis [@cid_a]",
                  "",
                  "## Key Findings",
                  "- Synthesis finding [@cid_b]",
                  "",
                  "## Evidence",
                  "- Evidence line [@cid_a]",
                  "",
                  "## Caveats",
                  "- Caveat line [@cid_b]",
                  "",
                ].join("\n"),
              };
            },
          },
          tool_context: makeToolContext(),
        } as any);

        expect(tick.ok).toBe(true);
        if (!tick.ok) return;
        expect(tick.from).toBe("synthesis");
        expect(tick.to).toBe("review");
        expect(liveCalls).toEqual(["final-synthesis"]);

        const synthesis = await fs.readFile(path.join(runRoot, "synthesis", "final-synthesis.md"), "utf8");
        expect(synthesis).toContain("Deterministic LIVE synthesis");
      });
    });
  });
});
