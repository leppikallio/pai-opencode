import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init, stage_advance } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_stage_advance (entity)", () => {
  test("advances init -> wave1 when perspectives artifact exists", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const fixturePath = path.resolve(
          process.cwd(),
          "tests",
          "fixtures",
          "runs",
          "p02-stage-advance-init",
          "perspectives.json",
        );
        await fs.copyFile(fixturePath, path.join(runRoot, "perspectives.json"));

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: (init as any).gates_path,
            reason: "test",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).from).toBe("init");
        expect((out as any).to).toBe("wave1");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("wave1");
        expect(Array.isArray(manifest.stage.history)).toBe(true);
        expect(manifest.stage.history.length).toBe(1);
        expect(manifest.stage.history[0]).toMatchObject({
          from: "init",
          to: "wave1",
          inputs_digest: expect.any(String),
          gates_revision: expect.any(Number),
        });
      });
    });
  });

  test("returns deterministic block decision digest when perspectives artifact is missing", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;

        const firstRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: (init as any).gates_path,
            reason: "test: missing perspectives first",
          },
          makeToolContext(),
        )) as string;
        const first = parseToolJson(firstRaw);
        expect(first.ok).toBe(false);
        expect((first as any).error.code).toBe("MISSING_ARTIFACT");

        const secondRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: (init as any).gates_path,
            reason: "test: missing perspectives second",
          },
          makeToolContext(),
        )) as string;
        const second = parseToolJson(secondRaw);
        expect(second.ok).toBe(false);
        expect((second as any).error.code).toBe("MISSING_ARTIFACT");

        const firstDigest = (first as any).error.details.decision.inputs_digest;
        const secondDigest = (second as any).error.details.decision.inputs_digest;
        expect(typeof firstDigest).toBe("string");
        expect(firstDigest).toBe(secondDigest);
      });
    });
  });
});
