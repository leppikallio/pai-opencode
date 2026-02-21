import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_post_summaries,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

type StubTool = {
  execute: () => Promise<string>;
};

function okTool(payload: Record<string, unknown>): StubTool {
  return {
    async execute() {
      return JSON.stringify({ ok: true, ...payload }, null, 2);
    },
  };
}

describe("deep_research Gate F evaluate wiring (regression)", () => {
  test("review tick reaches finalize by evaluating and persisting Gate F", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_gate_f_wire_${Date.now()}`;
        const initRaw = (await (run_init as any).execute(
          {
            query: "regression:gate-f-wiring",
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

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
        manifest.status = "running";
        manifest.stage = { ...(manifest.stage ?? {}), current: "review" };
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
        await fs.mkdir(path.dirname(reviewBundlePath), { recursive: true });
        await fs.writeFile(
          reviewBundlePath,
          `${JSON.stringify({ decision: "PASS", reviewers: [] }, null, 2)}\n`,
          "utf8",
        );

        const tick = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: gate-f wiring",
          review_factory_run_tool: okTool({
            review_bundle_path: reviewBundlePath,
            decision: "PASS",
          }) as any,
          gate_e_reports_tool: okTool({ output_dir: path.join(runRoot, "reports") }) as any,
          gate_e_evaluate_tool: okTool({
            gate_id: "E",
            status: "pass",
            metrics: {},
            warnings: [],
            update: {
              E: {
                status: "pass",
                checked_at: "2026-02-21T00:00:00.000Z",
                metrics: {},
                artifacts: [],
                warnings: [],
                notes: "stub",
              },
            },
            inputs_digest: "sha256:stub-gate-e",
          }) as any,
          revision_control_tool: okTool({ action: "APPROVED" }) as any,
          tool_context: makeToolContext(),
        });

        expect(tick.ok).toBe(true);
        if (!tick.ok) return;

        const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
        expect(manifestAfter.stage?.current).toBe("finalize");

        const gatesAfter = JSON.parse(await fs.readFile(gatesPath, "utf8")) as any;
        expect(gatesAfter.gates?.F?.status).toBe("pass");
      });
    });
  });
});
