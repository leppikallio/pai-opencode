import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import * as deepResearch from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_validate = ((deepResearch as any).citations_validate ??
  (deepResearch as any).deep_research_citations_validate) as any | undefined;

describe("deep_research_citations_validate (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  const maybeTest = citations_validate ? test : test.skip;

  maybeTest("runs in OFFLINE fixture mode when PAI_DR_NO_WEB=1", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");

        const urlMap = JSON.parse(await fs.readFile(fixture("validate", "url-map.json"), "utf8"));
        urlMap.run_id = runId;
        await fs.writeFile(urlMapPath, JSON.stringify(urlMap, null, 2) + "\n", "utf8");

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            offline_fixtures_path: fixture("validate", "url-checks.json"),
            reason: "test: validate urls offline",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).mode).toBe("offline");
        expect((out as any).validated).toBe(3);

        const citationsPath = (out as any).citations_path as string;
        const rows = (await fs.readFile(citationsPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));

        expect(rows.length).toBe(3);
        expect(rows.some((row: any) => row.status === "paywalled")).toBe(true);

        const normalizedUrls = rows.map((row: any) => row.normalized_url);
        expect(normalizedUrls).toEqual([...normalizedUrls].sort((a, b) => a.localeCompare(b)));
      });
    });
  });

  maybeTest("requires offline_fixtures_path in OFFLINE mode", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: (init as any).manifest_path,
            reason: "test: missing fixtures",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("INVALID_ARGS");
      });
    });
  });
});
