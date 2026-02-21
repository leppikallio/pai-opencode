import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";

import {
  orchestrator_tick_fixture,
  orchestrator_tick_live,
  orchestrator_tick_post_pivot,
  orchestrator_tick_post_summaries,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

describe("deep_research_orchestrator_tick_* paused handling (entity)", () => {
  test("returns PAUSED for live tick when manifest.status is paused", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_paused_live_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        // Pause by directly editing manifest (manifest_write is tested elsewhere).
        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "paused";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: paused tick",
          drivers: {
            runAgent: async () => ({ markdown: "## Findings\n- should not run\n\n## Sources\n- https://example.com\n\n## Gaps\n- none\n" }),
          },
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("PAUSED");
      });
    });
  });

  test("returns PAUSED for fixture tick when manifest.status is paused", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_paused_fixture_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "paused";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: paused fixture tick",
          fixture_driver: () => ({ wave_outputs: [] }),
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("PAUSED");
      });
    });
  });

  test("returns CANCELLED for live tick when manifest.status is cancelled", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_cancelled_live_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "cancelled";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: cancelled tick",
          drivers: {
            runAgent: async () => ({ markdown: "## Findings\n- should not run\n\n## Sources\n- https://example.com\n\n## Gaps\n- none\n" }),
          },
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("CANCELLED");
      });
    });
  });

  test("returns CANCELLED for fixture tick when manifest.status is cancelled", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_cancelled_fixture_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "cancelled";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_fixture({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: cancelled fixture tick",
          fixture_driver: () => ({ wave_outputs: [] }),
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("CANCELLED");
      });
    });
  });

  test("returns CANCELLED for post-pivot tick when manifest.status is cancelled", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_cancelled_post_pivot_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "cancelled";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: cancelled post-pivot tick",
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("CANCELLED");
      });
    });
  });

  test("returns CANCELLED for post-summaries tick when manifest.status is cancelled", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_tick_cancelled_post_summaries_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifestRaw.status = "cancelled";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

        const out = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: cancelled post-summaries tick",
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("CANCELLED");
      });
    });
  });
});
