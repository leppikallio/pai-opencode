import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_run_live,
  orchestrator_tick_post_pivot,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validWaveMarkdown(label: string): string {
  const gapsSection = label === "p1"
    ? "- (P0) Missing primary source verification for key claim #verification"
    : "No unresolved gaps.";

  return [
    "## Findings",
    `Deterministic finding for ${label}.`,
    "",
    "## Sources",
    "- https://www.iana.org/domains/reserved",
    "",
    "## Gaps",
    gapsSection,
    "",
  ].join("\n");
}

async function writePerspectives(runRoot: string, runId: string): Promise<void> {
  const fixture = fixturePath("summaries", "phase05", "perspectives.json");
  const raw = JSON.parse(await fs.readFile(fixture, "utf8")) as Record<string, unknown>;
  raw.run_id = runId;
  await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

describe("deep_research wave2 live runAgent seam regression", () => {
  test("live driver fills missing wave2 outputs via runAgent", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_wave2_live_runagent_${Date.now()}`;

        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
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
        const runRoot = path.dirname(manifestPath);
        await writePerspectives(runRoot, runId);

        const toPivot = await orchestrator_run_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "regression: seed pivot",
          max_ticks: 3,
          drivers: {
            runAgent: async ({ perspective_id }) => ({ markdown: validWaveMarkdown(perspective_id) }),
          },
          tool_context: makeToolContext(),
        });
        expect(toPivot.ok).toBe(true);
        if (!toPivot.ok) return;
        expect(toPivot.end_stage).toBe("pivot");

        const toWave2 = await orchestrator_tick_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "regression: pivot to wave2",
          driver: "live",
          tool_context: makeToolContext(),
        });
        expect(toWave2.ok).toBe(true);
        if (!toWave2.ok) return;
        expect(toWave2.to).toBe("wave2");

        const liveCalls: string[] = [];
        const wave2Tick = await orchestrator_tick_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "regression: wave2 live runAgent",
          driver: "live",
          drivers: {
            runAgent: async (input) => {
              const perspective_id = input.perspective_id;
              liveCalls.push(perspective_id);
              return {
                markdown: validWaveMarkdown(`wave2-${perspective_id}`),
                agent_run_id: `live-${perspective_id}`,
              };
            },
          },
          tool_context: makeToolContext(),
        });

        expect(wave2Tick.ok).toBe(true);
        if (!wave2Tick.ok) return;
        expect(wave2Tick.from).toBe("wave2");
        expect(wave2Tick.to).toBe("citations");
        expect(liveCalls.length).toBeGreaterThan(0);

        const wave2Plan = JSON.parse(
          await fs.readFile(path.join(runRoot, "wave-2", "wave2-plan.json"), "utf8"),
        ) as { entries: Array<{ perspective_id: string; output_md: string }> };

        for (const entry of wave2Plan.entries) {
          await expect(fs.stat(path.join(runRoot, entry.output_md))).resolves.toBeDefined();
          await expect(
            fs.stat(path.join(runRoot, "wave-2", `${entry.perspective_id}.meta.json`)),
          ).resolves.toBeDefined();
        }
      });
    });
  });
});
