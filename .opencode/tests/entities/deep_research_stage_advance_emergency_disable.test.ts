import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";

import { run_init, stage_advance } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withTempDir } from "../helpers/dr-harness";

async function disableOptionCInManifest(manifestPath: string) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.query ??= {};
  manifest.query.constraints ??= {};
  manifest.query.constraints.deep_research_cli ??= {};
  manifest.query.constraints.deep_research_cli.enabled = false;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("deep_research_stage_advance emergency disable (entity)", () => {
  test("returns DISABLED when manifest deep_research_cli.enabled is false", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_stage_emergency_disable_001";

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
      await disableOptionCInManifest(String((init as any).manifest_path));

      const outRaw = (await (stage_advance as any).execute(
        {
          manifest_path: String((init as any).manifest_path),
          gates_path: String((init as any).gates_path),
          requested_next: "wave1",
          reason: "test: emergency disable",
        },
        makeToolContext(),
      )) as string;
      const out = parseToolJson(outRaw);

      expect(out.ok).toBe(false);
      expect((out as any).error.code).toBe("DISABLED");
      expect((out as any).error.message).toBe("Option C is disabled");
      expect((out as any).error.details.constraint_path).toBe("manifest.query.constraints.deep_research_cli.enabled");
      expect(String((out as any).error.details.instruction)).toContain("No env vars required");
      expect((out as any).error.details.env).toBeUndefined();
    });
  });
});
