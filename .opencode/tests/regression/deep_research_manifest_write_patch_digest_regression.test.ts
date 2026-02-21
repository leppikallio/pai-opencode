import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { manifest_write, run_init } from "../../tools/deep_research_cli.ts";
import { sha256DigestForJson } from "../../tools/deep_research_cli/wave_tools_shared";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_manifest_write patch_digest canonicalization (regression)", () => {
  test("records identical patch_digest for semantically-equal patch objects", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_manifest_patch_digest_regression";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        const patchA = { metrics: { alpha: 1, beta: { x: 1, y: 2 } } };
        const patchB = { metrics: { beta: { y: 2, x: 1 }, alpha: 1 } };

        const writeARaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            expected_revision: 1,
            reason: "test: patch digest canonicalization a",
            patch: patchA,
          },
          makeToolContext(),
        )) as string;
        const writeA = parseToolJson(writeARaw);
        expect(writeA.ok).toBe(true);

        const writeBRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            expected_revision: 2,
            reason: "test: patch digest canonicalization b",
            patch: patchB,
          },
          makeToolContext(),
        )) as string;
        const writeB = parseToolJson(writeBRaw);
        expect(writeB.ok).toBe(true);

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditTxt = await fs.readFile(auditPath, "utf8");
        const auditEntries = auditTxt
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .map((line: string) => JSON.parse(line) as Record<string, unknown>)
          .filter((entry: Record<string, unknown>) => String(entry.kind ?? "") === "manifest_write");

        expect(auditEntries.length).toBeGreaterThanOrEqual(2);

        const digestA = String(auditEntries[0]?.patch_digest ?? "");
        const digestB = String(auditEntries[1]?.patch_digest ?? "");

        expect(digestA).toBe(sha256DigestForJson(patchA));
        expect(digestB).toBe(sha256DigestForJson(patchB));
        expect(digestA).toBe(digestB);
      });
    });
  });
});
