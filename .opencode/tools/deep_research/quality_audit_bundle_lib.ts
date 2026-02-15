import * as path from "node:path";

import {
  bundlePath,
  normalizeWarningList,
  parseToolResult,
  sortedLex,
} from "./deep_research_shared_lib";
import type { ToolWithExecute } from "./types";
import { isPlainObject, readJson } from "./utils";
import { statPath } from "./wave_tools_io";

export type QualityAuditSeverity = "info" | "warn" | "error";

export type QualityAuditFinding = {
  code: string;
  severity: QualityAuditSeverity;
  bundle_id: string;
  run_id: string;
  details: Record<string, unknown>;
};

export type QualityAuditBundleMeta = {
  bundle_root: string;
  bundle_id: string;
  run_id: string;
  bundle_json: Record<string, unknown> | null;
  bundle_json_error: string | null;
};

export type QualityAuditUsedBundle = {
  bundle_id: string;
  run_id: string;
  bundle_root: string;
  status: "pass" | "fail";
  warnings: string[];
  citation_utilization_rate: number | null;
  duplicate_citation_rate: number | null;
  report_sections_present: number | null;
  missing_headings: string[];
  uncited_numeric_claims: number | null;
  replay_used: boolean;
  telemetry: {
    run_duration_s: number | null;
    failures_total: number | null;
    stage_timeouts_total: number | null;
    citations_duration_s: number | null;
    source_path: string | null;
  };
};

function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function toIntegerOrNull(value: unknown): number | null {
  const n = toFiniteNumberOrNull(value);
  if (n === null) return null;
  return Math.trunc(n);
}

async function readJsonObjectAt(filePath: string): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "missing" | "not_file" | "parse_failed" | "not_object"; message?: string }
> {
  const st = await statPath(filePath);
  if (!st) return { ok: false, reason: "missing" };
  if (!st.isFile()) return { ok: false, reason: "not_file" };

  try {
    const raw = await readJson(filePath);
    if (!isPlainObject(raw)) return { ok: false, reason: "not_object" };
    return { ok: true, value: raw as Record<string, unknown> };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, reason: "parse_failed", message: String(e) };
    }
    return { ok: false, reason: "parse_failed", message: String(e) };
  }
}

function normalizeMetricStageDuration(
  runMetrics: Record<string, unknown>,
  stageId: string,
): number | null {
  const stage = isPlainObject(runMetrics.stage) ? (runMetrics.stage as Record<string, unknown>) : null;
  const duration = stage && isPlainObject(stage.duration_s)
    ? (stage.duration_s as Record<string, unknown>)
    : null;
  const byStage = duration && isPlainObject(duration.by_stage_id)
    ? (duration.by_stage_id as Record<string, unknown>)
    : null;
  return byStage ? toIntegerOrNull(byStage[stageId]) : null;
}

function normalizeGateStatus(
  statusDoc: Record<string, unknown>,
): {
  status: "pass" | "fail";
  warnings: string[];
  uncited_numeric_claims: number | null;
  report_sections_present: number | null;
  citation_utilization_rate: number | null;
  duplicate_citation_rate: number | null;
} | null {
  const statusRaw = String(statusDoc.status ?? "").trim();
  if (statusRaw !== "pass" && statusRaw !== "fail") return null;

  const warnings = normalizeWarningList(statusDoc.warnings);
  const hardMetrics = isPlainObject(statusDoc.hard_metrics)
    ? (statusDoc.hard_metrics as Record<string, unknown>)
    : {};
  const softMetrics = isPlainObject(statusDoc.soft_metrics)
    ? (statusDoc.soft_metrics as Record<string, unknown>)
    : {};

  return {
    status: statusRaw,
    warnings,
    uncited_numeric_claims: toIntegerOrNull(hardMetrics.uncited_numeric_claims),
    report_sections_present: toIntegerOrNull(hardMetrics.report_sections_present),
    citation_utilization_rate: toFiniteNumberOrNull(softMetrics.citation_utilization_rate),
    duplicate_citation_rate: toFiniteNumberOrNull(softMetrics.duplicate_citation_rate),
  };
}

export async function processQualityAuditBundle(args: {
  meta: QualityAuditBundleMeta;
  reason: string;
  includeTelemetryMetrics: boolean;
  fixtureReplayTool: ToolWithExecute;
}): Promise<{
  findings: QualityAuditFinding[];
  invalidBundle: Record<string, unknown> | null;
  usedBundle: QualityAuditUsedBundle | null;
}> {
  const { meta, reason, includeTelemetryMetrics, fixtureReplayTool } = args;
  const { bundle_root: bundleRoot, bundle_id: bundleId, run_id: runId } = meta;

  const findings: QualityAuditFinding[] = [];

  if (!meta.bundle_json) {
    findings.push({
      code: "BUNDLE_INVALID",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        reason: "bundle.json missing or invalid",
        bundle_root: bundleRoot,
        bundle_json_error: meta.bundle_json_error,
      },
    });
    return {
      findings,
      invalidBundle: {
        bundle_id: bundleId,
        run_id: runId,
        bundle_root: bundleRoot,
        reason: "bundle.json missing or invalid",
      },
      usedBundle: null,
    };
  }

  let statusDocResult = await readJsonObjectAt(bundlePath(bundleRoot, "reports/gate-e-status.json"));
  let utilizationDocResult = await readJsonObjectAt(bundlePath(bundleRoot, "reports/gate-e-citation-utilization.json"));
  let sectionsDocResult = await readJsonObjectAt(bundlePath(bundleRoot, "reports/gate-e-sections-present.json"));
  let replayUsed = false;

  if (!statusDocResult.ok || !utilizationDocResult.ok) {
    const replayRaw = await fixtureReplayTool.execute({
      bundle_root: bundleRoot,
      reason: `quality_audit:${reason}:${bundleId}`,
    });
    const replayResult = parseToolResult(replayRaw);
    if (!replayResult.ok) {
      findings.push({
        code: "BUNDLE_INVALID",
        severity: "error",
        bundle_id: bundleId,
        run_id: runId,
        details: {
          reason: "required Gate E reports missing and replay failed",
          bundle_root: bundleRoot,
          replay_error_code: replayResult.code,
          replay_error_message: replayResult.message,
          status_report_state: statusDocResult.ok ? "ok" : statusDocResult.reason,
          utilization_report_state: utilizationDocResult.ok ? "ok" : utilizationDocResult.reason,
        },
      });
      return {
        findings,
        invalidBundle: {
          bundle_id: bundleId,
          run_id: runId,
          bundle_root: bundleRoot,
          reason: "required Gate E reports missing and replay failed",
        },
        usedBundle: null,
      };
    }

    replayUsed = true;
    if (!statusDocResult.ok) {
      statusDocResult = await readJsonObjectAt(path.join(bundleRoot, "replay", "recomputed-reports", "gate-e-status.json"));
    }
    if (!utilizationDocResult.ok) {
      utilizationDocResult = await readJsonObjectAt(path.join(bundleRoot, "replay", "recomputed-reports", "gate-e-citation-utilization.json"));
    }
    if (!sectionsDocResult.ok) {
      sectionsDocResult = await readJsonObjectAt(path.join(bundleRoot, "replay", "recomputed-reports", "gate-e-sections-present.json"));
    }
  }

  if (!statusDocResult.ok || !utilizationDocResult.ok) {
    findings.push({
      code: "PARSE_FAILED",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        reason: "required Gate E reports unavailable after replay",
        bundle_root: bundleRoot,
        status_report_state: statusDocResult.ok ? "ok" : statusDocResult.reason,
        utilization_report_state: utilizationDocResult.ok ? "ok" : utilizationDocResult.reason,
      },
    });
    return {
      findings,
      invalidBundle: {
        bundle_id: bundleId,
        run_id: runId,
        bundle_root: bundleRoot,
        reason: "required Gate E reports unavailable after replay",
      },
      usedBundle: null,
    };
  }

  const statusMetrics = normalizeGateStatus(statusDocResult.value);
  if (!statusMetrics) {
    findings.push({
      code: "PARSE_FAILED",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        reason: "gate-e-status.json missing required fields",
        bundle_root: bundleRoot,
      },
    });
    return {
      findings,
      invalidBundle: {
        bundle_id: bundleId,
        run_id: runId,
        bundle_root: bundleRoot,
        reason: "gate-e-status.json missing required fields",
      },
      usedBundle: null,
    };
  }

  const utilizationMetricsRoot = isPlainObject(utilizationDocResult.value.metrics)
    ? (utilizationDocResult.value.metrics as Record<string, unknown>)
    : {};
  const citationUtilizationRate = toFiniteNumberOrNull(
    utilizationMetricsRoot.citation_utilization_rate ?? statusMetrics.citation_utilization_rate,
  );
  const duplicateCitationRate = toFiniteNumberOrNull(
    utilizationMetricsRoot.duplicate_citation_rate ?? statusMetrics.duplicate_citation_rate,
  );
  if (citationUtilizationRate === null || duplicateCitationRate === null) {
    findings.push({
      code: "PARSE_FAILED",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        reason: "citation utilization metrics missing",
        bundle_root: bundleRoot,
      },
    });
    return {
      findings,
      invalidBundle: {
        bundle_id: bundleId,
        run_id: runId,
        bundle_root: bundleRoot,
        reason: "citation utilization metrics missing",
      },
      usedBundle: null,
    };
  }

  const sectionsDoc = sectionsDocResult.ok ? sectionsDocResult.value : null;
  const sectionsMetrics = sectionsDoc && isPlainObject(sectionsDoc.metrics)
    ? (sectionsDoc.metrics as Record<string, unknown>)
    : {};
  const reportSectionsPresent = statusMetrics.report_sections_present
    ?? toIntegerOrNull(sectionsMetrics.report_sections_present);
  const missingHeadings = sectionsDoc && Array.isArray(sectionsDoc.missing_headings)
    ? sortedLex(
        sectionsDoc.missing_headings
          .map((entry) => String(entry ?? "").trim())
          .filter((entry) => entry.length > 0),
      )
    : [];

  if (statusMetrics.status === "fail") {
    findings.push({
      code: "GATE_E_STATUS_FAIL",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        uncited_numeric_claims: statusMetrics.uncited_numeric_claims,
        report_sections_present: reportSectionsPresent,
      },
    });
  }

  if (missingHeadings.length > 0 || (reportSectionsPresent !== null && reportSectionsPresent < 100)) {
    findings.push({
      code: "MISSING_REQUIRED_SECTIONS",
      severity: "error",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        report_sections_present: reportSectionsPresent,
        missing_headings: missingHeadings,
      },
    });
  }

  for (const warningCode of statusMetrics.warnings) {
    findings.push({
      code: warningCode,
      severity: "warn",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        citation_utilization_rate: citationUtilizationRate,
        duplicate_citation_rate: duplicateCitationRate,
      },
    });
  }

  if (citationUtilizationRate < 0.6 && !statusMetrics.warnings.includes("LOW_CITATION_UTILIZATION")) {
    findings.push({
      code: "LOW_CITATION_UTILIZATION",
      severity: "warn",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        citation_utilization_rate: citationUtilizationRate,
        threshold: 0.6,
        source: "derived",
      },
    });
  }

  if (duplicateCitationRate > 0.2 && !statusMetrics.warnings.includes("HIGH_DUPLICATE_CITATION_RATE")) {
    findings.push({
      code: "HIGH_DUPLICATE_CITATION_RATE",
      severity: "warn",
      bundle_id: bundleId,
      run_id: runId,
      details: {
        duplicate_citation_rate: duplicateCitationRate,
        threshold: 0.2,
        source: "derived",
      },
    });
  }

  let telemetry = {
    run_duration_s: null as number | null,
    failures_total: null as number | null,
    stage_timeouts_total: null as number | null,
    citations_duration_s: null as number | null,
    source_path: null as string | null,
  };

  if (includeTelemetryMetrics) {
    const telemetryPathCandidates = [
      path.join(bundleRoot, "metrics", "run-metrics.json"),
      path.join(bundleRoot, "metrics", "run-metrics.expected.json"),
    ];

    let telemetryPath: string | null = null;
    for (const candidatePath of telemetryPathCandidates) {
      const st = await statPath(candidatePath);
      if (st?.isFile()) {
        telemetryPath = candidatePath;
        break;
      }
    }

    if (telemetryPath) {
      const telemetryRead = await readJsonObjectAt(telemetryPath);
      if (!telemetryRead.ok) {
        findings.push({
          code: "TELEMETRY_PARSE_FAILED",
          severity: "warn",
          bundle_id: bundleId,
          run_id: runId,
          details: {
            telemetry_path: telemetryPath,
            reason: telemetryRead.reason,
            message: telemetryRead.message ?? null,
          },
        });
      } else {
        const run = isPlainObject(telemetryRead.value.run)
          ? (telemetryRead.value.run as Record<string, unknown>)
          : {};
        telemetry = {
          run_duration_s: toIntegerOrNull(run.duration_s),
          failures_total: toIntegerOrNull(run.failures_total),
          stage_timeouts_total: toIntegerOrNull(run.stage_timeouts_total),
          citations_duration_s: normalizeMetricStageDuration(telemetryRead.value, "citations"),
          source_path: telemetryPath,
        };
      }
    }
  }

  return {
    findings,
    invalidBundle: null,
    usedBundle: {
      bundle_id: bundleId,
      run_id: runId,
      bundle_root: bundleRoot,
      status: statusMetrics.status,
      warnings: statusMetrics.warnings,
      citation_utilization_rate: citationUtilizationRate,
      duplicate_citation_rate: duplicateCitationRate,
      report_sections_present: reportSectionsPresent,
      missing_headings: missingHeadings,
      uncited_numeric_claims: statusMetrics.uncited_numeric_claims,
      replay_used: replayUsed,
      telemetry,
    },
  };
}
