import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_fixture,
  run_init,
  stage_advance,
} from "../../tools/deep_research_cli.ts";
import { readRunPolicyFromManifest } from "../../tools/deep_research_cli/run_policy_read";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research run lock policy wiring (regression)", () => {
  test("orchestrator_tick_fixture uses run policy lock lease and heartbeat interval", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_run_lock_policy_regression_001";
        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);
        const policyPath = path.join(runRoot, "run-config", "policy.json");

        await fs.copyFile(
          fixturePath("runs", "p02-stage-advance-init", "perspectives.json"),
          path.join(runRoot, "perspectives.json"),
        );

        const policyDoc = JSON.parse(await fs.readFile(policyPath, "utf8"));
        policyDoc.run_lock_policy_v1 = {
          lease_seconds: 7,
          heartbeat_interval_ms: 10,
          heartbeat_max_failures: 2,
        };
        await fs.writeFile(policyPath, `${JSON.stringify(policyDoc, null, 2)}\n`, "utf8");

        const resolvedPolicy = await readRunPolicyFromManifest({
          manifest_path: manifestPath,
          manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")),
        });
        expect(resolvedPolicy.policy.run_lock_policy_v1).toEqual({
          lease_seconds: 7,
          heartbeat_interval_ms: 10,
          heartbeat_max_failures: 2,
        });

        let lockLeaseAtStart = 0;

        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: run lock policy wiring",
          fixture_driver: async ({ run_root }) => {
            const lockPath = path.join(run_root, ".lock");
            const initialLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
            lockLeaseAtStart = Number(initialLock.lease_seconds ?? 0);

            return {
              wave_outputs: [{ perspective_id: "p1", output_path: path.join(run_root, "wave-1", "p1.md") }],
              requested_next: "wave1",
            };
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        expect(lockLeaseAtStart).toBe(7);
      });
    });
  });
});
