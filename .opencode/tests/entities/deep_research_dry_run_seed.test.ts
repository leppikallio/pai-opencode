import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { dry_run_seed } from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_dry_run_seed (entity)", () => {
  test("seeds run root from fixture and records dry_run constraint", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const fixtureDir = fixturePath("dry-run", "case-minimal");
        const runId = "dr_test_dry_seed_001";

        const outRaw = (await (dry_run_seed as any).execute(
          {
            fixture_dir: fixtureDir,
            run_id: runId,
            reason: "test: seed dry-run",
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);

        const root = (out as any).root as string;
        const wave1File = path.join(root, "wave-1", "p1.md");
        const wave1Body = await fs.readFile(wave1File, "utf8");
        expect(wave1Body).toContain("Deterministic dry-run fixture content.");

        const manifestPath = (out as any).manifest_path as string;
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

        expect(manifest.query.constraints.dry_run.fixture_dir).toBe(fixtureDir);
        expect(manifest.query.constraints.dry_run.case_id).toBe("case-minimal");
        expect(manifest.query.sensitivity).toBe("no_web");
      });
    });
  });
});
