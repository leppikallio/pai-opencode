import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  containsImmutableManifestPatch,
  err,
  errorCode,
  getStringProp,
  mergePatch,
  nowIso,
  ok,
  readJson,
  sha256HexLowerUtf8,
  validateManifestV1,
} from "./lifecycle_lib";

export const manifest_write = tool({
  description: "Atomic manifest.json writer with revision bump",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    patch: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("JSON Merge Patch (RFC 7396)"),
    expected_revision: tool.schema.number().optional().describe("Optional optimistic lock"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; patch: Record<string, unknown>; expected_revision?: number; reason: string }) {
    try {
      const current = await readJson(args.manifest_path);
      if (!current || typeof current !== "object") return err("INVALID_JSON", "manifest is not an object");
      const cur = current as Record<string, unknown>;

      const immutable = containsImmutableManifestPatch(args.patch);
      if (immutable.length > 0) {
        return err("IMMUTABLE_FIELD", "patch attempts to modify immutable manifest fields", { paths: immutable });
      }

      if (typeof args.expected_revision === "number") {
        const rev = cur.revision;
        if (typeof rev !== "number" || rev !== args.expected_revision) {
          return err("REVISION_MISMATCH", "expected_revision mismatch", { expected: args.expected_revision, got: rev });
        }
      }

      const curRev = typeof cur.revision === "number" && Number.isFinite(cur.revision) ? cur.revision : 0;

      const patched = mergePatch(cur, args.patch);
      if (!patched || typeof patched !== "object") return err("SCHEMA_VALIDATION_FAILED", "patch produced non-object");

      const next = patched as Record<string, unknown>;
      const nextRev = curRev + 1;
      next.revision = nextRev;
      next.updated_at = nowIso();

      const vErr = validateManifestV1(next);
      if (vErr) return vErr;

      await atomicWriteJson(args.manifest_path, next);

      const runRoot = path.dirname(args.manifest_path);
      const auditEvent = {
        ts: nowIso(),
        kind: "manifest_write",
        run_id: getStringProp(next, "run_id") ?? "",
        prev_revision: curRev,
        new_revision: nextRev,
        reason: args.reason,
        patch_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.patch))}`,
      };
      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ new_revision: nextRev, updated_at: String(next.updated_at), audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ new_revision: nextRev, updated_at: String(next.updated_at), audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "manifest write failed", { message: String(e) });
    }
  },
});
