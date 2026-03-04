import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AlgorithmEvalResult } from "../../skills/utilities/evals/Types/index.ts";
import { updateISCWithResult } from "../../skills/utilities/evals/Tools/AlgorithmBridge.ts";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readIsc(filePath: string): Promise<{ criteria: Array<{ description: string; status: string }> }> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as {
    criteria: Array<{ description: string; status: string }>;
  };
}

function makeResult(overrides: Partial<AlgorithmEvalResult> = {}): AlgorithmEvalResult {
  return {
    isc_row: 1,
    suite: "regression-core",
    passed: true,
    score: 1,
    summary: "1/1 tasks passed",
    run_id: "run-test",
    ...overrides,
  };
}

describe("AlgorithmBridge current-work compatibility", () => {
  test("prefers session mapping over legacy work_dir when session id is available", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-alg-bridge-session-first-"));
    const previousPaiDir = process.env.PAI_DIR;
    const previousSessionId = process.env.OPENCODE_SESSION_ID;

    const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
    const sessionWorkDir = path.join(paiDir, "MEMORY", "WORK", "2026-03", "session-1");
    const legacyWorkDir = path.join(paiDir, "MEMORY", "WORK", "2026-03", "legacy");
    const sessionIscPath = path.join(sessionWorkDir, "ISC.json");
    const legacyIscPath = path.join(legacyWorkDir, "ISC.json");

    try {
      await writeJson(sessionIscPath, { criteria: [] });
      await writeJson(legacyIscPath, { criteria: [] });
      await writeJson(statePath, {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions: {
          "session-1": { work_dir: sessionWorkDir },
        },
        session_id: "session-1",
        work_dir: legacyWorkDir,
      });

      process.env.PAI_DIR = paiDir;
      process.env.OPENCODE_SESSION_ID = "session-1";

      await updateISCWithResult(makeResult());

      const sessionIsc = await readIsc(sessionIscPath);
      const legacyIsc = await readIsc(legacyIscPath);
      expect(sessionIsc.criteria).toHaveLength(1);
      expect(sessionIsc.criteria[0]?.status).toBe("VERIFIED");
      expect(legacyIsc.criteria).toHaveLength(0);
    } finally {
      if (previousPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = previousPaiDir;
      }
      if (previousSessionId === undefined) {
        delete process.env.OPENCODE_SESSION_ID;
      } else {
        process.env.OPENCODE_SESSION_ID = previousSessionId;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("falls back to legacy work_dir when no session id is available", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-alg-bridge-legacy-fallback-"));
    const previousPaiDir = process.env.PAI_DIR;
    const previousSessionId = process.env.OPENCODE_SESSION_ID;
    const previousGenericSessionId = process.env.SESSION_ID;

    const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");
    const legacyWorkDir = path.join(paiDir, "MEMORY", "WORK", "2026-03", "legacy");
    const legacyIscPath = path.join(legacyWorkDir, "ISC.json");

    try {
      await writeJson(legacyIscPath, { criteria: [] });
      await writeJson(statePath, {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions: {
          "session-1": { work_dir: path.join(paiDir, "MEMORY", "WORK", "2026-03", "session-1") },
        },
        work_dir: legacyWorkDir,
      });

      process.env.PAI_DIR = paiDir;
      delete process.env.OPENCODE_SESSION_ID;
      delete process.env.SESSION_ID;

      await updateISCWithResult(makeResult({ passed: false, score: 0, summary: "0/1 failed" }));

      const legacyIsc = await readIsc(legacyIscPath);
      expect(legacyIsc.criteria).toHaveLength(1);
      expect(legacyIsc.criteria[0]?.status).toBe("FAILED");
    } finally {
      if (previousPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = previousPaiDir;
      }
      if (previousSessionId === undefined) {
        delete process.env.OPENCODE_SESSION_ID;
      } else {
        process.env.OPENCODE_SESSION_ID = previousSessionId;
      }
      if (previousGenericSessionId === undefined) {
        delete process.env.SESSION_ID;
      } else {
        process.env.SESSION_ID = previousGenericSessionId;
      }
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
