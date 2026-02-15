import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gates_write, run_init, stage_advance } from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

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
        const p = fixturePath("runs", "p02-stage-advance-init", "perspectives.json");
        await fs.copyFile(p, path.join(runRoot, "perspectives.json"));

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

  test("advances review -> finalize from PASS bundle when requested_next omitted", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_003";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.stage.current = "review";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const gateWriteRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            inputs_digest: "sha256:test-stage-003",
            reason: "test: set gate e pass",
            update: {
              E: {
                status: "pass",
                checked_at: "2026-02-14T00:00:00Z",
                metrics: { uncited_numeric_claims: 0, report_sections_present: 100 },
                artifacts: [],
                warnings: [],
                notes: "ok",
              },
            },
          },
          makeToolContext(),
        )) as string;
        expect(parseToolJson(gateWriteRaw).ok).toBe(true);

        const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
        await fs.mkdir(path.dirname(reviewBundlePath), { recursive: true });
        await fs.writeFile(
          reviewBundlePath,
          `${JSON.stringify({ schema_version: "review_bundle.v1", run_id: runId, decision: "PASS", findings: [], directives: [] }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: review pass auto transition",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).from).toBe("review");
        expect((out as any).to).toBe("finalize");
      });
    });
  });

  test("advances review -> synthesis from CHANGES_REQUIRED bundle when requested_next omitted", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_004";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.stage.current = "review";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
        await fs.mkdir(path.dirname(reviewBundlePath), { recursive: true });
        await fs.writeFile(
          reviewBundlePath,
          `${JSON.stringify({ schema_version: "review_bundle.v1", run_id: runId, decision: "CHANGES_REQUIRED", findings: [], directives: [] }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: review changes-required auto transition",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).from).toBe("review");
        expect((out as any).to).toBe("synthesis");
      });
    });
  });

  test("returns MISSING_ARTIFACT for review transition when review bundle is invalid", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_stage_005";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.stage.current = "review";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
        await fs.mkdir(path.dirname(reviewBundlePath), { recursive: true });
        await fs.writeFile(
          reviewBundlePath,
          `${JSON.stringify({ schema_version: "review_bundle.v1", run_id: runId, decision: "MAYBE", findings: [], directives: [] }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "test: review invalid bundle",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("MISSING_ARTIFACT");
      });
    });
  });
});
