import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { resolveRunRootFromManifest } from "./deep_research_shared_lib";
import {
  appendAuditJsonl,
  err,
  errorCode,
  isPlainObject,
  nowIso,
  ok,
  parseJsonSafe,
  readJson,
  validateGatesV1,
  validateManifestV1,
} from "./lifecycle_lib";
import type { ToolWithExecute } from "./lifecycle_lib";
import { manifest_write } from "./manifest_write";
import { atomicWriteText, getStringProp } from "./utils";

type HardGateFailure = {
  gate_id: string;
  gate_name: string;
  gate_notes: string;
};

function sanitizeReason(input: string): string {
  const reason = input.trim();
  if (!reason) return reason;

  if (/http/i.test(reason)) return "[redacted]";

  const redactedUserInfo = reason.replace(
    /([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^@\s/]+)@/g,
    "$1[redacted]@",
  );

  return redactedUserInfo.replace(/([?&](?:token|access_token|sig)=)([^&#\s]+)/gi, "$1[redacted]");
}

function collectHardGateFailures(gatesDoc: Record<string, unknown>): HardGateFailure[] {
  const gates = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
  const out: HardGateFailure[] = [];

  for (const [gateId, gateRaw] of Object.entries(gates)) {
    if (!isPlainObject(gateRaw)) continue;

    const gateClass = String(gateRaw.class ?? "").trim();
    const gateStatus = String(gateRaw.status ?? "").trim();
    if (gateClass !== "hard" || gateStatus !== "fail") continue;

    out.push({
      gate_id: gateId,
      gate_name: String(gateRaw.name ?? "").trim(),
      gate_notes: String(gateRaw.notes ?? "").trim(),
    });
  }

  out.sort((a, b) => a.gate_id.localeCompare(b.gate_id));
  return out;
}

export const fallback_offer = tool({
  description: "Offer deterministic fallback when a hard gate fails",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    reason: tool.schema.string().optional().describe("Optional fallback reason"),
  },
  async execute(args: { manifest_path: string; gates_path: string; reason?: string }) {
    try {
      const manifestRaw = await readJson(args.manifest_path);
      const gatesRaw = await readJson(args.gates_path);

      const manifestValidationErr = validateManifestV1(manifestRaw);
      if (manifestValidationErr) return manifestValidationErr;

      const gatesValidationErr = validateGatesV1(gatesRaw);
      if (gatesValidationErr) return gatesValidationErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const gates = gatesRaw as Record<string, unknown>;
      const hardGateFailures = collectHardGateFailures(gates);

      if (hardGateFailures.length === 0) {
        return err("NO_HARD_GATE_FAIL", "No HARD gate is failed", {
          manifest_path: args.manifest_path,
          gates_path: args.gates_path,
        });
      }

      const failedGate = hardGateFailures[0];
      const reasonInput = (args.reason ?? "").trim();
      const fallbackReasonRaw = reasonInput || failedGate.gate_notes || `Hard gate ${failedGate.gate_id} failed`;
      const fallbackReason = sanitizeReason(fallbackReasonRaw);
      const instruction = "disable Option C and run standard workflow";

      const runRoot = resolveRunRootFromManifest(args.manifest_path, manifest);
      const summaryPath = path.join(runRoot, "logs", "fallback-summary.md");
      const summaryLines = [
        "# Fallback Summary",
        "",
        `- failed_gate_id: ${failedGate.gate_id}`,
        `- failed_gate_name: ${failedGate.gate_name || "unknown"}`,
        `- reason: ${fallbackReason}`,
        `- operator_instruction: ${instruction}`,
        "",
        "Operator instruction: disable Option C and run standard workflow.",
      ];

      await atomicWriteText(summaryPath, `${summaryLines.join("\n")}\n`);

      const existingFailures = Array.isArray(manifest.failures) ? manifest.failures : [];
      const failureEntry = {
        kind: "hard_gate_fallback_offer",
        gate_id: failedGate.gate_id,
        gate_name: failedGate.gate_name,
        reason: fallbackReason,
        summary_path: summaryPath,
        instruction,
        retryable: false,
      };

      const patch = {
        status: "failed",
        failures: [...existingFailures, failureEntry],
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `fallback_offer: ${fallbackReason}`,
      })) as string;

      const parsedWrite = parseJsonSafe(writeRaw);
      if (!parsedWrite.ok || !isPlainObject(parsedWrite.value)) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: parsedWrite.value });
      }

      if (parsedWrite.value.ok !== true) return JSON.stringify(parsedWrite.value, null, 2);

      let auditWritten = false;
      let auditPath: string | null = null;
      try {
        const manifestRunId = getStringProp(manifest, "run_id") ?? "";
        auditPath = path.join(runRoot, "logs", "audit.jsonl");
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "fallback_offer",
            run_id: manifestRunId,
            failed_gate_id: failedGate.gate_id,
            reason: fallbackReason,
            summary_path: summaryPath,
            instruction,
          },
        });
        auditWritten = true;
      } catch {
        auditWritten = false;
      }

      const writeValue = parsedWrite.value;
      return ok({
        failed_gate_id: failedGate.gate_id,
        reason: fallbackReason,
        instruction,
        summary_path: summaryPath,
        manifest_revision: Number(writeValue.new_revision ?? 0),
        audit_written: auditWritten,
        audit_path: auditPath,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path or gates_path not found");
      return err("WRITE_FAILED", "fallback_offer failed", { message: String(e) });
    }
  },
});

export const deep_research_fallback_offer = fallback_offer;
