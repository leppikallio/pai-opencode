import * as fs from "node:fs/promises";
import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  isInteger,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  validateManifestV1,
} from "./wave_tools_shared";

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function safeRealpath(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch (e) {
    if (errorCode(e) === "ENOENT") return null;
    throw e;
  }
}

export const gate_b_derive = tool({
  description: "Derive deterministic Gate B patch from wave_review report",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    wave_review_report_path: tool.schema.string().optional().describe("Absolute path to wave-review.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    wave_review_report_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      let runRootReal: string;
      try {
        runRootReal = await fs.realpath(runRoot);
      } catch (e) {
        if (errorCode(e) === "ENOENT") {
          return err("NOT_FOUND", "run root missing", { run_root: runRoot });
        }
        throw e;
      }

      const waveReviewPath = (args.wave_review_report_path ?? "").trim() || path.join(runRoot, "wave-review.json");
      if (!path.isAbsolute(waveReviewPath)) {
        return err("INVALID_ARGS", "wave_review_report_path must be absolute", {
          wave_review_report_path: args.wave_review_report_path ?? null,
        });
      }
      if (!isPathInsideRoot(runRoot, waveReviewPath)) {
        return err("INVALID_ARGS", "wave_review_report_path must be inside run root", {
          run_root: runRoot,
          wave_review_report_path: waveReviewPath,
        });
      }

      const waveReviewReal = await safeRealpath(waveReviewPath);
      if (waveReviewReal !== null && !isPathInsideRoot(runRootReal, waveReviewReal)) {
        return err("INVALID_ARGS", "wave_review_report_path realpath escapes run root", {
          run_root: runRoot,
          run_root_realpath: runRootReal,
          wave_review_report_path: waveReviewPath,
          wave_review_report_realpath: waveReviewReal,
        });
      }

      let reviewRaw: unknown;
      try {
        reviewRaw = await readJson(waveReviewPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") {
          return err("NOT_FOUND", "wave_review report missing", {
            wave_review_report_path: waveReviewPath,
          });
        }
        if (e instanceof SyntaxError) {
          return err("INVALID_JSON", "wave_review report unreadable", {
            wave_review_report_path: waveReviewPath,
          });
        }
        throw e;
      }

      if (!isPlainObject(reviewRaw)) return err("SCHEMA_VALIDATION_FAILED", "wave_review report must be object");
      const review = reviewRaw as Record<string, unknown>;

      if (review.ok !== true) {
        return err("INVALID_STATE", "wave_review report must have ok=true", {
          ok: review.ok ?? null,
        });
      }

      if (typeof review.pass !== "boolean") {
        return err("SCHEMA_VALIDATION_FAILED", "wave_review report pass must be boolean", {
          pass: review.pass ?? null,
        });
      }

      const validated = review.validated;
      const failed = review.failed;
      if (!isInteger(validated) || validated < 0) {
        return err("SCHEMA_VALIDATION_FAILED", "wave_review validated must be integer >= 0", {
          validated: review.validated ?? null,
        });
      }
      if (!isInteger(failed) || failed < 0) {
        return err("SCHEMA_VALIDATION_FAILED", "wave_review failed must be integer >= 0", {
          failed: review.failed ?? null,
        });
      }

      if (!Array.isArray(review.results)) {
        return err("SCHEMA_VALIDATION_FAILED", "wave_review results must be array", {
          results: review.results ?? null,
        });
      }
      if (!Array.isArray(review.retry_directives)) {
        return err("SCHEMA_VALIDATION_FAILED", "wave_review retry_directives must be array", {
          retry_directives: review.retry_directives ?? null,
        });
      }

      const normalizedResults: Array<{ perspective_id: string; pass: boolean; failure_code: string | null }> = [];
      for (let i = 0; i < review.results.length; i += 1) {
        const rawEntry = review.results[i];
        if (!isPlainObject(rawEntry)) {
          return err("SCHEMA_VALIDATION_FAILED", "wave_review result must be object", { index: i });
        }

        const perspectiveId = String(rawEntry.perspective_id ?? "").trim();
        if (!perspectiveId) {
          return err("SCHEMA_VALIDATION_FAILED", "wave_review result missing perspective_id", { index: i });
        }

        if (typeof rawEntry.pass !== "boolean") {
          return err("SCHEMA_VALIDATION_FAILED", "wave_review result pass must be boolean", {
            index: i,
            perspective_id: perspectiveId,
          });
        }

        let failureCode: string | null = null;
        if (rawEntry.failure !== null && rawEntry.failure !== undefined) {
          if (!isPlainObject(rawEntry.failure)) {
            return err("SCHEMA_VALIDATION_FAILED", "wave_review result failure must be object|null", {
              index: i,
              perspective_id: perspectiveId,
            });
          }
          const code = String(rawEntry.failure.code ?? "").trim();
          if (!code) {
            return err("SCHEMA_VALIDATION_FAILED", "wave_review failure.code must be non-empty", {
              index: i,
              perspective_id: perspectiveId,
            });
          }
          failureCode = code;
        }

        normalizedResults.push({
          perspective_id: perspectiveId,
          pass: rawEntry.pass,
          failure_code: failureCode,
        });
      }

      const normalizedRetryDirectives = review.retry_directives.map((entry, index) => {
        if (!isPlainObject(entry)) {
          return {
            index,
            perspective_id: "",
            blocking_error_code: "",
          };
        }
        return {
          index,
          perspective_id: String(entry.perspective_id ?? "").trim(),
          blocking_error_code: String(entry.blocking_error_code ?? "").trim(),
        };
      });

      const reportPass = review.pass === true;
      const validatedPositive = validated > 0;
      const failedZero = failed === 0;
      const retryDirectivesEmpty = normalizedRetryDirectives.length === 0;
      const resultsCountMatchesValidated = normalizedResults.length === validated;
      const allResultsPass = normalizedResults.every((entry) => entry.pass === true);
      const failedCountMatchesResults = normalizedResults.filter((entry) => entry.pass === false).length === failed;

      const status: "pass" | "fail" =
        reportPass
        && validatedPositive
        && failedZero
        && retryDirectivesEmpty
        && resultsCountMatchesValidated
        && allResultsPass
        && failedCountMatchesResults
          ? "pass"
          : "fail";

      const warnings: string[] = [];
      if (!reportPass) warnings.push("WAVE_REVIEW_PASS_FALSE");
      if (!validatedPositive) warnings.push("ZERO_VALIDATED_PERSPECTIVES");
      if (!failedZero) warnings.push("FAILED_COUNT_NON_ZERO");
      if (!retryDirectivesEmpty) warnings.push("RETRY_DIRECTIVES_PRESENT");
      if (!resultsCountMatchesValidated) warnings.push("RESULT_COUNT_MISMATCH");
      if (!allResultsPass) warnings.push("RESULT_PASS_FALSE_PRESENT");
      if (!failedCountMatchesResults) warnings.push("FAILED_COUNT_INCONSISTENT_WITH_RESULTS");

      const metrics = {
        validated_count: validated,
        failed_count: failed,
        results_count: normalizedResults.length,
        retry_directives_count: normalizedRetryDirectives.length,
        report_pass_flag: reportPass ? 1 : 0,
        validated_positive: validatedPositive ? 1 : 0,
        all_results_pass: allResultsPass ? 1 : 0,
        failed_matches_results: failedCountMatchesResults ? 1 : 0,
      };

      const relativeReportPath = toPosixPath(path.relative(runRoot, waveReviewPath));
      const checkedAt = nowIso();
      const notes = status === "pass"
        ? "Gate B passed via wave_review contract: ok=true, pass=true, validated>0, failed=0, retry_directives empty, results coherent."
        : `Gate B failed via wave_review contract: ${warnings.join(", ")}`;

      const update = {
        B: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [relativeReportPath],
          warnings,
          notes,
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_b_derive.inputs.v1",
        report_path: relativeReportPath,
        report_ok: true,
        report_pass: reportPass,
        validated,
        failed,
        results: normalizedResults
          .slice()
          .sort((a, b) => a.perspective_id.localeCompare(b.perspective_id)),
        retry_directives: normalizedRetryDirectives,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_b_derive",
            run_id: runId,
            reason,
            status,
            metrics,
            inputs_digest: inputsDigest,
            wave_review_report_path: relativeReportPath,
            warnings,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "B",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
        wave_review_report_path: waveReviewPath,
        rule:
          "ok=true && pass=true && validated>0 && failed=0 && retry_directives=0 && results_count=validated && all results pass",
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_b_derive failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_b_derive = gate_b_derive;
