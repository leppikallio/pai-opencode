import * as fs from "node:fs";
import * as path from "node:path";

import {
  atomicWriteCanonicalJson,
  formatRate,
  sortedLex,
} from "./deep_research_shared_lib";
import {
  processQualityAuditBundle,
  type QualityAuditFinding,
  type QualityAuditSeverity,
  type QualityAuditBundleMeta,
  type QualityAuditUsedBundle,
} from "./quality_audit_bundle_lib";
import type { ToolWithExecute } from "./types";
import { err, errorCode, isPlainObject, readJson } from "./utils";
import { statPath } from "./wave_tools_io";

export type QualityAuditArgs = {
  fixtures_root?: string;
  bundle_roots?: string[];
  bundle_paths?: string[];
  output_dir?: string;
  min_bundles?: number;
  include_telemetry_metrics?: boolean;
  schema_version?: string;
  reason: string;
};

function qualitySeverityRank(value: QualityAuditSeverity): number {
  if (value === "error") return 3;
  if (value === "warn") return 2;
  return 1;
}

function sortQualityFindings(findings: QualityAuditFinding[]): QualityAuditFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = qualitySeverityRank(b.severity) - qualitySeverityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    const byBundle = a.bundle_id.localeCompare(b.bundle_id);
    if (byBundle !== 0) return byBundle;
    return a.run_id.localeCompare(b.run_id);
  });
}

function resolveCommonAncestor(pathsInput: string[]): string {
  if (pathsInput.length === 0) return "";
  let ancestor = path.resolve(pathsInput[0] ?? "");
  for (let i = 1; i < pathsInput.length; i += 1) {
    const current = path.resolve(pathsInput[i] ?? "");
    while (true) {
      if (current === ancestor || current.startsWith(`${ancestor}${path.sep}`)) break;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  return ancestor;
}

async function readBundleMeta(bundleRoot: string): Promise<QualityAuditBundleMeta> {
  const bundleJsonPath = path.join(bundleRoot, "bundle.json");
  const st = await statPath(bundleJsonPath);
  if (!st?.isFile()) {
    return {
      bundle_root: bundleRoot,
      bundle_id: path.basename(bundleRoot),
      run_id: "",
      bundle_json: null,
      bundle_json_error: "missing",
    };
  }

  try {
    const raw = await readJson(bundleJsonPath);
    if (!isPlainObject(raw)) {
      return {
        bundle_root: bundleRoot,
        bundle_id: path.basename(bundleRoot),
        run_id: "",
        bundle_json: null,
        bundle_json_error: "not_object",
      };
    }

    const bundleId = String(raw.bundle_id ?? "").trim() || path.basename(bundleRoot);
    const runId = String(raw.run_id ?? "").trim();
    return {
      bundle_root: bundleRoot,
      bundle_id: bundleId,
      run_id: runId,
      bundle_json: raw,
      bundle_json_error: null,
    };
  } catch (e) {
    return {
      bundle_root: bundleRoot,
      bundle_id: path.basename(bundleRoot),
      run_id: "",
      bundle_json: null,
      bundle_json_error: e instanceof SyntaxError ? "parse_failed" : "parse_failed",
    };
  }
}

export async function runQualityAudit(
  args: QualityAuditArgs,
  fixtureReplayTool: ToolWithExecute,
): Promise<string> {
  try {
    const reason = args.reason.trim();
    if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

    const schemaVersion = (args.schema_version ?? "").trim() || "quality_audit.report.v1";
    const includeTelemetryMetrics = args.include_telemetry_metrics ?? true;

    const minBundlesRaw = args.min_bundles ?? 1;
    if (!Number.isInteger(minBundlesRaw) || minBundlesRaw < 1) {
      return err("INVALID_ARGS", "min_bundles must be a positive integer", {
        min_bundles: args.min_bundles ?? null,
      });
    }
    const minBundles = Math.trunc(minBundlesRaw);

    const fixturesRoot = (args.fixtures_root ?? "").trim();
    if (fixturesRoot && !path.isAbsolute(fixturesRoot)) {
      return err("INVALID_ARGS", "fixtures_root must be absolute", {
        fixtures_root: args.fixtures_root,
      });
    }

    const explicitBundleRoots = [
      ...(Array.isArray(args.bundle_roots) ? args.bundle_roots : []),
      ...(Array.isArray(args.bundle_paths) ? args.bundle_paths : []),
    ]
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0);

    if (explicitBundleRoots.some((entry) => !path.isAbsolute(entry))) {
      return err("INVALID_ARGS", "bundle_roots/bundle_paths entries must be absolute", {
        bundle_roots: explicitBundleRoots,
      });
    }

    const discoveredRoots: string[] = [];
    if (fixturesRoot) {
      const st = await statPath(fixturesRoot);
      if (!st?.isDirectory()) {
        return err("INVALID_ARGS", "fixtures_root not found or not a directory", {
          fixtures_root: fixturesRoot,
        });
      }

      const entries = await fs.promises.readdir(fixturesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const candidateRoot = path.join(fixturesRoot, entry.name);
        const bundleJsonStat = await statPath(path.join(candidateRoot, "bundle.json"));
        if (!bundleJsonStat?.isFile()) continue;
        discoveredRoots.push(candidateRoot);
      }
    }

    const bundleRoots = sortedLex([...new Set([...discoveredRoots, ...explicitBundleRoots])]);
    if (bundleRoots.length === 0) {
      return err("INVALID_ARGS", "no bundle roots found", {
        fixtures_root: fixturesRoot || null,
        bundle_roots: explicitBundleRoots,
      });
    }

    const outputDirInput = (args.output_dir ?? "").trim();
    if (outputDirInput && !path.isAbsolute(outputDirInput)) {
      return err("INVALID_ARGS", "output_dir must be absolute", {
        output_dir: args.output_dir,
      });
    }

    const defaultOutputBase = fixturesRoot || resolveCommonAncestor(bundleRoots);
    const outputDir = outputDirInput || path.join(defaultOutputBase, "reports");
    if (!path.isAbsolute(outputDir)) {
      return err("INVALID_ARGS", "output_dir resolved to non-absolute path", {
        output_dir: outputDir,
      });
    }
    const outputPath = path.join(outputDir, "quality-audit.json");

    const bundleMeta = await Promise.all(bundleRoots.map((bundleRoot) => readBundleMeta(bundleRoot)));
    bundleMeta.sort((a, b) => {
      const byBundleId = a.bundle_id.localeCompare(b.bundle_id);
      if (byBundleId !== 0) return byBundleId;
      const byRunId = a.run_id.localeCompare(b.run_id);
      if (byRunId !== 0) return byRunId;
      return a.bundle_root.localeCompare(b.bundle_root);
    });

    const findings: QualityAuditFinding[] = [];
    const invalidBundles: Array<Record<string, unknown>> = [];
    const usedBundles: QualityAuditUsedBundle[] = [];

    for (const meta of bundleMeta) {
      const result = await processQualityAuditBundle({
        meta,
        reason,
        includeTelemetryMetrics,
        fixtureReplayTool,
      });
      findings.push(...result.findings);
      if (result.invalidBundle) invalidBundles.push(result.invalidBundle);
      if (result.usedBundle) usedBundles.push(result.usedBundle);
    }

    if (usedBundles.length < minBundles) {
      return err("NO_VALID_BUNDLES", "not enough valid bundles for audit", {
        bundles_scanned_total: bundleMeta.length,
        bundles_used_total: usedBundles.length,
        min_bundles: minBundles,
        invalid_bundles: invalidBundles,
      });
    }

    const utilizationSeries = usedBundles
      .filter((bundle) => bundle.citation_utilization_rate !== null)
      .map((bundle) => ({
        bundle_id: bundle.bundle_id,
        run_id: bundle.run_id,
        value: bundle.citation_utilization_rate as number,
      }));

    if (utilizationSeries.length >= 2) {
      let nonIncreasing = true;
      let hasDrop = false;
      for (let i = 1; i < utilizationSeries.length; i += 1) {
        const prev = utilizationSeries[i - 1]?.value ?? 0;
        const next = utilizationSeries[i]?.value ?? 0;
        if (next > prev) nonIncreasing = false;
        if (next < prev) hasDrop = true;
      }
      if (nonIncreasing && hasDrop) {
        const first = utilizationSeries[0] as { bundle_id: string; run_id: string; value: number };
        const last = utilizationSeries[utilizationSeries.length - 1] as { bundle_id: string; run_id: string; value: number };
        findings.push({
          code: "UTILIZATION_TREND_DOWN",
          severity: "warn",
          bundle_id: last.bundle_id,
          run_id: last.run_id,
          details: {
            from_bundle_id: first.bundle_id,
            from_run_id: first.run_id,
            from_rate: first.value,
            to_bundle_id: last.bundle_id,
            to_run_id: last.run_id,
            to_rate: last.value,
            delta: formatRate(last.value - first.value),
          },
        });
      }
    }

    const duplicateSeries = usedBundles
      .filter((bundle) => bundle.duplicate_citation_rate !== null)
      .map((bundle) => ({
        bundle_id: bundle.bundle_id,
        run_id: bundle.run_id,
        value: bundle.duplicate_citation_rate as number,
      }));

    if (duplicateSeries.length >= 2) {
      let nonDecreasing = true;
      let hasIncrease = false;
      for (let i = 1; i < duplicateSeries.length; i += 1) {
        const prev = duplicateSeries[i - 1]?.value ?? 0;
        const next = duplicateSeries[i]?.value ?? 0;
        if (next < prev) nonDecreasing = false;
        if (next > prev) hasIncrease = true;
      }
      if (nonDecreasing && hasIncrease) {
        const first = duplicateSeries[0] as { bundle_id: string; run_id: string; value: number };
        const last = duplicateSeries[duplicateSeries.length - 1] as { bundle_id: string; run_id: string; value: number };
        findings.push({
          code: "DUPLICATE_RATE_TREND_UP",
          severity: "warn",
          bundle_id: last.bundle_id,
          run_id: last.run_id,
          details: {
            from_bundle_id: first.bundle_id,
            from_run_id: first.run_id,
            from_rate: first.value,
            to_bundle_id: last.bundle_id,
            to_run_id: last.run_id,
            to_rate: last.value,
            delta: formatRate(last.value - first.value),
          },
        });
      }
    }

    const sectionFailures = usedBundles.filter((bundle) =>
      bundle.missing_headings.length > 0 || ((bundle.report_sections_present ?? 100) < 100)
    );
    if (sectionFailures.length >= 2) {
      const last = sectionFailures[sectionFailures.length - 1] as {
        bundle_id: string;
        run_id: string;
        report_sections_present: number | null;
        missing_headings: string[];
      };
      findings.push({
        code: "RECURRING_SECTION_OMISSIONS",
        severity: "error",
        bundle_id: last.bundle_id,
        run_id: last.run_id,
        details: {
          affected_bundles: sectionFailures.map((bundle) => bundle.bundle_id),
          occurrences: sectionFailures.length,
          latest_report_sections_present: last.report_sections_present,
          latest_missing_headings: last.missing_headings,
        },
      });
    }

    const telemetrySeries = usedBundles
      .filter((bundle) => bundle.telemetry.run_duration_s !== null)
      .map((bundle) => ({
        bundle_id: bundle.bundle_id,
        run_id: bundle.run_id,
        run_duration_s: bundle.telemetry.run_duration_s as number,
      }));

    if (telemetrySeries.length >= 2) {
      const first = telemetrySeries[0] as { bundle_id: string; run_id: string; run_duration_s: number };
      const last = telemetrySeries[telemetrySeries.length - 1] as { bundle_id: string; run_id: string; run_duration_s: number };
      if (last.run_duration_s > first.run_duration_s) {
        findings.push({
          code: "LATENCY_ENVELOPE_REGRESSION",
          severity: "warn",
          bundle_id: last.bundle_id,
          run_id: last.run_id,
          details: {
            metric: "run.duration_s",
            from_bundle_id: first.bundle_id,
            from_run_id: first.run_id,
            from_value: first.run_duration_s,
            to_bundle_id: last.bundle_id,
            to_run_id: last.run_id,
            to_value: last.run_duration_s,
            delta: last.run_duration_s - first.run_duration_s,
          },
        });
      }
    }

    const sortedFindings = sortQualityFindings(findings);
    const warningsTotal = sortedFindings.filter((finding) => finding.severity === "warn").length;
    const errorsTotal = sortedFindings.filter((finding) => finding.severity === "error").length;
    const infosTotal = sortedFindings.filter((finding) => finding.severity === "info").length;

    const telemetryDurations = telemetrySeries.map((entry) => entry.run_duration_s);
    const telemetrySummary = telemetryDurations.length > 0
      ? {
          run_duration_s: {
            min: Math.min(...telemetryDurations),
            max: Math.max(...telemetryDurations),
            avg: formatRate(
              telemetryDurations.reduce((acc, value) => acc + value, 0)
              / telemetryDurations.length,
            ),
          },
        }
      : null;

    const driftFlags = sortedLex(
      [...new Set(
        sortedFindings
          .map((finding) => finding.code)
          .filter((code) =>
            code.includes("TREND")
            || code === "RECURRING_SECTION_OMISSIONS"
            || code === "LOW_CITATION_UTILIZATION"
            || code === "HIGH_DUPLICATE_CITATION_RATE",
          ),
      )],
    );

    const report = {
      ok: true,
      schema_version: schemaVersion,
      bundles_scanned_total: bundleMeta.length,
      bundles_used_total: usedBundles.length,
      findings: sortedFindings,
      summary: {
        warnings_total: warningsTotal,
        errors_total: errorsTotal,
        info_total: infosTotal,
        invalid_bundles_total: invalidBundles.length,
        bundles_with_telemetry_total: telemetrySeries.length,
        gate_e_status: {
          pass: usedBundles.filter((bundle) => bundle.status === "pass").length,
          fail: usedBundles.filter((bundle) => bundle.status === "fail").length,
        },
        drift_flags: driftFlags,
        telemetry: telemetrySummary,
      },
      bundles: usedBundles.map((bundle) => ({
        bundle_id: bundle.bundle_id,
        run_id: bundle.run_id,
        status: bundle.status,
        warnings: bundle.warnings,
        citation_utilization_rate: bundle.citation_utilization_rate,
        duplicate_citation_rate: bundle.duplicate_citation_rate,
        report_sections_present: bundle.report_sections_present,
        missing_headings: bundle.missing_headings,
        uncited_numeric_claims: bundle.uncited_numeric_claims,
        replay_used: bundle.replay_used,
        telemetry: bundle.telemetry,
      })),
      invalid_bundles: invalidBundles,
      output_path: outputPath,
    };

    await atomicWriteCanonicalJson(outputPath, report);
    return JSON.stringify(report, null, 2);
  } catch (e) {
    if (errorCode(e) === "ENOENT") return err("BUNDLE_INVALID", "required bundle file missing");
    if (e instanceof SyntaxError) return err("PARSE_FAILED", "invalid JSON artifact in bundle", { message: String(e) });
    return err("WRITE_FAILED", "quality_audit failed", { message: String(e) });
  }
}
