import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, wave1_plan } from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_wave1_plan (entity)", () => {
  test("writes deterministic plan artifact under wave-1/wave1-plan.json", async () => {
    await withEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "1",
        PAI_DR_MAX_WAVE1_AGENTS: "3",
      },
      async () => {
        await withTempDir(async (base) => {
          const runId = "dr_test_wave1_plan_001";
          const initRaw = (await (run_init as any).execute(
            { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
            makeToolContext(),
          )) as string;
          const init = parseToolJson(initRaw);
          expect(init.ok).toBe(true);

          const manifestPath = (init as any).manifest_path as string;
          const runRoot = path.dirname(manifestPath);

          const p = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
          await fs.copyFile(p, path.join(runRoot, "perspectives.json"));

          const outRaw = (await (wave1_plan as any).execute(
            {
              manifest_path: manifestPath,
              reason: "test: wave1 plan",
            },
            makeToolContext(),
          )) as string;
          const out = parseToolJson(outRaw);

          expect(out.ok).toBe(true);
          expect((out as any).planned).toBe(3);
          expect(typeof (out as any).inputs_digest).toBe("string");

          const planPath = (out as any).plan_path as string;
          expect(planPath).toBe(path.join(runRoot, "wave-1", "wave1-plan.json"));

          const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
          expect(plan.schema_version).toBe("wave1_plan.v1");
          expect(plan.run_id).toBe(runId);
          expect(typeof plan.inputs_digest).toBe("string");
          expect(Array.isArray(plan.entries)).toBe(true);
          expect(plan.entries.length).toBe(3);
          expect(plan.entries.map((p: any) => p.perspective_id)).toEqual(["p1", "p2", "p3"]);
          expect(plan.entries.map((p: any) => p.output_md)).toEqual(["wave-1/p1.md", "wave-1/p2.md", "wave-1/p3.md"]);
          expect(plan.entries[0]).toMatchObject({
            perspective_id: "p1",
            agent_type: "ClaudeResearcher",
            output_md: "wave-1/p1.md",
          });
          expect(typeof plan.entries[0].prompt_md).toBe("string");
        });
      },
    );
  });

  test("returns WAVE_CAP_EXCEEDED when perspectives exceed manifest cap", async () => {
    await withEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "1",
        PAI_DR_MAX_WAVE1_AGENTS: "2",
      },
      async () => {
        await withTempDir(async (base) => {
          const runId = "dr_test_wave1_plan_cap_001";
          const initRaw = (await (run_init as any).execute(
            { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
            makeToolContext(),
          )) as string;
          const init = parseToolJson(initRaw);
          expect(init.ok).toBe(true);

          const manifestPath = (init as any).manifest_path as string;
          const runRoot = path.dirname(manifestPath);

          const p = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
          const content = await fs.readFile(p, "utf8");
          const patched = JSON.parse(content);
          patched.run_id = runId;
          await fs.writeFile(path.join(runRoot, "perspectives.json"), JSON.stringify(patched, null, 2) + "\n", "utf8");

          const outRaw = (await (wave1_plan as any).execute(
            {
              manifest_path: manifestPath,
              reason: "test: wave1 cap exceeded",
            },
            makeToolContext(),
          )) as string;
          const out = parseToolJson(outRaw);

          expect(out.ok).toBe(false);
          expect((out as any).error.code).toBe("WAVE_CAP_EXCEEDED");
          expect((out as any).error.details.cap).toBe(2);
          expect((out as any).error.details.count).toBe(3);
        });
      },
    );
  });
});
