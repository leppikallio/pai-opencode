import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { review_factory_run, run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_review_factory_run (entity)", () => {
  test("fixture mode writes bounded review bundle", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_review_factory_001";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(path.join(runRoot, "synthesis", "draft-synthesis.md"), "## Summary\nDraft\n", "utf8");
        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" })}\n`,
          "utf8",
        );

        const fixtureDir = path.join(base, "fixture-review");
        await fs.mkdir(fixtureDir, { recursive: true });
        await fs.writeFile(
          path.join(fixtureDir, "review-bundle.json"),
          `${JSON.stringify({
            schema_version: "review_bundle.v1",
            run_id: "fixture-run",
            decision: "CHANGES_REQUIRED",
            findings: Array.from({ length: 120 }, (_, i) => ({ id: `f${i}`, text: `finding-${i}` })),
            directives: Array.from({ length: 130 }, (_, i) => ({ id: `d${i}`, text: `directive-${i}` })),
          }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await review_factory_run.execute(
          {
            manifest_path: manifestPath,
            mode: "fixture",
            fixture_bundle_dir: fixtureDir,
            reason: "test: review factory",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect(String(out.decision)).toBe("CHANGES_REQUIRED");

        const reviewBundlePath = String(out.review_bundle_path);
        const bundle = JSON.parse(await fs.readFile(reviewBundlePath, "utf8"));
        expect(bundle.run_id).toBe(runId);
        expect(bundle.findings.length).toBe(100);
        expect(bundle.directives.length).toBe(100);
      });
    });
  });
});
