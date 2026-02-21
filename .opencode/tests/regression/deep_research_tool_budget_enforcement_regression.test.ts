import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { wave_output_validate } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withTempDir } from "../helpers/dr-harness";

describe("deep_research tool budget enforcement (regression)", () => {
  test("fails when sidecar tool usage exceeds prompt contract budget", async () => {
    await withTempDir(async (baseDir) => {
      const perspectivesPath = path.join(baseDir, "perspectives.json");
      const markdownPath = path.join(baseDir, "p1.md");
      const sidecarPath = path.join(baseDir, "p1.meta.json");

      const perspectivesDoc = {
        schema_version: "perspectives.v1",
        run_id: "dr_tool_budget_regression_001",
        created_at: "2026-02-21T00:00:00Z",
        perspectives: [
          {
            id: "p1",
            title: "Budget enforcement perspective",
            track: "standard",
            agent_type: "ClaudeResearcher",
            prompt_contract: {
              max_words: 200,
              max_sources: 2,
              tool_budget: {
                search_calls: 0,
                fetch_calls: 0,
              },
              must_include_sections: ["Findings", "Sources", "Gaps"],
            },
          },
        ],
      };

      const markdown = [
        "## Findings",
        "Budget regression fixture.",
        "",
        "## Sources",
        "- [Fixture](https://example.com)",
        "",
        "## Gaps",
        "- None",
      ].join("\n");

      const sidecar = {
        schema_version: "wave-output-meta.v1",
        prompt_digest: "sha256:test",
        tool_usage: {
          search_calls: 1,
          fetch_calls: 0,
        },
      };

      await fs.writeFile(perspectivesPath, `${JSON.stringify(perspectivesDoc, null, 2)}\n`, "utf8");
      await fs.writeFile(markdownPath, `${markdown}\n`, "utf8");
      await fs.writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

      const outRaw = (await (wave_output_validate as any).execute(
        {
          perspectives_path: perspectivesPath,
          perspective_id: "p1",
          markdown_path: markdownPath,
        },
        makeToolContext(),
      )) as string;
      const out = parseToolJson(outRaw) as any;

      // Expected behavior after implementation. Fails before fix.
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe("TOOL_BUDGET_EXCEEDED");
      expect(out.error.details.tool).toBe("search_calls");
      expect(out.error.details.limit).toBe(0);
      expect(out.error.details.recorded).toBe(1);
    });
  });
});
