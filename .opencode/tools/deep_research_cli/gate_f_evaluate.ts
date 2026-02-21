import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { toPosixPath } from "./citations_lib";
import { resolveCitationsConfig } from "./citations_validate_lib";
import { validateManifestV1 } from "./schema_v1";
import {
  appendAuditJsonl,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
} from "./wave_tools_shared";

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (value as Record<string, unknown>) : {};
}

export const gate_f_evaluate = tool({
  description: "Compute deterministic Gate F metrics from manifest/run-config rollout posture",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; reason: string }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const runConfigPath = path.join(runRoot, "run-config.json");

      let runConfig: Record<string, unknown> | null = null;
      let runConfigPresent = false;
      try {
        const runConfigRaw = await readJson(runConfigPath);
        if (isPlainObject(runConfigRaw)) {
          runConfig = runConfigRaw as Record<string, unknown>;
          runConfigPresent = true;
        }
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          if (e instanceof SyntaxError) {
            return err("INVALID_JSON", "run-config unreadable", { run_config_path: runConfigPath });
          }
          throw e;
        }
      }

      const query = asObject(manifest.query);
      const sensitivity = String(query.sensitivity ?? "").trim();
      const sensitivityNoWeb = sensitivity === "no_web";

      const citationsConfig = resolveCitationsConfig({
        manifest,
        runConfig,
      });

      const citationsMode = citationsConfig.mode;
      const onlineMode = citationsMode === "online";
      const brightDataConfigured = citationsConfig.brightDataEndpoint.trim().length > 0;
      const apifyConfigured = citationsConfig.apifyEndpoint.trim().length > 0;
      const endpointConfigured = brightDataConfigured || apifyConfigured;

      const pass = sensitivityNoWeb || !onlineMode || endpointConfigured;
      const status: "pass" | "fail" = pass ? "pass" : "fail";
      const checkedAt = nowIso();
      const warnings = status === "fail" ? ["ONLINE_ENDPOINT_MISSING"] : [];

      const metrics: Record<string, unknown> = {
        sensitivity_no_web: sensitivityNoWeb ? 1 : 0,
        citations_mode: citationsMode,
        citations_mode_online: onlineMode ? 1 : 0,
        run_config_present: runConfigPresent ? 1 : 0,
        endpoint_configured: endpointConfigured ? 1 : 0,
        brightdata_configured: brightDataConfigured ? 1 : 0,
        apify_configured: apifyConfigured ? 1 : 0,
      };

      const artifactsOut = [toPosixPath(path.relative(runRoot, manifestPath))];
      if (runConfigPresent) artifactsOut.push(toPosixPath(path.relative(runRoot, runConfigPath)));

      const notes = pass
        ? "Gate F passed: rollout safety preconditions satisfied"
        : "Gate F failed: citations online requires brightdata or apify endpoint";

      const update = {
        F: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: artifactsOut,
          warnings,
          notes,
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_f_evaluate.inputs.v1",
        run_id: runId,
        sensitivity,
        citations_mode: citationsMode,
        endpoint_configured: endpointConfigured,
        brightdata_configured: brightDataConfigured,
        apify_configured: apifyConfigured,
        run_config_present: runConfigPresent,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_f_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            warnings,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "F",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
        warnings,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_f_evaluate failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_f_evaluate = gate_f_evaluate;
