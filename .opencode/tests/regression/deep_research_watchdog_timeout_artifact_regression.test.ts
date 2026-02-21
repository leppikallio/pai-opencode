import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, watchdog_check } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research watchdog timeout artifact (regression)", () => {
  test("writes typed timeout JSON artifact and returns checkpoint_json_path", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "normal",
            run_id: "dr_watchdog_json_artifact_001",
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path ?? "");
        expect(manifestPath.length).toBeGreaterThan(0);

        const seeded = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        seeded.stage.started_at = "2026-02-14T11:50:00.000Z";
        seeded.stage.last_progress_at = "2026-02-14T11:50:00.000Z";
        await fs.writeFile(manifestPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        const outRaw = (await (watchdog_check as any).execute(
          {
            manifest_path: manifestPath,
            now_iso: "2026-02-14T12:00:00.000Z",
            reason: "test: watchdog typed artifact regression",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).timed_out).toBe(true);

        const checkpointJsonPath = String((out as any).checkpoint_json_path ?? "");
        expect(path.basename(checkpointJsonPath)).toBe("timeout-checkpoint.json");

        const checkpointJsonRaw = await fs.readFile(checkpointJsonPath, "utf8");
        const checkpointJson = JSON.parse(checkpointJsonRaw) as Record<string, unknown>;
        expect(checkpointJson.schema_version).toBe("timeout_checkpoint.v1");
        expect(checkpointJson.stage).toBe("init");
        expect(checkpointJson.elapsed_seconds).toBe(600);
      });
    });
  });
});
