import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, wave1_plan } from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_wave1_plan (entity)", () => {
  test("writes deterministic plan artifact under wave-1/wave1-plan.json", async () => {
    await withEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "1",
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
          expect(plan.entries.map((p: any) => p.perspective_id)).toEqual(["p3", "p1", "p2"]);
          expect(plan.entries.map((p: any) => p.output_md)).toEqual(["wave-1/p3.md", "wave-1/p1.md", "wave-1/p2.md"]);
          expect(plan.entries[0]).toMatchObject({
            perspective_id: "p3",
            agent_type: "GrokResearcher",
            output_md: "wave-1/p3.md",
          });
          expect(typeof plan.entries[0].prompt_md).toBe("string");

          const promptMd = String(plan.entries[0].prompt_md ?? "");
          expect(promptMd).toContain("## Scope Contract");
          expect(promptMd).toContain("## Platform Requirements");
          expect(promptMd).toContain("## Tool Policy");
          expect(promptMd).toContain("### Primary");
          expect(promptMd).toContain("### Secondary");
          expect(promptMd).toContain("### Forbidden");
          expect(promptMd).toContain("### Questions");
          expect(promptMd).toContain("### Non-goals");
          expect(promptMd).toContain("- Deliverable:");
          expect(promptMd).toContain("- Time budget minutes:");
          expect(promptMd).toContain("- Depth:");
          expect(promptMd).toContain("- Citation posture:");

          const scopeIndex = promptMd.indexOf("## Scope Contract");
          const questionsIndex = promptMd.indexOf("### Questions");
          const nonGoalsIndex = promptMd.indexOf("### Non-goals");
          const deliverableIndex = promptMd.indexOf("- Deliverable:");
          const timeBudgetIndex = promptMd.indexOf("- Time budget minutes:");
          const depthIndex = promptMd.indexOf("- Depth:");
          const citationPostureIndex = promptMd.indexOf("- Citation posture:");

          expect(scopeIndex).toBeGreaterThanOrEqual(0);
          expect(questionsIndex).toBeGreaterThan(scopeIndex);
          expect(nonGoalsIndex).toBeGreaterThan(questionsIndex);
          expect(deliverableIndex).toBeGreaterThan(nonGoalsIndex);
          expect(timeBudgetIndex).toBeGreaterThan(deliverableIndex);
          expect(depthIndex).toBeGreaterThan(timeBudgetIndex);
          expect(citationPostureIndex).toBeGreaterThan(depthIndex);
        });
      },
    );
  });

  test("returns WAVE_CAP_EXCEEDED when perspectives exceed manifest cap", async () => {
    await withEnv(
      {
        PAI_DR_OPTION_C_ENABLED: "1",
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

          const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
          manifest.limits = {
            ...(manifest.limits ?? {}),
            max_wave1_agents: 1,
          };
          await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

          const p = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
          const content = await fs.readFile(p, "utf8");
          const patched = JSON.parse(content);
          patched.run_id = runId;
          await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(patched, null, 2)}\n`, "utf8");

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
          expect((out as any).error.details.cap).toBe(1);
          expect((out as any).error.details.count).toBe(3);
        });
      },
    );
  });
});
