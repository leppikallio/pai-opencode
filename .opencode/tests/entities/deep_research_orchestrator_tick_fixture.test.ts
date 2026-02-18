import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  acquireRunLock,
  orchestrator_tick_fixture,
  releaseRunLock,
  run_init,
  stage_advance,
} from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_orchestrator_tick_fixture (entity)", () => {
  test("runs fixture driver boundary and delegates transition authority to stage_advance", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_001";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        await fs.copyFile(
          fixturePath("runs", "p02-stage-advance-init", "perspectives.json"),
          path.join(runRoot, "perspectives.json"),
        );

        const driverCalls: Array<{ run_id: string; stage: string; run_root: string }> = [];

        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator fixture boundary",
          fixture_driver: async ({ run_id, stage, run_root }) => {
            driverCalls.push({ run_id, stage, run_root });
            return {
              wave_outputs: [{ perspective_id: "p1", output_path: path.join(run_root, "wave-1", "p1.md") }],
              requested_next: "wave1",
            };
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(driverCalls).toEqual([{ run_id: runId, stage: "init", run_root: runRoot }]);

        expect(out.ok).toBe(true);
        if (!out.ok) return;

        expect(out.from).toBe("init");
        expect(out.to).toBe("wave1");
        expect(out.requested_next).toBe("wave1");
        expect(out.wave_outputs_count).toBe(1);
        expect(out.wave_outputs[0]).toMatchObject({ perspective_id: "p1" });
        expect(typeof out.decision_inputs_digest).toBe("string");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("wave1");
      });
    });
  });

  test("bubbles stage_advance block errors while still proving fixture boundary execution", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_002";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        let fixtureDriverCalled = false;
        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator stage block",
          fixture_driver: async () => {
            fixtureDriverCalled = true;
            return {
              wave_outputs: [{ perspective_id: "p2" }],
              requested_next: "wave1",
            };
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        expect(fixtureDriverCalled).toBe(true);
        expect(out.ok).toBe(false);
        if (out.ok) return;

        expect(out.error.code).toBe("MISSING_ARTIFACT");
        expect(out.error.details.wave_outputs_count).toBe(1);
        expect(out.error.details.stage_advance_error_code).toBe("MISSING_ARTIFACT");
      });
    });
  });

  test("prevents concurrent tick execution when run lock is held", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_003";

        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const lock = await acquireRunLock({
          run_root: runRoot,
          lease_seconds: 120,
          reason: "test: hold lock",
        });
        expect(lock.ok).toBe(true);
        if (!lock.ok) return;

        let fixtureDriverCalled = false;
        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: lock contention",
          fixture_driver: async () => {
            fixtureDriverCalled = true;
            return { wave_outputs: [], requested_next: "wave1" };
          },
          stage_advance_tool: stage_advance as any,
          tool_context: makeToolContext(),
        });

        const release = await releaseRunLock(lock.handle);
        expect(release.ok).toBe(true);

        expect(fixtureDriverCalled).toBe(false);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("LOCK_HELD");
      });
    });
  });
});
