import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gates_write, stage_advance } from "../../tools/deep_research_cli.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

type ManifestRecord = Record<string, unknown>;
type ErrorRecord = Record<string, unknown>;

type TerminalResult =
  | { status: "finalize"; steps: number; manifest: ManifestRecord; auditEvents: Array<Record<string, unknown>> }
  | { status: "error"; steps: number; manifest: ManifestRecord; error: ErrorRecord }
  | { status: "hard-stop"; steps: number; manifest: ManifestRecord; reason: string };

const FIXTURE_TS = "2026-02-16T00:00:00.000Z";

async function readJsonRecord(filePath: string): Promise<ManifestRecord> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as ManifestRecord;
}

async function readAuditEvents(runRoot: string): Promise<Array<Record<string, unknown>>> {
  const auditPath = path.join(runRoot, "logs", "audit.jsonl");
  try {
    const raw = await fs.readFile(auditPath, "utf8");
    return raw
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function materializeFixtureRun(fixtureId: string, baseDir: string) {
  const src = fixturePath("runs", fixtureId);
  const runRoot = path.join(baseDir, fixtureId);
  await fs.cp(src, runRoot, { recursive: true });

  const manifestPath = path.join(runRoot, "manifest.json");
  const manifest = await readJsonRecord(manifestPath);
  const artifacts = asRecord(manifest.artifacts, "manifest.artifacts");
  artifacts.root = runRoot;
  manifest.updated_at = FIXTURE_TS;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    runRoot,
    manifestPath,
    gatesPath: path.join(runRoot, "gates.json"),
  };
}

function reviewLoopCount(manifest: ManifestRecord): number {
  const stage = asRecord(manifest.stage, "manifest.stage");
  const history = Array.isArray(stage.history) ? stage.history : [];
  return history.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return item.from === "review" && item.to === "synthesis";
  }).length;
}

async function driveToTerminal(args: {
  scenario: string;
  manifestPath: string;
  gatesPath: string;
  runRoot: string;
  maxSteps?: number;
  beforeAdvance?: (state: { step: number; stage: string; manifest: ManifestRecord; runRoot: string }) => Promise<void>;
  hardStop?: (state: { step: number; stage: string; manifest: ManifestRecord }) => string | undefined;
}): Promise<TerminalResult> {
  const maxSteps = args.maxSteps ?? 20;

  for (let step = 0; step < maxSteps; step += 1) {
    const manifest = await readJsonRecord(args.manifestPath);
    const stage = String(asRecord(manifest.stage, "manifest.stage").current ?? "");

    if (stage === "finalize") {
      return {
        status: "finalize",
        steps: step,
        manifest,
        auditEvents: await readAuditEvents(args.runRoot),
      };
    }

    if (args.hardStop) {
      const reason = args.hardStop({ step, stage, manifest });
      if (reason) {
        return { status: "hard-stop", steps: step, manifest, reason };
      }
    }

    if (args.beforeAdvance) {
      await args.beforeAdvance({ step, stage, manifest, runRoot: args.runRoot });
    }

    const raw = (await (stage_advance as any).execute(
      {
        manifest_path: args.manifestPath,
        gates_path: args.gatesPath,
        reason: `smoke:${args.scenario}:step-${step + 1}`,
      },
      makeToolContext(),
    )) as string;

    const out = parseToolJson(raw) as Record<string, unknown>;
    if (!out.ok) {
      return {
        status: "error",
        steps: step + 1,
        manifest,
        error: asRecord(out.error, "stage_advance.error"),
      };
    }
  }

  const manifest = await readJsonRecord(args.manifestPath);
  return {
    status: "hard-stop",
    steps: maxSteps,
    manifest,
    reason: `MAX_STEPS_REACHED:${maxSteps}`,
  };
}

describe("deep_research_fixture_finalize_smoke (smoke)", () => {
  test("init->wave1 missing perspectives returns typed MISSING_ARTIFACT error", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-finalize-happy", base);
        await fs.rm(path.join(run.runRoot, "perspectives.json"), { force: true });

        const outRaw = (await (stage_advance as any).execute(
          {
            manifest_path: run.manifestPath,
            gates_path: run.gatesPath,
            reason: "smoke: init->wave1 missing perspectives",
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw) as Record<string, unknown>;
        expect(out.ok).toBe(false);

        const error = asRecord(out.error, "stage_advance.error");
        expect(String(error.code ?? "")).toBe("MISSING_ARTIFACT");

        const details = asRecord(error.details ?? {}, "error.details");
        expect(String(details.from ?? "")).toBe("init");
        expect(String(details.to ?? "")).toBe("wave1");
        expect(String(details.file ?? "")).toBe("perspectives.json");
      });
    });
  });

  test("happy fixture reaches finalize and records transition + gate audit events", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-finalize-happy", base);

        let gateAWritten = false;
        const result = await driveToTerminal({
          scenario: "m1-finalize-happy",
          ...run,
          beforeAdvance: async ({ step }) => {
            if (step !== 0 || gateAWritten) return;
            gateAWritten = true;
            const gateWriteRaw = (await (gates_write as any).execute(
              {
                gates_path: run.gatesPath,
                inputs_digest: "sha256:m1-smoke-gate-a",
                reason: "smoke: happy fixture gate A audit",
                update: {
                  A: {
                    status: "pass",
                    checked_at: FIXTURE_TS,
                    metrics: { fixture_smoke: 1 },
                    artifacts: ["perspectives.json"],
                    warnings: [],
                    notes: "smoke fixture update",
                  },
                },
              },
              makeToolContext(),
            )) as string;
            expect(parseToolJson(gateWriteRaw).ok).toBe(true);
          },
        });

        expect(result.status).toBe("finalize");
        if (result.status !== "finalize") return;

        const stage = asRecord(result.manifest.stage, "manifest.stage");
        const history = Array.isArray(stage.history) ? stage.history : [];
        const transitions = history.map((entry) => {
          const item = asRecord(entry, "manifest.stage.history[]");
          return `${String(item.from ?? "")}->${String(item.to ?? "")}`;
        });

        expect(String(stage.current)).toBe("finalize");
        expect(String(result.manifest.status)).toBe("completed");
        expect(transitions).toEqual([
          "init->wave1",
          "wave1->pivot",
          "pivot->citations",
          "citations->summaries",
          "summaries->synthesis",
          "synthesis->review",
          "review->finalize",
        ]);

        const gatesDoc = await readJsonRecord(run.gatesPath);
        const gates = asRecord(gatesDoc.gates, "gates.gates");
        expect(String(asRecord(gates.B, "gates.B").status ?? "")).toBe("pass");
        expect(String(asRecord(gates.C, "gates.C").status ?? "")).toBe("pass");
        expect(String(asRecord(gates.D, "gates.D").status ?? "")).toBe("pass");
        expect(String(asRecord(gates.E, "gates.E").status ?? "")).toBe("pass");

        const auditKinds = result.auditEvents.map((event) => String((event as Record<string, unknown>).kind ?? ""));
        expect(auditKinds.includes("manifest_write")).toBe(true);
        expect(auditKinds.includes("gates_write")).toBe(true);

        const stageAdvanceManifestReasons = result.auditEvents
          .filter((event) => String((event as Record<string, unknown>).kind ?? "") === "manifest_write")
          .map((event) => String((event as Record<string, unknown>).reason ?? ""))
          .filter((reason) => reason.startsWith("stage_advance: "));
        expect(stageAdvanceManifestReasons).toEqual([
          "stage_advance: smoke:m1-finalize-happy:step-1",
          "stage_advance: smoke:m1-finalize-happy:step-2",
          "stage_advance: smoke:m1-finalize-happy:step-3",
          "stage_advance: smoke:m1-finalize-happy:step-4",
          "stage_advance: smoke:m1-finalize-happy:step-5",
          "stage_advance: smoke:m1-finalize-happy:step-6",
          "stage_advance: smoke:m1-finalize-happy:step-7",
        ]);
        expect(stageAdvanceManifestReasons.length).toBe(transitions.length);
      });
    });
  });

  test("gate B blocking fixture returns typed GATE_BLOCKED error", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-gate-b-blocks", base);
        const result = await driveToTerminal({ scenario: "m1-gate-b-blocks", ...run, maxSteps: 4 });

        expect(result.status).toBe("error");
        if (result.status !== "error") return;
        expect(String(result.error.code ?? "")).toBe("GATE_BLOCKED");
        const details = asRecord(result.error.details ?? {}, "error.details");
        expect(String(details.gate ?? "")).toBe("B");
      });
    });
  });

  test("gate C blocking fixture returns typed GATE_BLOCKED error", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-gate-c-blocks", base);
        const result = await driveToTerminal({ scenario: "m1-gate-c-blocks", ...run, maxSteps: 4 });

        expect(result.status).toBe("error");
        if (result.status !== "error") return;
        expect(String(result.error.code ?? "")).toBe("GATE_BLOCKED");
        const details = asRecord(result.error.details ?? {}, "error.details");
        expect(String(details.gate ?? "")).toBe("C");
      });
    });
  });

  test("review-loop-one-iteration fixture reaches finalize after one revise cycle", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-review-loop-one-iteration", base);
        let reviewVisits = 0;

        const result = await driveToTerminal({
          scenario: "m1-review-loop-one-iteration",
          ...run,
          beforeAdvance: async ({ stage, runRoot }) => {
            if (stage !== "review") return;
            reviewVisits += 1;
            if (reviewVisits !== 2) return;

            const reviewBundlePath = path.join(runRoot, "review", "review-bundle.json");
            const reviewBundle = await readJsonRecord(reviewBundlePath);
            reviewBundle.decision = "PASS";
            await fs.writeFile(reviewBundlePath, `${JSON.stringify(reviewBundle, null, 2)}\n`, "utf8");
          },
        });

        expect(result.status).toBe("finalize");
        if (result.status !== "finalize") return;
        expect(reviewVisits).toBe(2);
        expect(reviewLoopCount(result.manifest)).toBe(1);
        expect(String(result.manifest.status)).toBe("completed");
      });
    });
  });

  test("review-loop-hit-cap fixture hard-stops when review cap reached", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const run = await materializeFixtureRun("m1-review-loop-hit-cap", base);
        const result = await driveToTerminal({
          scenario: "m1-review-loop-hit-cap",
          ...run,
          maxSteps: 12,
          hardStop: ({ stage, manifest }) => {
            if (stage !== "review") return undefined;
            const limits = asRecord(manifest.limits, "manifest.limits");
            const cap = Number(limits.max_review_iterations ?? 0);
            const loops = reviewLoopCount(manifest);
            if (loops >= cap) {
              return `REVIEW_ITERATION_CAP_REACHED:${loops}/${cap}`;
            }
            return undefined;
          },
        });

        expect(result.status).toBe("hard-stop");
        if (result.status !== "hard-stop") return;
        expect(result.reason.startsWith("REVIEW_ITERATION_CAP_REACHED:")).toBe(true);
      });
    });
  });
});
