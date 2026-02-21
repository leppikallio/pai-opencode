import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, watchdog_check } from "../../tools/deep_research_cli.ts";
import { STAGE_TIMEOUT_SECONDS_V1 } from "../../tools/deep_research_cli/schema_v1";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research timeout policy override (regression)", () => {
  test("watchdog_check uses run policy timeout override when present", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "normal",
            run_id: "dr_timeout_policy_regression_001",
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path ?? "");
        const runRoot = path.dirname(manifestPath);
        const policyPath = path.join(runRoot, "run-config", "policy.json");

        await fs.mkdir(path.dirname(policyPath), { recursive: true });
        await fs.writeFile(
          policyPath,
          `${JSON.stringify({
            schema_version: "run_policy.v1",
            stage_timeouts_seconds_v1: {
              ...STAGE_TIMEOUT_SECONDS_V1,
              init: 1,
            },
            citations_ladder_policy_v1: {
              direct_fetch_timeout_ms: 5000,
              endpoint_timeout_ms: 5000,
              max_redirects: 5,
              max_body_bytes: 2 * 1024 * 1024,
              direct_fetch_max_attempts: 1,
              bright_data_max_attempts: 1,
              apify_max_attempts: 1,
              backoff_initial_ms: 100,
              backoff_multiplier: 2,
              backoff_max_ms: 1000,
            },
          }, null, 2)}\n`,
          "utf8",
        );

        const seeded = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        seeded.stage.started_at = "2026-02-21T10:00:00.000Z";
        seeded.stage.last_progress_at = "2026-02-21T10:00:00.000Z";
        await fs.writeFile(manifestPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        const outRaw = (await (watchdog_check as any).execute(
          {
            manifest_path: manifestPath,
            stage: "init",
            now_iso: "2026-02-21T10:00:02.000Z",
            reason: "test: timeout policy override",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).timed_out).toBe(true);
        expect((out as any).timeout_s).toBe(1);
      });
    });
  });
});
