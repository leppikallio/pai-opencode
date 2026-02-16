import { describe, expect, test } from "bun:test";

import { run_init, stage_advance } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_stage_advance emergency disable (entity)", () => {
  test("returns DISABLED when PAI_DR_OPTION_C_ENABLED is explicitly 0", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_stage_emergency_disable_001";

      const init = await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
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

        return parseToolJson(initRaw);
      });

      expect(init.ok).toBe(true);

      const out = await withEnv({ PAI_DR_OPTION_C_ENABLED: "0" }, async () => {
        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: String((init as any).manifest_path),
            gates_path: String((init as any).gates_path),
            reason: "test: emergency disable",
          },
          makeToolContext(),
        )) as string;

        return parseToolJson(outRaw);
      });

      expect(out.ok).toBe(false);
      expect((out as any).error.code).toBe("DISABLED");
      expect((out as any).error.message).toBe("Option C is disabled");
      expect((out as any).error.details.env).toEqual({ PAI_DR_OPTION_C_ENABLED: "0" });
      expect(String((out as any).error.details.instruction)).toContain("standard workflow");
    });
  });
});
