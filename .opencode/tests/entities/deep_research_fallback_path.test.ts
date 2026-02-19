import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, stage_advance } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function setManifestOptionCEnabled(manifestPath: string, enabled: boolean) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.query ??= {};
  manifest.query.constraints ??= {};
  manifest.query.constraints.option_c ??= {};
  manifest.query.constraints.option_c.enabled = enabled;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function readManifestOptionCEnabled(manifestPath: string): Promise<boolean | undefined> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  return manifest?.query?.constraints?.option_c?.enabled;
}

describe("deep_research_fallback_path (entity)", () => {
  test("run_init stays enabled when Option C env is unset", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: undefined }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_fallback_enabled_unset";
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
        expect(out.ok).toBe(true);

        const runRoot = path.join(base, runId);
        const st = await fs.stat(runRoot);
        expect(st.isDirectory()).toBe(true);
        expect(await readManifestOptionCEnabled(String((out as any).manifest_path))).toBe(true);
      });
    });
  });

  test("run_init stays enabled when Option C env is explicitly 0", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_fallback_enabled_zero";
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
        expect(out.ok).toBe(true);
        expect(await readManifestOptionCEnabled(String((out as any).manifest_path))).toBe(true);
      });
    });
  });

  test("manifest-level disable path preserves existing artifacts", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_fallback_preserve_artifacts";

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

      const runRoot = path.join(base, runId);
      const sentinelPath = path.join(runRoot, "logs", "rollback-sentinel.txt");
      await fs.writeFile(sentinelPath, "preserve-this-artifact", "utf8");
      const manifestPath = String((initOut as any).manifest_path);
      const gatesPath = String((initOut as any).gates_path);
      await setManifestOptionCEnabled(manifestPath, false);

      const outRaw = (await (stage_advance as any).execute(
        {
          manifest_path: manifestPath,
          gates_path: gatesPath,
          requested_next: "wave1",
          reason: "test: manifest-level disable",
        },
        makeToolContext(),
      )) as string;

      const out = parseToolJson(outRaw);
      expect(out.ok).toBe(false);
      expect((out as any).error.code).toBe("DISABLED");
      expect((out as any).error.message).toBe("Option C is disabled");
      expect((out as any).error.details.constraint_path).toBe("manifest.query.constraints.option_c.enabled");
      expect(String((out as any).error.details.instruction)).toContain("No env vars required");

      expect(await fs.readFile(sentinelPath, "utf8")).toBe("preserve-this-artifact");

      const manifest = JSON.parse(await fs.readFile(path.join(runRoot, "manifest.json"), "utf8"));
      const gates = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8"));
      expect(manifest.run_id).toBe(runId);
      expect(gates.run_id).toBe(runId);
    });
  });
});
