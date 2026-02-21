import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { pivot_decide, run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string) {
  return path.resolve(TEST_DIR, "..", "fixtures", "pivot-decision", name);
}

function makeReport(perspectiveId: string, markdownPath: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    perspective_id: perspectiveId,
    markdown_path: markdownPath,
    words: 400,
    sources: 2,
    missing_sections: [],
    ...overrides,
  };
}

describe("deep_research_pivot_decide (entity)", () => {
  test("writes pivot decision artifact and requires wave2 for P0 gaps", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_pivot_decide_needed_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");

        await fs.copyFile(fixture("p1-gaps-needed.md"), p1Path);
        await fs.copyFile(fixture("p2-gaps-needed.md"), p2Path);

        const outRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [
              { perspective_id: "p2", output_md_path: p2Path },
              { perspective_id: "p1", output_md_path: p1Path },
            ],
            wave1_validation_reports: [
              makeReport("p2", p2Path),
              makeReport("p1", p1Path),
            ],
            reason: "test: pivot decide",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).wave2_required).toBe(true);
        expect((out as any).rule_hit).toBe("Wave2Required.P0");

        const pivotPath = (out as any).pivot_path as string;
        const pivot = JSON.parse(await fs.readFile(pivotPath, "utf8"));

        expect(pivot.schema_version).toBe("pivot_decision.v1");
        expect(pivot.run_id).toBe(runId);
        expect(pivot.wave1.outputs.map((entry: any) => entry.perspective_id)).toEqual(["p1", "p2"]);
        expect(pivot.wave1.outputs.map((entry: any) => entry.output_md)).toEqual(["wave-1/p1.md", "wave-1/p2.md"]);
        expect(pivot.gaps.map((gap: any) => gap.priority)).toEqual(["P0", "P1", "P2"]);
        expect(pivot.decision.wave2_required).toBe(true);
        expect(pivot.decision.wave2_gap_ids).toEqual(["gap_p1_2", "gap_p1_1"]);
      });
    });
  });

  test("produces deterministic artifact ordering for equivalent input permutations", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_pivot_decide_deterministic_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");
        const pivotPath = path.join(runRoot, "pivot.json");

        await fs.copyFile(fixture("p1-gaps-needed.md"), p1Path);
        await fs.copyFile(fixture("p2-gaps-needed.md"), p2Path);

        const firstRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [
              { perspective_id: "p2", output_md_path: p2Path },
              { perspective_id: "p1", output_md_path: p1Path },
            ],
            wave1_validation_reports: [
              makeReport("p2", p2Path),
              makeReport("p1", p1Path),
            ],
            reason: "test: first ordering",
          },
          makeToolContext(),
        )) as string;
        const first = parseToolJson(firstRaw);
        expect(first.ok).toBe(true);
        const firstPivot = JSON.parse(await fs.readFile(pivotPath, "utf8"));

        const secondRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [
              { perspective_id: "p1", output_md_path: p1Path },
              { perspective_id: "p2", output_md_path: p2Path },
            ],
            wave1_validation_reports: [
              makeReport("p1", p1Path),
              makeReport("p2", p2Path),
            ],
            reason: "test: second ordering",
          },
          makeToolContext(),
        )) as string;
        const second = parseToolJson(secondRaw);
        expect(second.ok).toBe(true);
        const secondPivot = JSON.parse(await fs.readFile(pivotPath, "utf8"));

        const { generated_at: _firstGeneratedAt, ...firstStable } = firstPivot;
        const { generated_at: _secondGeneratedAt, ...secondStable } = secondPivot;

        expect(firstStable).toEqual(secondStable);
      });
    });
  });

  test("skips wave2 when no gaps are present", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_pivot_decide_skip_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");

        await fs.copyFile(fixture("no-gaps.md"), p1Path);
        await fs.copyFile(fixture("no-gaps.md"), p2Path);

        const outRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [
              { perspective_id: "p1", output_md_path: p1Path },
              { perspective_id: "p2", output_md_path: p2Path },
            ],
            wave1_validation_reports: [
              makeReport("p1", p1Path),
              makeReport("p2", p2Path),
            ],
            reason: "test: skip wave2",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).wave2_required).toBe(false);
        expect((out as any).rule_hit).toBe("Wave2Skip.NoGaps");

        const pivot = JSON.parse(await fs.readFile(path.join(runRoot, "pivot.json"), "utf8"));
        expect(pivot.decision.wave2_required).toBe(false);
        expect(pivot.decision.wave2_gap_ids).toEqual([]);
        expect(pivot.decision.metrics.total_gaps).toBe(0);
      });
    });
  });

  test("returns deterministic error codes for malformed gaps and unmet wave1 contract", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_pivot_decide_error_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");

        await fs.copyFile(fixture("malformed-gaps.md"), p1Path);
        await fs.copyFile(fixture("no-gaps.md"), p2Path);

        const malformedRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [
              { perspective_id: "p1", output_md_path: p1Path },
              { perspective_id: "p2", output_md_path: p2Path },
            ],
            wave1_validation_reports: [
              makeReport("p1", p1Path),
              makeReport("p2", p2Path),
            ],
            reason: "test: malformed gaps",
          },
          makeToolContext(),
        )) as string;
        const malformed = parseToolJson(malformedRaw);
        expect(malformed.ok).toBe(false);
        expect((malformed as any).error.code).toBe("GAPS_PARSE_FAILED");

        const contractRaw = (await (pivot_decide as any).execute(
          {
            manifest_path: manifestPath,
            wave1_outputs: [{ perspective_id: "p1", output_md_path: p1Path }],
            wave1_validation_reports: [
              makeReport("p1", p1Path, {
                missing_sections: ["Sources"],
              }),
            ],
            reason: "test: unmet contract",
          },
          makeToolContext(),
        )) as string;
        const contract = parseToolJson(contractRaw);
        expect(contract.ok).toBe(false);
        expect((contract as any).error.code).toBe("WAVE1_CONTRACT_NOT_MET");
      });
    });
  });
});
