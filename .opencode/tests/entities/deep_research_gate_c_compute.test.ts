import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const gate_c_compute = ((deepResearch as any).gate_c_compute ??
  (deepResearch as any).deep_research_gate_c_compute) as any | undefined;

describe("deep_research_gate_c_compute (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  const maybeTest = gate_c_compute ? test : test.skip;

  maybeTest("counts paywalled as validated for Gate C metrics", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_gate_c_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        await fs.copyFile(
          fixture("gate-c", "extracted-urls.txt"),
          path.join(runRoot, "citations", "extracted-urls.txt"),
        );
        await fs.copyFile(
          fixture("gate-c", "citations.jsonl"),
          path.join(runRoot, "citations", "citations.jsonl"),
        );

        const outRaw = (await (gate_c_compute as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate c metrics",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).gate_id).toBe("C");
        expect((out as any).status).toBe("pass");

        const metrics = (out as any).metrics;
        expect(metrics.validated_url_rate).toBeCloseTo(0.9, 8);
        expect(metrics.invalid_url_rate).toBeCloseTo(0.1, 8);
        expect(metrics.uncategorized_url_rate).toBe(0);

        const updateC = (out as any).update.C;
        expect(updateC.status).toBe("pass");
        expect(updateC.metrics.validated_url_rate).toBeCloseTo(0.9, 8);
      });
    });
  });
});
