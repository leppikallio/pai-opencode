import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";

import { run_init, stage_advance } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research Gate F enforcement (regression)", () => {
  test("stage_advance review->finalize is blocked unless Gate F is pass", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_gate_f_${Date.now()}`;
        const initRaw = (await (run_init as any).execute(
          {
            query: "regression:gate-f",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        // Force stage to review.
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
        manifest.status = "running";
        manifest.stage = { ...(manifest.stage ?? {}), current: "review" };
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        // Set E=pass, F=fail.
        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8")) as any;
        gates.gates.E.status = "pass";
        gates.gates.E.checked_at = "2026-01-01T00:00:00.000Z";
        gates.gates.F.status = "fail";
        gates.gates.F.checked_at = "2026-01-01T00:00:00.000Z";
        await fs.writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, "utf8");

        const raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            requested_next: "finalize",
            reason: "test: enforce gate f",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(raw) as any;

        // Expected after fix: ok=false and error mentions gate F.
        // Expected today: this test FAILS because Gate F is not enforced.
        expect(out.ok).toBe(false);
      });
    });
  });
});
