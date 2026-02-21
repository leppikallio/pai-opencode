import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gate_a_evaluate, run_init, wave1_plan } from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<void> {
  const fixture = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;
  await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

describe("deep_research_gate_a_evaluate (entity)", () => {
  test("returns pass when scope, perspectives, and wave1-plan contracts hold", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_gate_a_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const planRaw = (await (wave1_plan as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: seed wave1 plan",
          },
          makeToolContext(),
        )) as string;
        const plan = parseToolJson(planRaw);
        expect(plan.ok).toBe(true);

        const outRaw = (await (gate_a_evaluate as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate a pass",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect(String((out as any).gate_id)).toBe("A");
        expect(String((out as any).status)).toBe("pass");
        expect(Array.isArray((out as any).warnings)).toBe(true);
        expect(((out as any).warnings as string[]).length).toBe(0);
      });
    });
  });

  test("returns fail with typed warning when scope.json is missing", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_gate_a_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        await writePerspectivesForRun(runRoot, runId);

        const planRaw = (await (wave1_plan as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: seed wave1 plan",
          },
          makeToolContext(),
        )) as string;
        const plan = parseToolJson(planRaw);
        expect(plan.ok).toBe(true);

        await fs.rm(path.join(runRoot, "operator", "scope.json"), { force: true });

        const outRaw = (await (gate_a_evaluate as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate a fail missing scope",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect(String((out as any).status)).toBe("fail");
        expect(((out as any).warnings as string[])).toContain("SCOPE_NOT_FOUND");
      });
    });
  });
});
