import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, stage_advance } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

type ManifestFixture = {
  stage: { current: string };
  limits: { max_wave2_agents: number };
};

describe("deep_research_stage_advance wave2 cap (entity)", () => {
  test("blocks pivot -> wave2 when wave2_gap_ids exceed max_wave2_agents", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_wave2_cap_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestFixture;
        const cap = manifest.limits.max_wave2_agents;
        const wave2GapIds = Array.from({ length: cap + 1 }, (_, idx) => `gap_${idx + 1}`);

        manifest.stage.current = "pivot";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const pivotPath = path.join(runRoot, "pivot.json");
        await fs.writeFile(
          pivotPath,
          `${JSON.stringify({
            schema_version: "pivot_decision.v1",
            run_id: runId,
            decision: {
              wave2_required: true,
              wave2_gap_ids: wave2GapIds,
            },
          }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            requested_next: "wave2",
            reason: "test: enforce wave2 cap",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("WAVE_CAP_EXCEEDED");
        expect((out as any).error.details).toMatchObject({
          cap,
          count: wave2GapIds.length,
          stage: "wave2",
        });

        const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestFixture;
        expect(manifestAfter.stage.current).toBe("pivot");
      });
    });
  });
});
