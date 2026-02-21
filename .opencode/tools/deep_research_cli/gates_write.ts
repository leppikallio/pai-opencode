import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  err,
  errorCode,
  getStringProp,
  nowIso,
  ok,
  readJson,
  validateGatesV1,
} from "./lifecycle_lib";

export const gates_write = tool({
  description: "Atomic gates.json writer with lifecycle rules",
  args: {
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    update: tool.schema.record(tool.schema.string(), tool.schema.unknown()).describe("Gate patch object"),
    inputs_digest: tool.schema.string().describe("Digest of inputs used to compute the update"),
    expected_revision: tool.schema.number().optional().describe("Optional optimistic lock"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { gates_path: string; update: Record<string, unknown>; inputs_digest: string; expected_revision?: number; reason: string }) {
    try {
      const current = await readJson(args.gates_path);
      if (!current || typeof current !== "object") return err("INVALID_JSON", "gates is not an object");
      const cur = current as Record<string, unknown>;

      const curRev = typeof cur.revision === "number" && Number.isFinite(cur.revision) ? cur.revision : 0;

      if (typeof args.expected_revision === "number") {
        const rev = cur.revision;
        if (typeof rev !== "number" || rev !== args.expected_revision) {
          return err("REVISION_MISMATCH", "expected_revision mismatch", { expected: args.expected_revision, got: rev });
        }
      }

      const gatesObj = cur.gates as Record<string, Record<string, unknown>> | undefined;
      if (!gatesObj || typeof gatesObj !== "object") return err("SCHEMA_VALIDATION_FAILED", "gates.gates missing");

      for (const [gateId, patchObj] of Object.entries(args.update)) {
        if (!gatesObj[gateId]) return err("UNKNOWN_GATE_ID", `unknown gate id: ${gateId}`);
        if (!patchObj || typeof patchObj !== "object") return err("INVALID_ARGS", `gate patch must be object: ${gateId}`);

        const allowed = new Set(["status", "checked_at", "metrics", "artifacts", "warnings", "notes"]);
        for (const k of Object.keys(patchObj as Record<string, unknown>)) {
          if (!allowed.has(k)) return err("INVALID_ARGS", `illegal gate patch key '${k}' for ${gateId}`);
        }

        const nextGate = { ...gatesObj[gateId], ...(patchObj as Record<string, unknown>) };
        if (nextGate.class === "hard" && nextGate.status === "warn") {
          return err("LIFECYCLE_RULE_VIOLATION", `hard gate cannot be warn: ${gateId}`);
        }
        if (!nextGate.checked_at) {
          return err("LIFECYCLE_RULE_VIOLATION", `checked_at required on updates: ${gateId}`);
        }
        gatesObj[gateId] = nextGate;
      }

      const nextRev = (typeof cur.revision === "number" ? cur.revision : 0) + 1;
      cur.revision = nextRev;
      cur.updated_at = nowIso();
      cur.inputs_digest = args.inputs_digest;
      cur.gates = gatesObj;

      const vErr = validateGatesV1(cur);
      if (vErr) return vErr;

      await atomicWriteJson(args.gates_path, cur);

      const runRoot = path.dirname(args.gates_path);
      const auditEvent = {
        ts: nowIso(),
        kind: "gates_write",
        run_id: getStringProp(cur, "run_id") ?? "",
        prev_revision: curRev,
        new_revision: nextRev,
        reason: args.reason,
        inputs_digest: args.inputs_digest,
      };
      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ new_revision: nextRev, updated_at: String(cur.updated_at), audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ new_revision: nextRev, updated_at: String(cur.updated_at), audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "gates_path not found");
      return err("WRITE_FAILED", "gates write failed", { message: String(e) });
    }
  },
});
