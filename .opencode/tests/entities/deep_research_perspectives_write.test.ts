import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { perspectives_write, run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_perspectives_write (entity)", () => {
  test("writes valid perspectives.v1 to <runRoot>/perspectives.json", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_perspectives_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = path.join(runRoot, "perspectives.json");

        const value = {
          schema_version: "perspectives.v1",
          run_id: runId,
          created_at: "2026-02-14T00:00:00Z",
          perspectives: [
            {
              id: "p1",
              title: "Technical overview",
              track: "standard",
              agent_type: "ClaudeResearcher",
              prompt_contract: {
                max_words: 900,
                max_sources: 12,
                tool_budget: { search_calls: 4, fetch_calls: 6 },
                must_include_sections: ["Findings", "Sources", "Gaps"],
              },
            },
          ],
        };

        const outRaw = (await (perspectives_write as any).execute(
          {
            perspectives_path: perspectivesPath,
            value,
            reason: "test: write perspectives",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).path).toBe(perspectivesPath);

        const written = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
        expect(written.schema_version).toBe("perspectives.v1");
        expect(written.run_id).toBe(runId);
      });
    });
  });
});
