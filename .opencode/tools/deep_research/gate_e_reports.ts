import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { appendAuditJsonl, toPosixPath } from "./citations_lib";
import {
  atomicWriteCanonicalJson,
  collectUncitedNumericClaimFindingsV1,
  computeGateECitationMetricsV1,
  computeGateESectionCoverageV1,
  computeGateEWarningsV1,
  isGateEHardPassV1,
  readValidatedCids,
  resolveArtifactPath,
  resolveRunRootFromManifest,
} from "./deep_research_shared_lib";
import { validateManifestV1 } from "./schema_v1";
import {
  err,
  errorCode,
  getManifestPaths,
  nowIso,
  ok,
  readJson,
  resolveRunPath,
  sha256DigestForJson,
  sha256HexLowerUtf8,
} from "./utils";

export const gate_e_reports = tool({
  description: "Generate deterministic offline Gate E evidence reports",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    synthesis_path: tool.schema.string().optional().describe("Optional synthesis markdown path"),
    citations_path: tool.schema.string().optional().describe("Optional citations.jsonl path"),
    output_dir: tool.schema.string().optional().describe("Optional reports output directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    synthesis_path?: string;
    citations_path?: string;
    output_dir?: string;
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

      const synthesisDefault = resolveArtifactPath(
        undefined,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/final-synthesis.md` : undefined,
        "synthesis/final-synthesis.md",
      );
      const citationsDefault = resolveArtifactPath(
        undefined,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );

      const synthesisPath = (args.synthesis_path ?? "").trim()
        ? resolveRunPath(runRoot, args.synthesis_path ?? "")
        : synthesisDefault;
      const citationsPath = (args.citations_path ?? "").trim()
        ? resolveRunPath(runRoot, args.citations_path ?? "")
        : citationsDefault;
      const reportsDir = (args.output_dir ?? "").trim()
        ? resolveRunPath(runRoot, args.output_dir ?? "")
        : path.join(runRoot, "reports");

      if (!path.isAbsolute(synthesisPath)) return err("INVALID_ARGS", "synthesis_path must resolve to absolute path", { synthesis_path: args.synthesis_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must resolve to absolute path", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(reportsDir)) return err("INVALID_ARGS", "output_dir must resolve to absolute path", { output_dir: args.output_dir ?? null });

      const markdown = await fs.promises.readFile(synthesisPath, "utf8");
      const validatedCids = await readValidatedCids(citationsPath);

      const numericFindings = collectUncitedNumericClaimFindingsV1(markdown);
      const uncitedNumericClaims = numericFindings.length;

      const sectionCoverage = computeGateESectionCoverageV1(markdown);
      const citationMetrics = computeGateECitationMetricsV1(markdown, validatedCids);
      const warnings = computeGateEWarningsV1(
        citationMetrics.citation_utilization_rate,
        citationMetrics.duplicate_citation_rate,
      );

      const status: "pass" | "fail" = isGateEHardPassV1(
        uncitedNumericClaims,
        sectionCoverage.report_sections_present,
      )
        ? "pass"
        : "fail";

      const metricsSummary = {
        uncited_numeric_claims: uncitedNumericClaims,
        report_sections_present: sectionCoverage.report_sections_present,
        validated_cids_count: citationMetrics.validated_cids_count,
        used_cids_count: citationMetrics.used_cids_count,
        total_cid_mentions: citationMetrics.total_cid_mentions,
        citation_utilization_rate: citationMetrics.citation_utilization_rate,
        duplicate_citation_rate: citationMetrics.duplicate_citation_rate,
      };

      const numericClaimsReport = {
        schema_version: "gate_e.numeric_claims_report.v1",
        metrics: {
          uncited_numeric_claims: uncitedNumericClaims,
        },
        findings: numericFindings,
      };

      const sectionsReport = {
        schema_version: "gate_e.sections_present_report.v1",
        required_headings: sectionCoverage.required_headings,
        present_headings: sectionCoverage.present_headings,
        missing_headings: sectionCoverage.missing_headings,
        metrics: {
          report_sections_present: sectionCoverage.report_sections_present,
        },
      };

      const citationUtilizationReport = {
        schema_version: "gate_e.citation_utilization_report.v1",
        metrics: {
          validated_cids_count: citationMetrics.validated_cids_count,
          used_cids_count: citationMetrics.used_cids_count,
          total_cid_mentions: citationMetrics.total_cid_mentions,
          citation_utilization_rate: citationMetrics.citation_utilization_rate,
          duplicate_citation_rate: citationMetrics.duplicate_citation_rate,
        },
        cids: {
          validated_cids: citationMetrics.validated_cids,
          used_cids: citationMetrics.used_cids,
        },
      };

      const statusReport = {
        schema_version: "gate_e.status_report.v1",
        status,
        warnings,
        hard_metrics: {
          uncited_numeric_claims: uncitedNumericClaims,
          report_sections_present: sectionCoverage.report_sections_present,
        },
        soft_metrics: {
          citation_utilization_rate: citationMetrics.citation_utilization_rate,
          duplicate_citation_rate: citationMetrics.duplicate_citation_rate,
        },
      };

      await ensureDir(reportsDir);
      const numericClaimsPath = path.join(reportsDir, "gate-e-numeric-claims.json");
      const sectionsPath = path.join(reportsDir, "gate-e-sections-present.json");
      const citationUtilizationPath = path.join(reportsDir, "gate-e-citation-utilization.json");
      const statusPath = path.join(reportsDir, "gate-e-status.json");

      await atomicWriteCanonicalJson(numericClaimsPath, numericClaimsReport);
      await atomicWriteCanonicalJson(sectionsPath, sectionsReport);
      await atomicWriteCanonicalJson(citationUtilizationPath, citationUtilizationReport);
      await atomicWriteCanonicalJson(statusPath, statusReport);

      const inputsDigest = sha256DigestForJson({
        schema: "gate_e_reports.inputs.v1",
        run_id: runId,
        synthesis_path: toPosixPath(path.relative(runRoot, synthesisPath)),
        citations_path: toPosixPath(path.relative(runRoot, citationsPath)),
        reports_dir: toPosixPath(path.relative(runRoot, reportsDir)),
        markdown_hash: sha256HexLowerUtf8(markdown),
        metrics: metricsSummary,
        warnings,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "gate_e_reports",
            run_id: runId,
            reason,
            status,
            warnings,
            inputs_digest: inputsDigest,
            report_paths: [
              toPosixPath(path.relative(runRoot, numericClaimsPath)),
              toPosixPath(path.relative(runRoot, sectionsPath)),
              toPosixPath(path.relative(runRoot, citationUtilizationPath)),
              toPosixPath(path.relative(runRoot, statusPath)),
            ],
          },
        });
      } catch {
        // best effort
      }

      return ok({
        output_dir: reportsDir,
        report_paths: {
          gate_e_numeric_claims: numericClaimsPath,
          gate_e_sections_present: sectionsPath,
          gate_e_citation_utilization: citationUtilizationPath,
          gate_e_status: statusPath,
        },
        metrics_summary: metricsSummary,
        status,
        warnings,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_e_reports failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_e_reports = gate_e_reports;
