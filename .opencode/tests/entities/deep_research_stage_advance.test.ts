import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gates_write, run_init, stage_advance } from "../../tools/deep_research_cli.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

type RunContext = {
  runId: string;
  manifestPath: string;
  gatesPath: string;
  runRoot: string;
};

function getStringProp(value: unknown, key: string): string {
  const record = asRecord(value, "tool output");
  const prop = record[key];
  if (typeof prop !== "string") {
    throw new Error(`tool output.${key} must be a string`);
  }
  return prop;
}

function getErrorCode(value: unknown): string {
  const output = asRecord(value, "tool output");
  const error = asRecord(output.error, "tool output.error");
  const code = error.code;
  if (typeof code !== "string") {
    throw new Error("tool output.error.code must be a string");
  }
  return code;
}

function getErrorDetails(value: unknown): Record<string, unknown> {
  const output = asRecord(value, "tool output");
  const error = asRecord(output.error, "tool output.error");
  return asRecord(error.details, "tool output.error.details");
}

function getDecisionInputsDigest(value: unknown): string {
  const details = getErrorDetails(value);
  const decision = asRecord(details.decision, "tool output.error.details.decision");
  const digest = decision.inputs_digest;
  if (typeof digest !== "string") {
    throw new Error("tool output.error.details.decision.inputs_digest must be a string");
  }
  return digest;
}

async function initRun(base: string, runId: string): Promise<RunContext> {
  const initRaw = (await (run_init as any).execute(
    { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = getStringProp(init, "manifest_path");
  const gatesPath = getStringProp(init, "gates_path");
  const runRoot = path.dirname(manifestPath);

  return { runId, manifestPath, gatesPath, runRoot };
}

async function withOptionCRun(runId: string, fn: (ctx: RunContext) => Promise<void>) {
  await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
    await withTempDir(async (base) => {
      await fn(await initRun(base, runId));
    });
  });
}

async function setStage(manifestPath: string, stage: string) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.stage.current = stage;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeJson(absPath: string, value: unknown) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(absPath: string, value: string) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, value, "utf8");
}

async function setGatePass(gatesPath: string, gateId: "B" | "C" | "D" | "E", reason: string) {
  const outRaw = (await (gates_write as any).execute(
    {
      gates_path: gatesPath,
      inputs_digest: `sha256:test-${gateId.toLowerCase()}-pass`,
      reason,
      update: {
        [gateId]: {
          status: "pass",
          checked_at: "2026-02-14T00:00:00Z",
          metrics: {},
          artifacts: [],
          warnings: [],
          notes: "ok",
        },
      },
    },
    makeToolContext(),
  )) as string;
  expect(parseToolJson(outRaw).ok).toBe(true);
}

async function writePivotDecision(runRoot: string, runId: string, wave2Required: boolean, gapIds: string[] = []) {
  await writeJson(path.join(runRoot, "pivot.json"), {
    schema_version: "pivot_decision.v1",
    run_id: runId,
    decision: {
      wave2_required: wave2Required,
      wave2_gap_ids: gapIds,
    },
  });
}

async function writeWaveReviewReport(runRoot: string, runId: string) {
  await writeJson(path.join(runRoot, "wave-review.json"), {
    schema_version: "wave_review.v1",
    run_id: runId,
    ok: true,
    pass: true,
    validated: 1,
    failed: 0,
    results: [
      {
        perspective_id: "standard-1",
        pass: true,
        failure: null,
      },
    ],
    retry_directives: [],
  });
}

async function writeReviewBundle(runRoot: string, runId: string, decision: "PASS" | "CHANGES_REQUIRED" | "MAYBE") {
  await writeJson(path.join(runRoot, "review", "review-bundle.json"), {
    schema_version: "review_bundle.v1",
    run_id: runId,
    decision,
    findings: [],
    directives: [],
  });
}

async function advance(
  manifestPath: string,
  gatesPath: string,
  reason: string,
  requested_next?: string,
  expected_manifest_revision?: number,
) {
  const outRaw = (await (stage_advance as any).execute(
    {
      manifest_path: manifestPath,
      gates_path: gatesPath,
      requested_next,
      expected_manifest_revision,
      reason,
    },
    makeToolContext(),
  )) as string;
  return parseToolJson(outRaw);
}

describe("deep_research_stage_advance (entity)", () => {
  test("advances init -> perspectives when explicitly requested", async () => {
    await withOptionCRun("dr_test_stage_000p", async ({ manifestPath, gatesPath }) => {
      const out = await advance(manifestPath, gatesPath, "test: init -> perspectives", "perspectives");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("init");
      expect(getStringProp(out, "to")).toBe("perspectives");

      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      expect(manifest.stage.current).toBe("perspectives");
      expect(Array.isArray(manifest.stage.history)).toBe(true);
      expect(manifest.stage.history.length).toBe(1);
      expect(manifest.stage.history[0]).toMatchObject({
        from: "init",
        to: "perspectives",
        inputs_digest: expect.any(String),
        gates_revision: expect.any(Number),
      });
    });
  });

  test("advances init -> wave1 when perspectives artifact exists", async () => {
    await withOptionCRun("dr_test_stage_001", async ({ manifestPath, gatesPath, runRoot }) => {
      const p = fixturePath("runs", "p02-stage-advance-init", "perspectives.json");
      await fs.copyFile(p, path.join(runRoot, "perspectives.json"));

      const out = await advance(manifestPath, gatesPath, "test: init -> wave1");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("init");
      expect(getStringProp(out, "to")).toBe("wave1");

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

  test("returns REVISION_MISMATCH when expected_manifest_revision is stale", async () => {
    await withOptionCRun("dr_test_stage_001b", async ({ manifestPath, gatesPath, runRoot }) => {
      const p = fixturePath("runs", "p02-stage-advance-init", "perspectives.json");
      await fs.copyFile(p, path.join(runRoot, "perspectives.json"));

      const out = await advance(
        manifestPath,
        gatesPath,
        "test: stale expected manifest revision",
        "wave1",
        999,
      );
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("REVISION_MISMATCH");
    });
  });

  test("returns deterministic block decision digest for init -> wave1 when perspectives are missing", async () => {
    await withOptionCRun("dr_test_stage_002", async ({ manifestPath, gatesPath }) => {
      const first = await advance(manifestPath, gatesPath, "test: missing perspectives first");
      expect(first.ok).toBe(false);
      expect(getErrorCode(first)).toBe("MISSING_ARTIFACT");

      const second = await advance(manifestPath, gatesPath, "test: missing perspectives second");
      expect(second.ok).toBe(false);
      expect(getErrorCode(second)).toBe("MISSING_ARTIFACT");

      const firstDigest = getDecisionInputsDigest(first);
      const secondDigest = getDecisionInputsDigest(second);
      expect(firstDigest).toBe(secondDigest);
    });
  });

  test("blocks wave1 -> pivot with GATE_BLOCKED when Gate B is not pass", async () => {
    await withOptionCRun("dr_test_stage_006", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "wave1");
      await writeText(path.join(runRoot, "wave-1", "p1.md"), "# wave1 output\n");
      await writeWaveReviewReport(runRoot, runId);

      const out = await advance(manifestPath, gatesPath, "test: wave1 gate blocked");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("GATE_BLOCKED");
      expect(getErrorDetails(out)).toMatchObject({ from: "wave1", to: "pivot", gate: "B" });
    });
  });

  test("blocks wave1 -> pivot with MISSING_ARTIFACT when wave review is absent", async () => {
    await withOptionCRun("dr_test_stage_021", async ({ manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "wave1");
      await writeText(path.join(runRoot, "wave-1", "p1.md"), "# wave1 output\n");
      await setGatePass(gatesPath, "B", "test: gate b pass missing wave review");

      const out = await advance(manifestPath, gatesPath, "test: wave1 missing wave review");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "wave1", to: "pivot", file: "wave-review.json" });
    });
  });

  test("advances wave1 -> pivot when artifacts exist and Gate B passes", async () => {
    await withOptionCRun("dr_test_stage_007", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "wave1");
      await writeText(path.join(runRoot, "wave-1", "p1.md"), "# wave1 output\n");
      await writeWaveReviewReport(runRoot, runId);
      await setGatePass(gatesPath, "B", "test: gate b pass");

      const out = await advance(manifestPath, gatesPath, "test: wave1 -> pivot");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("wave1");
      expect(getStringProp(out, "to")).toBe("pivot");
    });
  });

  test("advances pivot -> wave2 from pivot decision when requested_next is omitted", async () => {
    await withOptionCRun("dr_test_stage_008", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "pivot");
      await writePivotDecision(runRoot, runId, true, []);

      const out = await advance(manifestPath, gatesPath, "test: pivot -> wave2");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("pivot");
      expect(getStringProp(out, "to")).toBe("wave2");
    });
  });

  test("blocks pivot -> citations with MISSING_ARTIFACT when requested_next bypasses missing pivot decision", async () => {
    await withOptionCRun("dr_test_stage_020", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "pivot");

      const out = await advance(manifestPath, gatesPath, "test: pivot requested citations missing pivot", "citations");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "pivot", to: "citations", file: "pivot.json" });
    });
  });

  test("advances pivot -> citations from pivot decision when wave2 is skipped", async () => {
    await withOptionCRun("dr_test_stage_009", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "pivot");
      await writePivotDecision(runRoot, runId, false, []);

      const out = await advance(manifestPath, gatesPath, "test: pivot -> citations skip wave2");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("pivot");
      expect(getStringProp(out, "to")).toBe("citations");
    });
  });

  test("advances wave2 -> citations when wave2 artifacts exist", async () => {
    await withOptionCRun("dr_test_stage_010", async ({ manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "wave2");
      await writeText(path.join(runRoot, "wave-2", "p2.md"), "# wave2 output\n");

      const out = await advance(manifestPath, gatesPath, "test: wave2 -> citations");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("wave2");
      expect(getStringProp(out, "to")).toBe("citations");
    });
  });

  test("blocks citations -> summaries with GATE_BLOCKED when Gate C is not pass", async () => {
    await withOptionCRun("dr_test_stage_011", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "citations");

      const out = await advance(manifestPath, gatesPath, "test: citations gate blocked");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("GATE_BLOCKED");
      expect(getErrorDetails(out)).toMatchObject({ from: "citations", to: "summaries", gate: "C" });
    });
  });

  test("blocks citations -> summaries with MISSING_ARTIFACT when Gate C passes but citations pool is missing", async () => {
    await withOptionCRun("dr_test_stage_018", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "citations");
      await setGatePass(gatesPath, "C", "test: gate c pass missing pool");

      const out = await advance(manifestPath, gatesPath, "test: citations pool missing");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "citations", to: "summaries", file: "citations/citations.jsonl" });
    });
  });

  test("advances citations -> summaries when Gate C passes", async () => {
    await withOptionCRun("dr_test_stage_012", async ({ manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "citations");
      await writeText(path.join(runRoot, "citations", "citations.jsonl"), '{"url":"https://example.com"}\n');
      await setGatePass(gatesPath, "C", "test: gate c pass");

      const out = await advance(manifestPath, gatesPath, "test: citations -> summaries");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("citations");
      expect(getStringProp(out, "to")).toBe("summaries");
    });
  });

  test("blocks summaries -> synthesis with GATE_BLOCKED when Gate D is not pass", async () => {
    await withOptionCRun("dr_test_stage_013", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "summaries");

      const out = await advance(manifestPath, gatesPath, "test: summaries gate blocked");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("GATE_BLOCKED");
      expect(getErrorDetails(out)).toMatchObject({ from: "summaries", to: "synthesis", gate: "D" });
    });
  });

  test("blocks summaries -> synthesis with MISSING_ARTIFACT when Gate D passes but summary pack is missing", async () => {
    await withOptionCRun("dr_test_stage_019", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "summaries");
      await setGatePass(gatesPath, "D", "test: gate d pass missing summary pack");

      const out = await advance(manifestPath, gatesPath, "test: summary pack missing");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "summaries", to: "synthesis", file: "summaries/summary-pack.json" });
    });
  });

  test("advances summaries -> synthesis when Gate D passes and summary pack exists", async () => {
    await withOptionCRun("dr_test_stage_014", async ({ manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "summaries");
      await writeJson(path.join(runRoot, "summaries", "summary-pack.json"), { schema_version: "summary_pack.v1", summaries: [] });
      await setGatePass(gatesPath, "D", "test: gate d pass");

      const out = await advance(manifestPath, gatesPath, "test: summaries -> synthesis");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("summaries");
      expect(getStringProp(out, "to")).toBe("synthesis");
    });
  });

  test("blocks synthesis -> review with MISSING_ARTIFACT when final synthesis is absent", async () => {
    await withOptionCRun("dr_test_stage_015", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "synthesis");

      const out = await advance(manifestPath, gatesPath, "test: synthesis missing final");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "synthesis", to: "review", file: "synthesis/final-synthesis.md" });
    });
  });

  test("advances synthesis -> review when final synthesis exists", async () => {
    await withOptionCRun("dr_test_stage_016", async ({ manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "synthesis");
      await writeText(path.join(runRoot, "synthesis", "final-synthesis.md"), "# final synthesis\n");

      const out = await advance(manifestPath, gatesPath, "test: synthesis -> review");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("synthesis");
      expect(getStringProp(out, "to")).toBe("review");
    });
  });

  test("advances review -> finalize from PASS bundle when requested_next omitted", async () => {
    await withOptionCRun("dr_test_stage_003", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "review");
      await setGatePass(gatesPath, "E", "test: set gate e pass");
      await writeReviewBundle(runRoot, runId, "PASS");

      const out = await advance(manifestPath, gatesPath, "test: review pass auto transition");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("review");
      expect(getStringProp(out, "to")).toBe("finalize");
    });
  });

  test("blocks review -> finalize with GATE_BLOCKED when Gate E is not pass", async () => {
    await withOptionCRun("dr_test_stage_017", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "review");
      await writeReviewBundle(runRoot, runId, "PASS");

      const out = await advance(manifestPath, gatesPath, "test: review gate blocked");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("GATE_BLOCKED");
      expect(getErrorDetails(out)).toMatchObject({ from: "review", to: "finalize", gate: "E" });
    });
  });

  test("advances review -> synthesis from CHANGES_REQUIRED bundle when requested_next omitted", async () => {
    await withOptionCRun("dr_test_stage_004", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "review");
      await writeReviewBundle(runRoot, runId, "CHANGES_REQUIRED");

      const out = await advance(manifestPath, gatesPath, "test: review changes-required auto transition");
      expect(out.ok).toBe(true);
      expect(getStringProp(out, "from")).toBe("review");
      expect(getStringProp(out, "to")).toBe("synthesis");
    });
  });

  test("returns MISSING_ARTIFACT for review transition when review bundle is invalid", async () => {
    await withOptionCRun("dr_test_stage_005", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "review");
      await writeReviewBundle(runRoot, runId, "MAYBE");

      const out = await advance(manifestPath, gatesPath, "test: review invalid bundle");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
    });
  });

  test("blocks review -> synthesis with MISSING_ARTIFACT when requested_next bypasses missing review bundle", async () => {
    await withOptionCRun("dr_test_stage_021", async ({ manifestPath, gatesPath }) => {
      await setStage(manifestPath, "review");

      const out = await advance(manifestPath, gatesPath, "test: review requested synthesis missing bundle", "synthesis");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("MISSING_ARTIFACT");
      expect(getErrorDetails(out)).toMatchObject({ from: "review", to: "synthesis", file: "review/review-bundle.json" });
    });
  });

  test("blocks review -> synthesis when max_review_iterations cap is reached", async () => {
    await withOptionCRun("dr_test_stage_022", async ({ runId, manifestPath, gatesPath, runRoot }) => {
      await setStage(manifestPath, "review");
      await writeReviewBundle(runRoot, runId, "CHANGES_REQUIRED");

      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.limits.max_review_iterations = 1;
      manifest.stage.history = [
        {
          from: "review",
          to: "synthesis",
          ts: "2026-02-14T00:00:00Z",
          reason: "prior revision",
          inputs_digest: "sha256:prior",
          gates_revision: 1,
        },
      ];
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const out = await advance(manifestPath, gatesPath, "test: review cap reached", "synthesis");
      expect(out.ok).toBe(false);
      expect(getErrorCode(out)).toBe("REVIEW_CAP_EXCEEDED");
      expect(getErrorDetails(out)).toMatchObject({ from: "review", to: "synthesis", cap: 1, count: 1 });
    });
  });
});
