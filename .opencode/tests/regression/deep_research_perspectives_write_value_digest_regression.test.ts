import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { perspectives_write, run_init } from "../../tools/deep_research_cli.ts";
import { sha256DigestForJson } from "../../tools/deep_research_cli/wave_tools_shared";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_perspectives_write value_digest canonicalization (regression)", () => {
  test("records identical value_digest for semantically-equal value objects", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_perspectives_value_digest_regression";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = path.join(runRoot, "perspectives.json");

        const valueA = {
          schema_version: "perspectives.v1",
          run_id: runId,
          created_at: "2026-02-21T00:00:00.000Z",
          perspectives: [
            {
              id: "p1",
              title: "Primary perspective",
              track: "standard",
              agent_type: "researcher",
              prompt_contract: {
                max_words: 600,
                max_sources: 3,
                tool_budget: { websearch: 1, webfetch: 2 },
                must_include_sections: ["summary", "evidence"],
              },
            },
          ],
        };

        const valueB = {
          created_at: "2026-02-21T00:00:00.000Z",
          perspectives: [
            {
              agent_type: "researcher",
              track: "standard",
              title: "Primary perspective",
              id: "p1",
              prompt_contract: {
                tool_budget: { webfetch: 2, websearch: 1 },
                must_include_sections: ["summary", "evidence"],
                max_sources: 3,
                max_words: 600,
              },
            },
          ],
          run_id: runId,
          schema_version: "perspectives.v1",
        };

        const writeARaw = (await (perspectives_write as any).execute(
          {
            perspectives_path: perspectivesPath,
            value: valueA,
            reason: "test: value digest canonicalization a",
          },
          makeToolContext(),
        )) as string;
        const writeA = parseToolJson(writeARaw);
        expect(writeA.ok).toBe(true);

        const writeBRaw = (await (perspectives_write as any).execute(
          {
            perspectives_path: perspectivesPath,
            value: valueB,
            reason: "test: value digest canonicalization b",
          },
          makeToolContext(),
        )) as string;
        const writeB = parseToolJson(writeBRaw);
        expect(writeB.ok).toBe(true);

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditTxt = await fs.readFile(auditPath, "utf8");
        const auditEntries = auditTxt
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .map((line: string) => JSON.parse(line) as Record<string, unknown>)
          .filter((entry: Record<string, unknown>) => String(entry.kind ?? "") === "perspectives_write");

        expect(auditEntries.length).toBeGreaterThanOrEqual(2);

        const digestA = String(auditEntries[0]?.value_digest ?? "");
        const digestB = String(auditEntries[1]?.value_digest ?? "");

        expect(digestA).toBe(sha256DigestForJson(valueA));
        expect(digestB).toBe(sha256DigestForJson(valueB));
        expect(digestA).toBe(digestB);
      });
    });
  });
});
