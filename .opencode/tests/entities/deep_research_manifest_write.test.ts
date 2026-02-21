import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { manifest_write, run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_manifest_write (entity)", () => {
  test("bumps revision, enforces optimistic lock, and appends audit", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_manifest_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);

        const okRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            expected_revision: 1,
            reason: "test: set running",
            patch: { status: "running" },
          },
          makeToolContext(),
        )) as string;
        const ok = parseToolJson(okRaw);
        expect(ok.ok).toBe(true);
        expect((ok as any).new_revision).toBe(2);
        expect((ok as any).audit_written).toBe(true);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.revision).toBe(2);
        expect(manifest.status).toBe("running");

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditTxt = await fs.readFile(auditPath, "utf8");
        expect(auditTxt).toContain('"kind":"manifest_write"');
        expect(auditTxt).toContain('"reason":"test: set running"');

        // optimistic lock mismatch
        const mismatchRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            expected_revision: 999,
            reason: "test: mismatch",
            patch: { status: "paused" },
          },
          makeToolContext(),
        )) as string;
        const mismatch = parseToolJson(mismatchRaw);
        expect(mismatch.ok).toBe(false);
        expect((mismatch as any).error.code).toBe("REVISION_MISMATCH");
      });
    });
  });

  test("rejects immutable patch fields and returns actionable errors", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_manifest_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        const manifestPath = (init as any).manifest_path as string;

        // immutable
        const immRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: immutable",
            patch: { revision: 123 },
          },
          makeToolContext(),
        )) as string;
        const imm = parseToolJson(immRaw);
        expect(imm.ok).toBe(false);
        expect((imm as any).error.code).toBe("IMMUTABLE_FIELD");
        expect(JSON.stringify((imm as any).error.details.paths)).toContain("$.revision");

        // actionable validation error
        const badRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: invalid status",
            patch: { status: "NOPE" },
          },
          makeToolContext(),
        )) as string;
        const bad = parseToolJson(badRaw);
        expect(bad.ok).toBe(false);
        expect((bad as any).error.code).toBe("SCHEMA_VALIDATION_FAILED");
        expect((bad as any).error.details.path).toBe("$.status");
      });
    });
  });

  test("writes audit under manifest artifacts root when it differs", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_manifest_003";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const legacyRunRoot = path.dirname(manifestPath);
        const externalRoot = path.join(base, "external-artifacts-root");
        await fs.mkdir(externalRoot, { recursive: true });

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.artifacts.root = externalRoot;
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const writeRaw = (await (manifest_write as any).execute(
          {
            manifest_path: manifestPath,
            expected_revision: 1,
            reason: "test: external artifacts root",
            patch: { status: "running" },
          },
          makeToolContext(),
        )) as string;
        const write = parseToolJson(writeRaw);
        expect(write.ok).toBe(true);
        expect((write as any).audit_written).toBe(true);

        const externalAuditPath = path.join(externalRoot, "logs", "audit.jsonl");
        const externalAuditTxt = await fs.readFile(externalAuditPath, "utf8");
        expect(externalAuditTxt).toContain('"kind":"manifest_write"');
        expect(externalAuditTxt).toContain('"reason":"test: external artifacts root"');

        const legacyAuditPath = path.join(legacyRunRoot, "logs", "audit.jsonl");
        const legacyAuditStat = await fs.stat(legacyAuditPath).catch(() => null);
        expect(legacyAuditStat).toBeNull();
      });
    });
  });
});
