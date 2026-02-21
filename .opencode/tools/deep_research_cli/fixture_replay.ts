import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { appendAuditJsonl } from "./citations_lib";
import {
  FIXTURE_BUNDLE_REQUIRED_REL_PATHS,
  FIXTURE_BUNDLE_SCHEMA_VERSION,
  FIXTURE_REPLAY_REPORT_SCHEMA_VERSION,
  GATE_E_REPORT_REL_PATHS,
  atomicWriteCanonicalJson,
  bundlePath,
  normalizeWarningList,
  parseToolResult,
  sha256DigestForFile,
  sortedLex,
  stringArraysEqual,
} from "./deep_research_shared_lib";
import { gate_e_evaluate } from "./gate_e_evaluate";
import { gate_e_reports } from "./gate_e_reports";
import { validateGatesV1, validateManifestV1 } from "./schema_v1";
import type { ToolWithExecute } from "./types";
import {
  err,
  errorCode,
  isPlainObject,
  nowIso,
  ok,
  readJson,
} from "./utils";
import { statPath } from "./wave_tools_io";

export const fixture_replay = tool({
  description: "Replay fixture bundle and recompute Gate E deterministically",
  args: {
    bundle_root: tool.schema.string().describe("Absolute fixture bundle root path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { bundle_root: string; reason: string }) {
    try {
      const bundleRoot = args.bundle_root.trim();
      const reason = args.reason.trim();
      if (!bundleRoot || !path.isAbsolute(bundleRoot)) return err("INVALID_ARGS", "bundle_root must be absolute", { bundle_root: args.bundle_root });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const rootStat = await statPath(bundleRoot);
      if (!rootStat?.isDirectory()) return err("BUNDLE_INVALID", "bundle_root not found or not a directory", { bundle_root: bundleRoot });

      const requiredRelPaths = sortedLex([...FIXTURE_BUNDLE_REQUIRED_REL_PATHS]);
      const missing: string[] = [];
      const invalid: string[] = [];
      for (const relPath of requiredRelPaths) {
        const abs = bundlePath(bundleRoot, relPath);
        const st = await statPath(abs);
        if (!st) {
          missing.push(relPath);
          continue;
        }
        if (!st.isFile()) invalid.push(relPath);
      }
      if (missing.length > 0 || invalid.length > 0) {
        return err("BUNDLE_INVALID", "fixture bundle missing required files", {
          missing,
          invalid,
        });
      }

      const bundleJsonPath = bundlePath(bundleRoot, "bundle.json");
      const manifestPath = bundlePath(bundleRoot, "manifest.json");
      const gatesPath = bundlePath(bundleRoot, "gates.json");
      const synthesisPath = bundlePath(bundleRoot, "synthesis/final-synthesis.md");
      const citationsPath = bundlePath(bundleRoot, "citations/citations.jsonl");

      const bundleRaw = await readJson(bundleJsonPath);
      if (!isPlainObject(bundleRaw)) {
        return err("BUNDLE_INVALID", "bundle.json must be an object", {
          path: bundleJsonPath,
        });
      }
      const bundleDoc = bundleRaw as Record<string, unknown>;
      const bundleSchema = String(bundleDoc.schema_version ?? "").trim();
      const bundleId = String(bundleDoc.bundle_id ?? "").trim();
      const bundleRunId = String(bundleDoc.run_id ?? "").trim();
      const noWeb = bundleDoc.no_web;
      const includedPaths = Array.isArray(bundleDoc.included_paths)
        ? (bundleDoc.included_paths as unknown[]).map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
        : [];

      const invalidBundleFields: string[] = [];
      if (bundleSchema !== FIXTURE_BUNDLE_SCHEMA_VERSION) invalidBundleFields.push("bundle.json.schema_version");
      if (!bundleId) invalidBundleFields.push("bundle.json.bundle_id");
      if (!bundleRunId) invalidBundleFields.push("bundle.json.run_id");
      if (noWeb !== true) invalidBundleFields.push("bundle.json.no_web");
      if (includedPaths.length === 0) invalidBundleFields.push("bundle.json.included_paths");
      if (includedPaths.length > 0 && !isSortedLex(includedPaths)) invalidBundleFields.push("bundle.json.included_paths(order)");

      const includedSet = new Set(includedPaths);
      const missingInIncluded = requiredRelPaths.filter((relPath) => !includedSet.has(relPath));
      if (invalidBundleFields.length > 0 || missingInIncluded.length > 0) {
        return err("BUNDLE_INVALID", "bundle metadata validation failed", {
          invalid: invalidBundleFields,
          missing_in_included_paths: missingInIncluded,
        });
      }

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;

      const gatesRaw = await readJson(gatesPath);
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;
      const gatesDoc = gatesRaw as Record<string, unknown>;

      const manifestRunId = String(manifest.run_id ?? "").trim();
      const gatesRunId = String(gatesDoc.run_id ?? "").trim();
      if (!manifestRunId || manifestRunId !== bundleRunId || gatesRunId !== bundleRunId) {
        return err("BUNDLE_INVALID", "bundle, manifest, and gates run_id must match", {
          bundle_run_id: bundleRunId || null,
          manifest_run_id: manifestRunId || null,
          gates_run_id: gatesRunId || null,
        });
      }

      const replayRoot = path.join(bundleRoot, "replay");
      const replayReportsDir = path.join(replayRoot, "recomputed-reports");

      const recomputeRaw = await (gate_e_reports as unknown as ToolWithExecute).execute({
        manifest_path: manifestPath,
        synthesis_path: synthesisPath,
        citations_path: citationsPath,
        output_dir: replayReportsDir,
        reason: `fixture_replay:${reason}`,
      });
      const recomputeResult = parseToolResult(recomputeRaw);
      if (!recomputeResult.ok) {
        return err("REPORT_RECOMPUTE_FAILED", recomputeResult.message, {
          upstream_code: recomputeResult.code,
          upstream_details: recomputeResult.details,
        });
      }

      const gateERaw = await (gate_e_evaluate as unknown as ToolWithExecute).execute({
        manifest_path: manifestPath,
        synthesis_path: synthesisPath,
        citations_path: citationsPath,
        reason: `fixture_replay:${reason}`,
      });
      const gateEResult = parseToolResult(gateERaw);
      if (!gateEResult.ok) {
        return err("REPORT_RECOMPUTE_FAILED", gateEResult.message, {
          upstream_code: gateEResult.code,
          upstream_details: gateEResult.details,
        });
      }

      const bundledSha256: Record<string, string> = {};
      const recomputedSha256: Record<string, string> = {};
      const matches: Record<string, boolean> = {};
      const mismatches: string[] = [];

      const compareRelPaths = sortedLex([...GATE_E_REPORT_REL_PATHS]);
      for (const relPath of compareRelPaths) {
        const bundledPath = bundlePath(bundleRoot, relPath);
        const recomputedPath = path.join(replayReportsDir, path.basename(relPath));

        const bundledDigest = await sha256DigestForFile(bundledPath);
        const recomputedDigest = await sha256DigestForFile(recomputedPath);

        bundledSha256[relPath] = bundledDigest;
        recomputedSha256[relPath] = recomputedDigest;
        matches[relPath] = bundledDigest === recomputedDigest;
        if (!matches[relPath]) mismatches.push(relPath);
      }

      const bundledStatusRaw = await readJson(bundlePath(bundleRoot, "reports/gate-e-status.json"));
      if (!isPlainObject(bundledStatusRaw)) {
        return err("COMPARE_FAILED", "bundled gate-e-status report must be object", {
          path: bundlePath(bundleRoot, "reports/gate-e-status.json"),
        });
      }
      const bundledStatusDoc = bundledStatusRaw as Record<string, unknown>;

      const evaluatedStatus = String(gateEResult.value.status ?? "").trim();
      const evaluatedWarnings = normalizeWarningList(gateEResult.value.warnings);
      const bundledStatus = String(bundledStatusDoc.status ?? "").trim();
      const bundledWarnings = normalizeWarningList(bundledStatusDoc.warnings);

      const gatesObj = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
      const gateEFromGates = isPlainObject(gatesObj.E) ? (gatesObj.E as Record<string, unknown>) : {};
      const gatesStatus = String(gateEFromGates.status ?? "").trim();
      const gatesWarnings = normalizeWarningList(gateEFromGates.warnings);

      const gateStatusChecks = {
        status_matches_bundled_report: evaluatedStatus === bundledStatus,
        warnings_match_bundled_report: stringArraysEqual(evaluatedWarnings, bundledWarnings),
        status_matches_gates_snapshot: evaluatedStatus === gatesStatus,
        warnings_match_gates_snapshot: stringArraysEqual(evaluatedWarnings, gatesWarnings),
      };
      const gateStatusChecksPassed = Object.values(gateStatusChecks).filter(Boolean).length;
      const overallPass = mismatches.length === 0 && gateStatusChecksPassed === 4;

      const replayReport = {
        ok: true,
        schema_version: FIXTURE_REPLAY_REPORT_SCHEMA_VERSION,
        bundle_path: bundleRoot,
        bundle_id: bundleId,
        run_id: bundleRunId,
        status: overallPass ? "pass" : "fail",
        checks: {
          gate_e_reports: {
            recomputed_sha256: recomputedSha256,
            bundled_sha256: bundledSha256,
            matches,
            mismatches,
          },
          gate_e_status: {
            evaluated_status: evaluatedStatus,
            evaluated_warnings: evaluatedWarnings,
            bundled_status_report: {
              status: bundledStatus,
              warnings: bundledWarnings,
            },
            gates_snapshot: {
              status: gatesStatus,
              warnings: gatesWarnings,
            },
            checks: gateStatusChecks,
          },
        },
        summary: {
          files_compared_total: compareRelPaths.length,
          files_matched_total: compareRelPaths.length - mismatches.length,
          files_mismatched_total: mismatches.length,
          gate_e_status_checks_total: 4,
          gate_e_status_checks_passed: gateStatusChecksPassed,
          overall_pass: overallPass,
        },
      };

      const replayReportPath = path.join(replayRoot, "replay-report.json");
      await atomicWriteCanonicalJson(replayReportPath, replayReport);

      try {
        await appendAuditJsonl({
          runRoot: replayRoot,
          event: {
            ts: nowIso(),
            kind: "fixture_replay",
            run_id: bundleRunId,
            reason,
            bundle_id: bundleId,
            status: replayReport.status,
            replay_report_path: replayReportPath,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        schema_version: FIXTURE_REPLAY_REPORT_SCHEMA_VERSION,
        bundle_path: bundleRoot,
        bundle_id: bundleId,
        run_id: bundleRunId,
        status: replayReport.status,
        checks: replayReport.checks,
        summary: replayReport.summary,
        replay_report_path: replayReportPath,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("BUNDLE_INVALID", "required bundle file missing");
      if (e instanceof SyntaxError) return err("BUNDLE_INVALID", "invalid JSON artifact in bundle", { message: String(e) });
      return err("WRITE_FAILED", "fixture_replay failed", { message: String(e) });
    }
  },
});

function isSortedLex(values: string[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i - 1] ?? "") > (values[i] ?? "")) return false;
  }
  return true;
}

export const deep_research_fixture_replay = fixture_replay;
