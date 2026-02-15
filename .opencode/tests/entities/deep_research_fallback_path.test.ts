import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const DISABLED_CODE = "DISABLED";
const DISABLED_MESSAGE = "Deep research Option C is disabled";
const DISABLED_HINT = "Set PAI_DR_OPTION_C_ENABLED=1 to enable.";

function assertDisabledContract(out: Record<string, unknown>) {
  expect(out.ok).toBe(false);
  expect((out as any).error.code).toBe(DISABLED_CODE);
  expect((out as any).error.message).toBe(DISABLED_MESSAGE);
  expect((out as any).error.details.hint).toBe(DISABLED_HINT);
}

describe("deep_research_fallback_path (entity)", () => {
  test("returns deterministic DISABLED contract when Option C is unset", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: undefined }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_fallback_disabled_unset";
        const outRaw = (await (run_init as any).execute(
          {
            query: "Fallback deterministic check",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        assertDisabledContract(out as Record<string, unknown>);

        const runRoot = path.join(base, runId);
        const st = await fs.stat(runRoot).catch(() => null);
        expect(st).toBeNull();
      });
    });
  });

  test("returns deterministic DISABLED contract when Option C is explicitly 0", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_fallback_disabled_zero";
        const outRaw = (await (run_init as any).execute(
          {
            query: "Fallback deterministic check",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        assertDisabledContract(out as Record<string, unknown>);
      });
    });
  });

  test("rollback disable path preserves existing artifacts", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_fallback_preserve_artifacts";

      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
        const initRaw = (await (run_init as any).execute(
          {
            query: "Create artifacts before rollback",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const initOut = parseToolJson(initRaw);
        expect(initOut.ok).toBe(true);
      });

      const runRoot = path.join(base, runId);
      const sentinelPath = path.join(runRoot, "logs", "rollback-sentinel.txt");
      await fs.writeFile(sentinelPath, "preserve-this-artifact", "utf8");

      await withEnv({ PAI_DR_OPTION_C_ENABLED: "0" }, async () => {
        const outRaw = (await (run_init as any).execute(
          {
            query: "Attempt run while disabled",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        assertDisabledContract(out as Record<string, unknown>);
      });

      expect(await fs.readFile(sentinelPath, "utf8")).toBe("preserve-this-artifact");

      const manifest = JSON.parse(await fs.readFile(path.join(runRoot, "manifest.json"), "utf8"));
      const gates = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8"));
      expect(manifest.run_id).toBe(runId);
      expect(gates.run_id).toBe(runId);
    });
  });
});
