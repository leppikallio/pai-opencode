import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  err,
  nowIso,
  ok,
  sha256HexLowerUtf8,
  validatePerspectivesV1,
} from "./wave_tools_shared";

export const perspectives_write = tool({
  description: "Validate and atomically write perspectives.json (perspectives.v1)",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json"),
    value: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("perspectives.v1 JSON payload"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { perspectives_path: string; value: Record<string, unknown>; reason: string }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const reason = args.reason.trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const vErr = validatePerspectivesV1(args.value);
      if (vErr) return vErr;

      await atomicWriteJson(perspectivesPath, args.value);

      const runRoot = path.dirname(perspectivesPath);
      const auditEvent = {
        ts: nowIso(),
        kind: "perspectives_write",
        run_id: String(args.value.run_id ?? ""),
        reason,
        path: perspectivesPath,
        value_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.value))}`,
      };

      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ path: perspectivesPath, audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ path: perspectivesPath, audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      return err("WRITE_FAILED", "perspectives write failed", { message: String(e) });
    }
  },
});
