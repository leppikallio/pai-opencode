import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { retry_record, run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_retry_record (entity)", () => {
  test("records retry history and enforces per-gate retry cap", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_retry_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        const firstRaw = (await (retry_record as any).execute(
          {
            manifest_path: manifestPath,
            gate_id: "C",
            change_note: "switch to alternate retrieval layer",
            reason: "test: first C retry",
          },
          makeToolContext(),
        )) as string;
        const first = parseToolJson(firstRaw);
        expect(first.ok).toBe(true);
        expect((first as any).retry_count).toBe(1);
        expect((first as any).max_retries).toBe(1);
        expect((first as any).attempt).toBe(1);

        const secondRaw = (await (retry_record as any).execute(
          {
            manifest_path: manifestPath,
            gate_id: "C",
            change_note: "tighten validation further",
            reason: "test: second C retry",
          },
          makeToolContext(),
        )) as string;
        const second = parseToolJson(secondRaw);
        expect(second.ok).toBe(false);
        expect((second as any).error.code).toBe("RETRY_EXHAUSTED");
        expect((second as any).error.details.retry_count).toBe(1);
        expect((second as any).error.details.max_retries).toBe(1);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.metrics.retry_counts.C).toBe(1);
        expect(Array.isArray(manifest.metrics.retry_history)).toBe(true);
        expect(manifest.metrics.retry_history.length).toBe(1);
        expect(manifest.metrics.retry_history[0]).toMatchObject({
          gate_id: "C",
          attempt: 1,
          change_note: "switch to alternate retrieval layer",
          reason: "test: first C retry",
        });
        expect(typeof manifest.metrics.retry_history[0].ts).toBe("string");

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditTxt = await fs.readFile(auditPath, "utf8");
        expect(auditTxt).toContain('"kind":"manifest_write"');
        expect(auditTxt).toContain('"reason":"retry_record(C#1): test: first C retry"');
      });
    });
  });
});
