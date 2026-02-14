import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { gates_write, run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_gates_write (entity)", () => {
  test("updates a gate, bumps revision, and appends audit", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_gates_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        const gatesPath = (init as any).gates_path as string;
        const runRoot = path.dirname(gatesPath);

        const ts = new Date().toISOString();
        const okRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            expected_revision: 1,
            inputs_digest: "sha256:test",
            reason: "test: gate A pass",
            update: {
              A: { status: "pass", checked_at: ts, notes: "ok" },
            },
          },
          makeToolContext(),
        )) as string;
        const ok = parseToolJson(okRaw);
        expect(ok.ok).toBe(true);
        expect((ok as any).new_revision).toBe(2);
        expect((ok as any).audit_written).toBe(true);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.revision).toBe(2);
        expect(gates.inputs_digest).toBe("sha256:test");
        expect(gates.gates.A.status).toBe("pass");
        expect(gates.gates.A.checked_at).toBe(ts);

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditTxt = await fs.readFile(auditPath, "utf8");
        expect(auditTxt).toContain('"kind":"gates_write"');
        expect(auditTxt).toContain('"reason":"test: gate A pass"');
      });
    });
  });

  test("enforces lifecycle and schema validation with actionable path", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_gates_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        const gatesPath = (init as any).gates_path as string;

        // hard gate cannot warn
        const warnRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            inputs_digest: "sha256:test",
            reason: "test: warn",
            update: { A: { status: "warn", checked_at: new Date().toISOString() } },
          },
          makeToolContext(),
        )) as string;
        const warn = parseToolJson(warnRaw);
        expect(warn.ok).toBe(false);
        expect((warn as any).error.code).toBe("LIFECYCLE_RULE_VIOLATION");

        // checked_at required
        const missingCheckedAtRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            inputs_digest: "sha256:test",
            reason: "test: missing checked_at",
            update: { A: { status: "pass" } },
          },
          makeToolContext(),
        )) as string;
        const missing = parseToolJson(missingCheckedAtRaw);
        expect(missing.ok).toBe(false);
        expect((missing as any).error.code).toBe("LIFECYCLE_RULE_VIOLATION");

        // invalid status should fail schema validation with a path
        const badStatusRaw = (await (gates_write as any).execute(
          {
            gates_path: gatesPath,
            inputs_digest: "sha256:test",
            reason: "test: invalid status",
            update: { A: { status: "OK", checked_at: new Date().toISOString() } },
          },
          makeToolContext(),
        )) as string;
        const bad = parseToolJson(badStatusRaw);
        expect(bad.ok).toBe(false);
        expect((bad as any).error.code).toBe("SCHEMA_VALIDATION_FAILED");
        expect((bad as any).error.details.path).toBe("$.gates.A.status");
      });
    });
  });
});
