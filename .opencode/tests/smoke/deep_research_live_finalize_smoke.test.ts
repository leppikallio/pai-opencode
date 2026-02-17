import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const LIVE_ENV_ENABLED = process.env.PAI_DR_LIVE_TESTS === "1"
  && process.env.PAI_DR_OPTION_C_ENABLED === "1";

const liveSmoke = LIVE_ENV_ENABLED ? test : test.skip;

const FINALIZE_ACCEPTANCE_CRITERIA = [
  "manifest stage is finalize",
  "summaries/summary-pack.json exists",
  "synthesis/final-synthesis.md exists",
  "reports/gate-e-status.json exists",
  "reports/gate-e-status.json indicates pass",
  "gates.json marks Gate E as pass",
  "logs/audit.jsonl exists",
  "review/review-bundle.json exists",
] as const;

type JsonObject = Record<string, unknown>;

async function assertFileExists(runRoot: string, relPath: string): Promise<void> {
  const fullPath = path.join(runRoot, relPath);
  try {
    const st = await fs.stat(fullPath);
    if (!st.isFile()) {
      throw new Error(`artifact is not a file: ${relPath}`);
    }
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`[runRoot=${runRoot}] required artifact check failed for ${relPath}: ${details}`);
  }
}

async function readJsonFromRunRoot<T>(runRoot: string, relPath: string): Promise<T> {
  const fullPath = path.join(runRoot, relPath);
  const raw = await fs.readFile(fullPath, "utf8").catch((err: unknown) => {
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`[runRoot=${runRoot}] failed to read ${relPath}: ${details}`);
  });

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`[runRoot=${runRoot}] failed to parse ${relPath}: ${details}`);
  }
}

function gateStatusFromReport(doc: JsonObject): "pass" | "fail" | undefined {
  if (typeof doc.status === "string") {
    return doc.status === "pass" || doc.status === "fail" ? doc.status : undefined;
  }
  if (typeof doc.pass === "boolean") {
    return doc.pass ? "pass" : "fail";
  }
  return undefined;
}

function gateStatusFromGatesDoc(doc: JsonObject, gateId: string): string | undefined {
  const gates = doc.gates;
  if (gates && typeof gates === "object" && !Array.isArray(gates)) {
    const gate = (gates as JsonObject)[gateId];
    if (gate && typeof gate === "object" && !Array.isArray(gate)) {
      const status = (gate as JsonObject).status;
      return typeof status === "string" ? status : undefined;
    }
  }

  const topLevelGate = doc[gateId];
  if (topLevelGate && typeof topLevelGate === "object" && !Array.isArray(topLevelGate)) {
    const status = (topLevelGate as JsonObject).status;
    return typeof status === "string" ? status : undefined;
  }

  return undefined;
}

describe("deep_research live smoke (finalize skeleton)", () => {
  liveSmoke("TODO: execute live finalize run when orchestrator mode is available", async () => {
    // TODO acceptance criteria:
    // 1) Run full live orchestrator to finalize without direct sub-agent spawning here.
    // 2) Capture absolute run root path in PAI_DR_TEST_RUN_ROOT.
    // 3) Validate all finalize artifacts listed below.
    const runRoot = process.env.PAI_DR_TEST_RUN_ROOT;
    if (!runRoot || !path.isAbsolute(runRoot)) {
      throw new Error(`[runRoot=${runRoot ?? "<unset>"}] PAI_DR_TEST_RUN_ROOT must be an absolute run-root path.`);
    }

    if (FINALIZE_ACCEPTANCE_CRITERIA.length !== 8) {
      throw new Error(`[runRoot=${runRoot}] finalize acceptance criteria drift detected.`);
    }

    await assertFileExists(runRoot, "manifest.json");
    await assertFileExists(runRoot, "gates.json");
    await assertFileExists(runRoot, "summaries/summary-pack.json");
    await assertFileExists(runRoot, "synthesis/final-synthesis.md");
    await assertFileExists(runRoot, "reports/gate-e-status.json");
    await assertFileExists(runRoot, "logs/audit.jsonl");
    await assertFileExists(runRoot, "review/review-bundle.json");

    const manifest = await readJsonFromRunRoot<{ stage?: { current?: string } }>(runRoot, "manifest.json");

    if (manifest.stage?.current !== "finalize") {
      throw new Error(`[runRoot=${runRoot}] expected manifest stage to be finalize, got: ${String(manifest.stage?.current)}`);
    }

    const gateEStatusDoc = await readJsonFromRunRoot<JsonObject>(runRoot, "reports/gate-e-status.json");
    const gateEReportStatus = gateStatusFromReport(gateEStatusDoc);
    expect(gateEReportStatus).toBe("pass");

    const gatesDoc = await readJsonFromRunRoot<JsonObject>(runRoot, "gates.json");
    const gateEStatus = gateStatusFromGatesDoc(gatesDoc, "E");
    if (gateEStatus === undefined) {
      throw new Error(`[runRoot=${runRoot}] gates.json does not expose Gate E status semantics.`);
    }
    expect(gateEStatus).toBe("pass");
  });
});
