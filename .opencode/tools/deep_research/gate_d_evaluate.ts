import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { toPosixPath } from "./citations_lib";
import { validateManifestV1, validatePerspectivesV1 } from "./schema_v1";
import {
  err,
  errorCode,
  getManifestPaths,
  getNumberProp,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
} from "./utils";
import { appendAuditJsonl } from "./wave_tools_shared";
import {
  formatRate,
  resolveArtifactPath,
  resolveRunRootFromManifest,
} from "./phase05_lib";

export const gate_d_evaluate = tool({
  description: "Compute deterministic Gate D metrics from summary artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute path to summary-pack.json"),
    summaries_dir: tool.schema.string().optional().describe("Absolute summaries directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    summary_pack_path?: string;
    summaries_dir?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const summariesDir = resolveArtifactPath(
        args.summaries_dir,
        runRoot,
        typeof artifactPaths.summaries_dir === "string" ? artifactPaths.summaries_dir : undefined,
        "summaries",
      );
      const perspectivesPath = resolveArtifactPath(
        undefined,
        runRoot,
        typeof artifactPaths.perspectives_file === "string" ? artifactPaths.perspectives_file : undefined,
        "perspectives.json",
      );

      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (!path.isAbsolute(summariesDir)) return err("INVALID_ARGS", "summaries_dir must be absolute", { summaries_dir: args.summaries_dir ?? null });

      const summaryPackRaw = await readJson(summaryPackPath);
      if (!isPlainObject(summaryPackRaw) || summaryPackRaw.schema_version !== "summary_pack.v1") {
        return err("SCHEMA_VALIDATION_FAILED", "summary-pack schema_version must be summary_pack.v1", {
          summary_pack_path: summaryPackPath,
        });
      }
      const summaryPackDoc = summaryPackRaw as Record<string, unknown>;
      const entriesRaw = Array.isArray(summaryPackDoc.summaries) ? (summaryPackDoc.summaries as unknown[]) : [];

      let expectedCount = entriesRaw.length;
      try {
        const perspectivesRaw = await readJson(perspectivesPath);
        const pErr = validatePerspectivesV1(perspectivesRaw);
        if (!pErr) {
          const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
          expectedCount = Array.isArray(perspectivesDoc.perspectives) ? perspectivesDoc.perspectives.length : 0;
        }
      } catch {
        // fallback to summary entries length
      }

      const missingSummaries: string[] = [];
      let totalKb = 0;
      let maxKb = 0;
      let existingCount = 0;

      for (const entryRaw of entriesRaw) {
        if (!isPlainObject(entryRaw)) continue;
        const entryObj = entryRaw as Record<string, unknown>;
        const perspectiveId = String(entryObj.perspective_id ?? "").trim() || "unknown";
        const summaryMd = String(entryObj.summary_md ?? "").trim();
        if (!summaryMd) {
          missingSummaries.push(`${perspectiveId}:<missing summary_md>`);
          continue;
        }

        const summaryPath = path.isAbsolute(summaryMd) ? summaryMd : path.join(runRoot, summaryMd);
        try {
          const content = await fs.promises.readFile(summaryPath, "utf8");
          const kb = Buffer.byteLength(content, "utf8") / 1024;
          totalKb += kb;
          if (kb > maxKb) maxKb = kb;
          existingCount += 1;
        } catch (e) {
          if (errorCode(e) === "ENOENT") {
            missingSummaries.push(toPosixPath(path.relative(runRoot, summaryPath)));
            continue;
          }
          throw e;
        }
      }

      const ratio = expectedCount > 0 ? existingCount / expectedCount : 0;
      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxSummaryKbLimit = getNumberProp(limitsObj, "max_summary_kb") ?? Number(limitsObj.max_summary_kb ?? 0);
      const maxTotalSummaryKbLimit = getNumberProp(limitsObj, "max_total_summary_kb") ?? Number(limitsObj.max_total_summary_kb ?? 0);

      const metrics = {
        summary_count_ratio: formatRate(ratio),
        max_summary_kb: formatRate(maxKb),
        total_summary_pack_kb: formatRate(totalKb),
        summary_count: existingCount,
        expected_count: expectedCount,
      };

      const warnings: string[] = [];
      if (missingSummaries.length > 0) warnings.push(`MISSING_SUMMARIES:${missingSummaries.length}`);

      const pass =
        ratio >= 0.9
        && maxKb <= maxSummaryKbLimit
        && totalKb <= maxTotalSummaryKbLimit
        && missingSummaries.length === 0;

      const status: "pass" | "fail" = pass ? "pass" : "fail";
      const checkedAt = nowIso();
      const update = {
        D: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, summaryPackPath)),
            toPosixPath(path.relative(runRoot, summariesDir)),
          ],
          warnings,
          notes: pass
            ? "Gate D passed with bounded summaries"
            : "Gate D failed: boundedness or completeness threshold not met",
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_d_evaluate.inputs.v1",
        run_id: runId,
        summary_pack_path: toPosixPath(path.relative(runRoot, summaryPackPath)),
        entries: entriesRaw,
        metrics,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_d_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            missing_summaries: missingSummaries,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "D",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_d_evaluate failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_d_evaluate = gate_d_evaluate;
