import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";

import { run_init, watchdog_check } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_watchdog_check (entity)", () => {
  test("marks run failed and writes timeout checkpoint when stage exceeds timeout", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_watchdog_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;

        // Force deterministic timeout: init timeout is 120s.
        const seeded = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        seeded.stage.started_at = "2026-02-14T11:50:00.000Z";
        await fs.writeFile(manifestPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        const outRaw = (await (watchdog_check as any).execute(
          {
            manifest_path: manifestPath,
            now_iso: "2026-02-14T12:00:00.000Z",
            reason: "test: timeout watchdog",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).timed_out).toBe(true);
        expect((out as any).stage).toBe("init");
        expect((out as any).elapsed_s).toBe(600);
        expect((out as any).timeout_s).toBe(120);
        expect((out as any).manifest_revision).toBe(2);

        const checkpointPath = (out as any).checkpoint_path as string;
        const checkpoint = await fs.readFile(checkpointPath, "utf8");
        expect(checkpoint).toContain("- stage: init");
        expect(checkpoint).toContain("- elapsed_seconds: 600");
        expect(checkpoint).toContain("- last_known_subtask: unavailable (placeholder)");
        expect(checkpoint).toContain("- next_steps:");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.status).toBe("failed");
        expect(Array.isArray(manifest.failures)).toBe(true);
        expect(manifest.failures.length).toBe(1);
        expect(manifest.failures[0]).toMatchObject({
          kind: "timeout",
          stage: "init",
          message: "timeout after 600s",
          retryable: false,
        });
      });
    });
  });

  test("does not time out when manifest is paused", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_watchdog_paused_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;

        // Force deterministic timeout if it were running, but pause should prevent timeout.
        const seeded = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        seeded.status = "paused";
        seeded.stage.started_at = "2026-02-14T11:50:00.000Z";
        await fs.writeFile(manifestPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        const outRaw = (await (watchdog_check as any).execute(
          {
            manifest_path: manifestPath,
            now_iso: "2026-02-14T12:00:00.000Z",
            reason: "test: paused watchdog",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).timed_out).toBe(false);
        expect((out as any).paused).toBe(true);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.status).toBe("paused");
      });
    });
  });
});
