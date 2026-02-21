import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_render_md = ((deepResearch as any).citations_render_md ??
  (deepResearch as any).deep_research_citations_render_md) as any | undefined;

describe("deep_research_citations_render_md (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  const maybeTest = citations_render_md ? test : test.skip;

  maybeTest("renders deterministic markdown from citations.jsonl", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_render_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        await fs.copyFile(
          fixture("render", "citations.jsonl"),
          path.join(runRoot, "citations", "citations.jsonl"),
        );

        const outRaw = (await (citations_render_md as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: render citations markdown",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).rendered).toBe(3);

        const outputPath = (out as any).output_md_path as string;
        const md = await fs.readFile(outputPath, "utf8");

        expect(md).toContain("cid_2dce0a4c50441bfccfa9caf4b58c3cba6e06c420505dd829f0436de1aa44baac");
        expect(md).toContain("https://example.com/open");
        expect(md).toContain("paywalled");
        expect(md).toContain("Open Example");
        expect(md).toContain("Paywall Times");

        const idxA = md.indexOf("https://example.com/a");
        const idxOpen = md.indexOf("https://example.com/open");
        const idxPaywalled = md.indexOf("https://paywall.example.com/premium");
        expect(idxA).toBeGreaterThanOrEqual(0);
        expect(idxOpen).toBeGreaterThan(idxA);
        expect(idxPaywalled).toBeGreaterThan(idxOpen);
      });
    });
  });
});
