import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, summary_pack_build, synthesis_write } from "../../tools/deep_research_cli.ts";
import { asRecord, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function setup(base: string, runId: string) {
  const initRaw = (await run_init.execute(
    { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = String(init.manifest_path);
  const runRoot = path.dirname(manifestPath);
  await fs.writeFile(
    path.join(runRoot, "perspectives.json"),
    `${JSON.stringify({
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
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(runRoot, "citations", "citations.jsonl"),
    `${[
      JSON.stringify({ cid: "cid_alpha", status: "valid", normalized_url: "https://a.test" }),
      JSON.stringify({ cid: "cid_beta", status: "paywalled", normalized_url: "https://b.test" }),
    ].join("\n")}\n`,
    "utf8",
  );

  const fixtureSummariesDir = path.join(base, "fixture-summaries");
  await fs.mkdir(fixtureSummariesDir, { recursive: true });
  await fs.writeFile(path.join(fixtureSummariesDir, "p1.md"), "## Findings\nBounded claim [@cid_alpha]\n", "utf8");

  const buildRaw = (await summary_pack_build.execute(
    {
      manifest_path: manifestPath,
      mode: "fixture",
      fixture_summaries_dir: fixtureSummariesDir,
      reason: "test: build summary pack for synthesis",
    },
    makeToolContext(),
  )) as string;
  const build = parseToolJson(buildRaw);
  expect(build.ok).toBe(true);

  return { manifestPath, runRoot };
}

describe("deep_research_synthesis_write (entity)", () => {
  test("writes generate-mode draft from generated summary pack", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_synthesis_generate_001";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);
        const sourceDir = path.join(runRoot, "agent-output");
        await fs.mkdir(sourceDir, { recursive: true });

        await fs.writeFile(
          path.join(runRoot, "perspectives.json"),
          `${JSON.stringify({
            schema_version: "perspectives.v1",
            run_id: runId,
            created_at: "2026-02-14T00:00:00Z",
            perspectives: [
              {
                id: "p1",
                title: "P1",
                track: "standard",
                agent_type: "ClaudeResearcher",
                source_artifact: "agent-output/p1.md",
                prompt_contract: { max_words: 300, max_sources: 10, tool_budget: { search_calls: 1 }, must_include_sections: ["Findings", "Sources", "Gaps"] },
              },
            ],
          }, null, 2)}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${JSON.stringify({ cid: "cid_alpha", status: "valid", normalized_url: "https://a.test" })}\n`,
          "utf8",
        );
        await fs.writeFile(path.join(sourceDir, "p1.md"), "## Findings\nGenerated summary source [@cid_alpha]\n", "utf8");

        const buildRaw = (await summary_pack_build.execute(
          {
            manifest_path: manifestPath,
            mode: "generate",
            reason: "test: generate summary pack for synthesis",
          },
          makeToolContext(),
        )) as string;
        const build = parseToolJson(buildRaw);
        expect(build.ok).toBe(true);

        const outRaw = (await synthesis_write.execute(
          {
            manifest_path: manifestPath,
            mode: "generate",
            reason: "test: synthesis generate",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);

        const markdown = await fs.readFile(String(out.output_path), "utf8");
        expect(markdown).toContain("## Summary");
        expect(markdown).toContain("## Key Findings");
        expect(markdown).toContain("## Evidence");
        expect(markdown).toContain("## Caveats");
        expect(markdown).toContain("[@cid_alpha]");
      });
    });
  });

  test("writes fixture draft using bounded inputs only", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath, runRoot } = await setup(base, "dr_test_p05_synthesis_001");

        const draftFixturePath = path.join(base, "draft.md");
        await fs.writeFile(
          draftFixturePath,
          [
            "## Summary",
            "Overview [@cid_alpha]",
            "",
            "## Key Findings",
            "- Finding one [@cid_beta]",
            "",
            "## Evidence",
            "Evidence line [@cid_alpha]",
            "",
            "## Caveats",
            "Caveat line.",
            "",
          ].join("\n"),
          "utf8",
        );

        const outRaw = (await synthesis_write.execute(
          {
            manifest_path: manifestPath,
            mode: "fixture",
            fixture_draft_path: draftFixturePath,
            reason: "test: synthesis fixture",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        const outputPath = String(out.output_path);
        expect(outputPath).toBe(path.join(runRoot, "synthesis", "draft-synthesis.md"));
      });
    });
  });

  test("fails UNKNOWN_CID when draft references unvalidated cid", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath } = await setup(base, "dr_test_p05_synthesis_002");
        const draftFixturePath = path.join(base, "draft.md");
        await fs.writeFile(
          draftFixturePath,
          [
            "## Summary",
            "Overview [@cid_unknown]",
            "",
            "## Key Findings",
            "- one",
            "",
            "## Evidence",
            "line",
            "",
            "## Caveats",
            "line",
          ].join("\n"),
          "utf8",
        );

        const outRaw = (await synthesis_write.execute(
          {
            manifest_path: manifestPath,
            mode: "fixture",
            fixture_draft_path: draftFixturePath,
            reason: "test: synthesis unknown cid",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(false);
        const error = asRecord(out.error, "error");
        expect(String(error.code)).toBe("UNKNOWN_CID");
      });
    });
  });
});
