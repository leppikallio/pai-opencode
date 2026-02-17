import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const LIVE_ENV_ENABLED = process.env.PAI_DR_LIVE_TESTS === "1"
  && process.env.PAI_DR_OPTION_C_ENABLED === "1";

const liveSmoke = LIVE_ENV_ENABLED ? test : test.skip;

const WAVE1_ACCEPTANCE_CRITERIA = [
  "run-root contains manifest.json and gates.json",
  "wave-1/wave1-plan.json exists after live wave1",
  "wave-review.json exists after live wave1",
  "wave-1 contains at least one perspective markdown",
  "gates.json marks Gate B as pass",
] as const;

const OPTIONAL_WAVE1_ARTIFACTS = ["perspectives.json"] as const;

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

async function assertOptionalFileIfPresent(runRoot: string, relPath: string): Promise<void> {
  const fullPath = path.join(runRoot, relPath);
  try {
    const st = await fs.stat(fullPath);
    if (!st.isFile()) {
      throw new Error(`optional artifact is not a file: ${relPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`[runRoot=${runRoot}] optional artifact check failed for ${relPath}: ${details}`);
  }
}

async function assertWave1MarkdownExists(runRoot: string): Promise<void> {
  try {
    const wave1Entries = await fs.readdir(path.join(runRoot, "wave-1"));
    const perspectiveMarkdown = wave1Entries.filter((name: string) => name.endsWith(".md"));
    if (perspectiveMarkdown.length === 0) {
      throw new Error("no perspective markdown files found in wave-1");
    }
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`[runRoot=${runRoot}] wave-1 markdown assertion failed: ${details}`);
  }
}

describe("deep_research live smoke (wave1 skeleton)", () => {
  liveSmoke("TODO: execute live wave1 run when orchestrator mode is available", async () => {
    // TODO acceptance criteria:
    // 1) Launch orchestrator live mode (no direct sub-agent spawning from this test).
    // 2) Capture absolute run root path in PAI_DR_TEST_RUN_ROOT.
    // 3) Prove the artifact criteria below.
    const runRoot = process.env.PAI_DR_TEST_RUN_ROOT;
    if (!runRoot || !path.isAbsolute(runRoot)) {
      throw new Error(`[runRoot=${runRoot ?? "<unset>"}] PAI_DR_TEST_RUN_ROOT must be an absolute run-root path.`);
    }

    if (WAVE1_ACCEPTANCE_CRITERIA.length !== 5) {
      throw new Error(`[runRoot=${runRoot}] wave1 acceptance criteria drift detected.`);
    }

    await assertFileExists(runRoot, "manifest.json");
    await assertFileExists(runRoot, "gates.json");
    await assertFileExists(runRoot, "wave-1/wave1-plan.json");
    await assertFileExists(runRoot, "wave-review.json");

    for (const relPath of OPTIONAL_WAVE1_ARTIFACTS) {
      await assertOptionalFileIfPresent(runRoot, relPath);
    }

    await assertWave1MarkdownExists(runRoot);

    const gatesDoc = await readJsonFromRunRoot<JsonObject>(runRoot, "gates.json");
    const gateBStatus = gateStatusFromGatesDoc(gatesDoc, "B");
    if (gateBStatus === undefined) {
      throw new Error(`[runRoot=${runRoot}] gates.json does not expose Gate B status semantics.`);
    }
    expect(gateBStatus).toBe("pass");
  });
});
