import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gates_write, revision_control, run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function initRun(base: string, runId: string) {
  const initRaw = (await run_init.execute(
    { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);
  const manifestPath = String(init.manifest_path);
  return {
    manifestPath,
    gatesPath: String(init.gates_path),
    runRoot: path.dirname(manifestPath),
  };
}

describe("deep_research_revision_control (entity)", () => {
  test("returns advance when review PASS and Gate E pass", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath, gatesPath, runRoot } = await initRun(base, "dr_test_p05_revision_001");

        const gateWriteRaw = (await gates_write.execute(
          {
            gates_path: gatesPath,
            inputs_digest: "sha256:test",
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
          `${JSON.stringify({ schema_version: "review_bundle.v1", run_id: "dr_test_p05_revision_001", decision: "PASS", findings: [], directives: [] }, null, 2)}\n`,
          "utf8",
        );

        const outRaw = (await revision_control.execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            review_bundle_path: reviewBundlePath,
            current_iteration: 1,
            reason: "test: revision advance",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect(String(out.action)).toBe("advance");
        expect(String(out.next_stage)).toBe("finalize");
      });
    });
  });

  test("returns revise then escalate based on iteration bounds", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath, gatesPath, runRoot } = await initRun(base, "dr_test_p05_revision_002");
        const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
        await fs.mkdir(path.dirname(reviewBundlePath), { recursive: true });
        await fs.writeFile(
          reviewBundlePath,
          `${JSON.stringify({ schema_version: "review_bundle.v1", run_id: "dr_test_p05_revision_002", decision: "CHANGES_REQUIRED", findings: [], directives: [] }, null, 2)}\n`,
          "utf8",
        );

        const reviseRaw = (await revision_control.execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            review_bundle_path: reviewBundlePath,
            current_iteration: 1,
            reason: "test: revision revise",
          },
          makeToolContext(),
        )) as string;
        const revise = parseToolJson(reviseRaw);
        expect(revise.ok).toBe(true);
        expect(String(revise.action)).toBe("revise");
        expect(String(revise.next_stage)).toBe("synthesis");

        const escalateRaw = (await revision_control.execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            review_bundle_path: reviewBundlePath,
            current_iteration: 4,
            reason: "test: revision escalate",
          },
          makeToolContext(),
        )) as string;
        const escalate = parseToolJson(escalateRaw);
        expect(escalate.ok).toBe(true);
        expect(String(escalate.action)).toBe("escalate");
        expect(String(escalate.next_stage)).toBe("review");
      });
    });
  });
});
