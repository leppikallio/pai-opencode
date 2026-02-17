import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type OrchestratorLiveRunAgentInput,
  orchestrator_run_live,
  run_init,
} from "../../tools/deep_research.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdown(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label}.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    "- (P1) Need deeper evidence",
    "",
  ].join("\n");
}

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<string> {
  const fixture = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;

  const target = path.join(runRoot, "perspectives.json");
  await fs.writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return target;
}

describe("deep_research_orchestrator_run_live (entity)", () => {
  test("loops ticks until pivot and returns run summary", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_run_live_001";

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

        await writePerspectivesForRun(runRoot, runId);

        const out = await orchestrator_run_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator run live",
          max_ticks: 3,
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({
              markdown: validMarkdown(input.perspective_id),
            }),
          },
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;

        expect(out.run_id).toBe(runId);
        expect(out.start_stage).toBe("init");
        expect(out.end_stage).toBe("pivot");
        expect(out.ticks_executed).toBeGreaterThan(0);
        expect(out.ticks_executed).toBeLessThanOrEqual(3);
        expect(typeof out.decision_inputs_digest).toBe("string");

        const waveReviewPath = path.join(runRoot, "wave-review.json");
        await expect(fs.stat(waveReviewPath)).resolves.toBeDefined();

        const gatesDoc = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gatesDoc.gates.B.status).toBe("pass");
      });
    });
  });
});
