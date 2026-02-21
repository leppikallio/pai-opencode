import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { fallback_offer, gates_write, run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_fallback_offer_hard_gate (entity)", () => {
  test("writes fallback summary and marks manifest failed when a hard gate fails", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_fallback_offer_hard_gate_001";

        const initRaw = (await (run_init as any).execute(
          {
            query: "Fallback offer hard-gate test",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const gatesPath = (init as any).gates_path as string;
        const runRoot = path.join(base, runId);

        const gateFailRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            expected_revision: 1,
            inputs_digest: "sha256:fallback-offer-test",
            reason: "test: force hard fail",
            update: {
              A: {
                status: "fail",
                checked_at: "2026-02-16T10:00:00.000Z",
                notes: "deterministic hard-gate failure",
              },
            },
          },
          makeToolContext(),
        )) as string;
        const gateFail = parseToolJson(gateFailRaw);
        expect(gateFail.ok).toBe(true);

        const outRaw = (await (fallback_offer as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: "Gate A failed in deterministic test",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).failed_gate_id).toBe("A");

        const summaryPath = path.join(runRoot, "logs", "fallback-summary.md");
        const summary = await fs.readFile(summaryPath, "utf8");
        expect(summary).toContain("- failed_gate_id: A");
        expect(summary).toContain("- reason: Gate A failed in deterministic test");
        expect(summary).toContain("disable Option C and run standard workflow");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.status).toBe("failed");

        const failureEntry = Array.isArray(manifest.failures)
          ? manifest.failures.find((entry: unknown) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
            const candidate = entry as Record<string, unknown>;
            return candidate.kind === "hard_gate_fallback_offer" && candidate.gate_id === "A";
          })
          : undefined;

        expect(failureEntry).toBeDefined();
        const failure = failureEntry as Record<string, unknown>;
        expect(failure.summary_path).toBe(summaryPath);
      });
    });
  });
});
