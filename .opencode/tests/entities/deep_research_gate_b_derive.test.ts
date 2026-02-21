import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const gate_b_derive = ((deepResearch as any).gate_b_derive ??
  (deepResearch as any).deep_research_gate_b_derive) as any | undefined;

async function seedWaveReviewReport(args: {
  reportPath: string;
  pass: boolean;
  failed: number;
  retryDirectives: Array<Record<string, unknown>>;
}) {
  const report = {
    ok: true,
    pass: args.pass,
    perspectives_path: "/tmp/perspectives.json",
    outputs_dir: "/tmp/wave-1",
    validated: 2,
    failed: args.failed,
    results: [
      {
        perspective_id: "p1",
        markdown_path: "/tmp/wave-1/p1.md",
        pass: true,
        metrics: { words: 180, sources: 2, missing_sections: [] },
        failure: null,
      },
      {
        perspective_id: "p2",
        markdown_path: "/tmp/wave-1/p2.md",
        pass: args.pass,
        metrics: { words: 140, sources: 1, missing_sections: args.pass ? [] : ["Risks"] },
        failure: args.pass
          ? null
          : {
            code: "MISSING_REQUIRED_SECTION",
            message: "missing section",
            details: { required_section: "Risks" },
          },
      },
    ],
    retry_directives: args.retryDirectives,
    report: {
      failures_sample: args.pass ? [] : ["p2"],
      failures_omitted: 0,
      notes: args.pass ? "All perspectives passed." : "1/2 perspectives failed.",
    },
    report_path: args.reportPath,
  };

  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

describe("deep_research_gate_b_derive (entity)", () => {
  const maybeTest = gate_b_derive ? test : test.skip;

  maybeTest("derives Gate B PASS when wave_review report satisfies contract", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: "dr_test_gate_b_pass", root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        const reportPath = path.join(runRoot, "wave-review.json");
        await seedWaveReviewReport({
          reportPath,
          pass: true,
          failed: 0,
          retryDirectives: [],
        });

        const outRaw = (await (gate_b_derive as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate b derive pass",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).gate_id).toBe("B");
        expect((out as any).status).toBe("pass");
        expect((out as any).metrics.validated_count).toBe(2);
        expect((out as any).metrics.failed_count).toBe(0);
        expect((out as any).metrics.retry_directives_count).toBe(0);

        const updateB = (out as any).update.B;
        expect(updateB.status).toBe("pass");
        expect(updateB.artifacts).toEqual(["wave-review.json"]);
        expect(updateB.warnings).toEqual([]);
      });
    });
  });

  maybeTest("derives Gate B FAIL when wave_review report violates contract", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: "dr_test_gate_b_fail", root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        const reportPath = path.join(runRoot, "wave-review.json");
        await seedWaveReviewReport({
          reportPath,
          pass: false,
          failed: 1,
          retryDirectives: [
            {
              perspective_id: "p2",
              action: "retry",
              change_note: "add missing section",
              blocking_error_code: "MISSING_REQUIRED_SECTION",
            },
          ],
        });

        const outRaw = (await (gate_b_derive as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate b derive fail",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).gate_id).toBe("B");
        expect((out as any).status).toBe("fail");

        const updateB = (out as any).update.B;
        expect(updateB.status).toBe("fail");
        expect(updateB.warnings).toContain("WAVE_REVIEW_PASS_FALSE");
        expect(updateB.warnings).toContain("FAILED_COUNT_NON_ZERO");
        expect(updateB.warnings).toContain("RETRY_DIRECTIVES_PRESENT");
      });
    });
  });

  maybeTest("rejects wave_review symlink escape via realpath containment", async () => {
    if (process.platform === "win32") return;

    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: "dr_test_gate_b_symlink", root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        const reportPath = path.join(runRoot, "wave-review.json");
        const outsideReportPath = path.join(base, "outside-wave-review.json");

        await seedWaveReviewReport({
          reportPath: outsideReportPath,
          pass: true,
          failed: 0,
          retryDirectives: [],
        });
        await fs.symlink(outsideReportPath, reportPath);

        const outRaw = (await (gate_b_derive as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate b derive symlink escape",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("INVALID_ARGS");
        expect(String((out as any).error.message ?? "")).toContain("realpath escapes run root");
        expect(String((out as any).error.details.wave_review_report_realpath ?? "")).toBe(
          await fs.realpath(outsideReportPath),
        );
      });
    });
  });
});
