import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_normalize = ((deepResearch as any).citations_normalize ??
  (deepResearch as any).deep_research_citations_normalize) as any | undefined;

describe("deep_research_citations_normalize (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  const maybeTest = citations_normalize ? test : test.skip;

  maybeTest("normalizes extracted URLs and emits deterministic cid map", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_norm_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const extractedPath = path.join(runRoot, "citations", "extracted-urls.txt");

        await fs.copyFile(fixture("normalize", "extracted-urls.txt"), extractedPath);

        const outRaw = (await (citations_normalize as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: normalize urls",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).run_id).toBe(runId);

        const normalizedPath = (out as any).normalized_urls_path as string;
        const actualNormalized = (await fs.readFile(normalizedPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const expectedNormalized = (await fs.readFile(fixture("normalize", "expected-normalized-urls.txt"), "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        expect(actualNormalized).toEqual(expectedNormalized);
        expect((out as any).unique_normalized).toBe(expectedNormalized.length);

        const urlMapPath = (out as any).url_map_path as string;
        const urlMap = JSON.parse(await fs.readFile(urlMapPath, "utf8"));
        expect(urlMap.schema_version).toBe("url_map.v1");
        expect(urlMap.run_id).toBe(runId);
        expect(Array.isArray(urlMap.items)).toBe(true);

        for (const normalized of expectedNormalized) {
          const expectedCid = `cid_${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
          const matches = urlMap.items.filter((item: any) => item.normalized_url === normalized);
          expect(matches.length).toBeGreaterThan(0);
          for (const m of matches) {
            expect(m.cid).toBe(expectedCid);
            expect(typeof m.url_original).toBe("string");
          }
        }
      });
    });
  });
});
