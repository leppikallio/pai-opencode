import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gate_e_evaluate, run_init } from "../../tools/deep_research.ts";
import { asRecord, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_gate_e_evaluate (entity)", () => {
  test("counts paywalled as validated for utilization and emits soft warnings", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_gate_e_001";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${[
            JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" }),
            JSON.stringify({ cid: "cid_b", status: "paywalled", normalized_url: "https://b.test" }),
            JSON.stringify({ cid: "cid_c", status: "invalid", normalized_url: "https://c.test" }),
          ].join("\n")}\n`,
          "utf8",
        );

        await fs.mkdir(path.join(runRoot, "synthesis"), { recursive: true });
        await fs.writeFile(
          path.join(runRoot, "synthesis", "final-synthesis.md"),
          [
            "## Summary",
            "Revenue grew 20% [@cid_a]",
            "",
            "## Key Findings",
            "- Segment mix changed [@cid_a]",
            "- Regional note [@cid_b]",
            "",
            "## Evidence",
            "Support [@cid_a] [@cid_b]",
            "",
            "## Caveats",
            "Limited period.",
            "",
          ].join("\n"),
          "utf8",
        );

        const outRaw = (await gate_e_evaluate.execute(
          { manifest_path: manifestPath, reason: "test: gate e" },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        const metrics = asRecord(out.metrics, "metrics");
        const warnings = out.warnings;
        expect(out.ok).toBe(true);
        expect(String(out.status)).toBe("pass");
        expect(Number(metrics.citation_utilization_rate)).toBe(1);
        expect(Number(metrics.duplicate_citation_rate)).toBeGreaterThan(0.2);
        expect(Array.isArray(warnings)).toBe(true);
        if (!Array.isArray(warnings)) throw new Error("warnings must be an array");
        expect(warnings.length).toBeGreaterThan(0);
      });
    });
  });

  test("fails hard metric when uncited numeric claim exists", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p05_gate_e_002";
        const initRaw = (await run_init.execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String(init.manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" })}\n`,
          "utf8",
        );

        await fs.writeFile(
          path.join(runRoot, "synthesis", "final-synthesis.md"),
          [
            "## Summary",
            "Revenue grew 20%", // uncited numeric claim
            "",
            "## Key Findings",
            "- finding",
            "",
            "## Evidence",
            "line [@cid_a]",
            "",
            "## Caveats",
            "line",
          ].join("\n"),
          "utf8",
        );

        const outRaw = (await gate_e_evaluate.execute(
          { manifest_path: manifestPath, reason: "test: gate e uncited" },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        const metrics = asRecord(out.metrics, "metrics");
        expect(out.ok).toBe(true);
        expect(String(out.status)).toBe("fail");
        expect(Number(metrics.uncited_numeric_claims)).toBeGreaterThan(0);
      });
    });
  });
});
