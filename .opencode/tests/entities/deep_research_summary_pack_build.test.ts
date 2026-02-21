import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, summary_pack_build } from "../../tools/deep_research_cli.ts";
import { asRecord, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

function perspectivesDoc(runId: string) {
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
        prompt_contract: {
          max_words: 300,
          max_sources: 10,
          tool_budget: { search_calls: 2 },
          must_include_sections: ["Findings", "Sources", "Gaps"],
        },
      },
      {
        id: "p2",
        title: "P2",
        track: "independent",
        agent_type: "GeminiResearcher",
        prompt_contract: {
          max_words: 300,
          max_sources: 10,
          tool_budget: { search_calls: 2 },
          must_include_sections: ["Findings", "Sources", "Gaps"],
        },
      },
    ],
  };
}

describe("deep_research_summary_pack_build (entity)", () => {
  test("builds generate-mode summaries from deterministic agent outputs", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_summary_pack_generate_001";
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
            ...perspectivesDoc(runId),
            perspectives: [
              {
                ...perspectivesDoc(runId).perspectives[0],
                source_artifact: "agent-output/p1.md",
              },
              {
                ...perspectivesDoc(runId).perspectives[1],
                source_artifact: "agent-output/p2.md",
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

        await fs.writeFile(path.join(sourceDir, "p1.md"), "## Findings\nGenerated evidence [@cid_alpha]\n", "utf8");
        await fs.writeFile(path.join(sourceDir, "p2.md"), "## Findings\nGenerated evidence [@cid_beta]\n", "utf8");

        const outRaw = (await summary_pack_build.execute(
          {
            manifest_path: manifestPath,
            mode: "generate",
            reason: "test: generate summary pack",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect(Number(out.summary_count)).toBe(2);

        const summaryPackPath = String(out.summary_pack_path);
        const pack = asRecord(JSON.parse(await fs.readFile(summaryPackPath, "utf8")), "summary_pack");
        const summaries = pack.summaries;
        expect(Array.isArray(summaries)).toBe(true);
        if (!Array.isArray(summaries)) throw new Error("summaries must be an array");
        expect(String(asRecord(summaries[0], "summary").source_artifact)).toContain("agent-output/");
      });
    });
  });

  test("builds summary_pack.v1 with required envelope fields", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_summary_pack_001";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(perspectivesDoc(runId), null, 2)}\n`, "utf8");
        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${[
            JSON.stringify({ cid: "cid_alpha", status: "valid", normalized_url: "https://a.test" }),
            JSON.stringify({ cid: "cid_beta", status: "paywalled", normalized_url: "https://b.test" }),
          ].join("\n")}\n`,
          "utf8",
        );

        const fixtureDir = path.join(base, "fixtures-summaries");
        await fs.mkdir(fixtureDir, { recursive: true });
        await fs.writeFile(path.join(fixtureDir, "p1.md"), "## Findings\nClaim A [@cid_alpha]\n", "utf8");
        await fs.writeFile(path.join(fixtureDir, "p2.md"), "## Findings\nClaim B [@cid_beta]\n", "utf8");

        const outRaw = (await summary_pack_build.execute(
          {
            manifest_path: manifestPath,
            mode: "fixture",
            fixture_summaries_dir: fixtureDir,
            reason: "test: summary pack",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect(Number(out.summary_count)).toBe(2);

        const summaryPackPath = String(out.summary_pack_path);
        const pack = asRecord(JSON.parse(await fs.readFile(summaryPackPath, "utf8")), "summary_pack");
        expect(pack.schema_version).toBe("summary_pack.v1");
        expect(pack.run_id).toBe(runId);
        expect(typeof pack.generated_at).toBe("string");
        expect(pack).toHaveProperty("limits");
        const summaries = pack.summaries;
        expect(Array.isArray(summaries)).toBe(true);
        if (!Array.isArray(summaries)) throw new Error("summaries must be an array");
        expect(summaries.map((summary) => String(asRecord(summary, "summary").perspective_id))).toEqual(["p1", "p2"]);
        expect(typeof pack.total_estimated_tokens).toBe("number");
      });
    });
  });

  test("fails RAW_URL_NOT_ALLOWED when fixture summary includes raw URL", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_summary_pack_002";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(perspectivesDoc(runId), null, 2)}\n`, "utf8");
        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${JSON.stringify({ cid: "cid_alpha", status: "valid", normalized_url: "https://a.test" })}\n`,
          "utf8",
        );

        const fixtureDir = path.join(base, "fixtures-summaries");
        await fs.mkdir(fixtureDir, { recursive: true });
        await fs.writeFile(path.join(fixtureDir, "p1.md"), "## Findings\nclaim [@cid_alpha]\n", "utf8");
        await fs.writeFile(path.join(fixtureDir, "p2.md"), "## Findings\nhttps://example.com\n", "utf8");

        const outRaw = (await summary_pack_build.execute(
          {
            manifest_path: manifestPath,
            mode: "fixture",
            fixture_summaries_dir: fixtureDir,
            reason: "test: raw url",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(false);
        const error = asRecord(out.error, "error");
        expect(String(error.code)).toBe("RAW_URL_NOT_ALLOWED");
      });
    });
  });
});
