import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import * as deepResearch from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_extract_urls = ((deepResearch as any).citations_extract_urls ??
  (deepResearch as any).deep_research_citations_extract_urls) as any | undefined;

describe("deep_research_citations_extract_urls (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  const maybeTest = citations_extract_urls ? test : test.skip;

  maybeTest("extracts only Sources http(s) URLs across wave-1 and wave-2", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_extract_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        await fs.cp(fixture("wave-corpus", "wave-1"), path.join(runRoot, "wave-1"), { recursive: true, force: true });
        await fs.cp(fixture("wave-corpus", "wave-2"), path.join(runRoot, "wave-2"), { recursive: true, force: true });

        const outRaw = (await (citations_extract_urls as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: extract urls",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).run_id).toBe(runId);
        expect((out as any).total_found).toBeGreaterThan((out as any).unique_found);

        const extractedPath = (out as any).extracted_urls_path as string;
        const extracted = (await fs.readFile(extractedPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        expect(extracted).toEqual([
          "https://dup.example.com/shared",
          "https://example.com/a",
          "https://example.com/b?utm_source=phase04",
          "https://example.com/c",
          "https://wave2.example.com/d",
        ]);

        const foundByPath = (out as any).found_by_path as string;
        const foundBy = JSON.parse(await fs.readFile(foundByPath, "utf8"));
        expect(foundBy.schema_version).toBe("found_by.v1");
        expect(Array.isArray(foundBy.items)).toBe(true);
        expect(foundBy.items.some((item: any) => item.wave === "wave-2")).toBe(true);
      });
    });
  });

  maybeTest("respects include_wave2=false", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_extract_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        await fs.cp(fixture("wave-corpus", "wave-1"), path.join(runRoot, "wave-1"), { recursive: true, force: true });
        await fs.cp(fixture("wave-corpus", "wave-2"), path.join(runRoot, "wave-2"), { recursive: true, force: true });

        const outRaw = (await (citations_extract_urls as any).execute(
          {
            manifest_path: manifestPath,
            include_wave2: false,
            reason: "test: extract urls wave-1 only",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);

        const extractedPath = (out as any).extracted_urls_path as string;
        const extracted = (await fs.readFile(extractedPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        expect(extracted).toEqual([
          "https://dup.example.com/shared",
          "https://example.com/a",
          "https://example.com/b?utm_source=phase04",
          "https://example.com/c",
        ]);
      });
    });
  });
});
