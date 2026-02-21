import { describe, expect, test } from "bun:test";

import {
  run_init,
  run_metrics_write,
  telemetry_append,
} from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research run_metrics_write unchanged-telemetry skip (regression)", () => {
  test("run_metrics_write skips when telemetry index last_seq is unchanged", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_metrics_skip_regression_001";

        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path ?? "");

        const appendRaw = (await (telemetry_append as any).execute(
          {
            manifest_path: manifestPath,
            event: {
              event_type: "run_status",
              status: "running",
            },
            reason: "test: metrics skip setup",
          },
          makeToolContext(),
        )) as string;
        const append = parseToolJson(appendRaw);
        expect(append.ok).toBe(true);

        const firstRaw = (await (run_metrics_write as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: first metrics write",
          },
          makeToolContext(),
        )) as string;
        const first = parseToolJson(firstRaw);
        expect(first.ok).toBe(true);
        expect((first as any).skipped).not.toBe(true);

        const secondRaw = (await (run_metrics_write as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: second metrics write unchanged",
          },
          makeToolContext(),
        )) as string;
        const second = parseToolJson(secondRaw);
        expect(second.ok).toBe(true);
        expect((second as any).skipped).toBe(true);
        expect((second as any).reason).toBe("telemetry unchanged");
      });
    });
  });
});
