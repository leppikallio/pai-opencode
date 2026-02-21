import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  appendAuditJsonl,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  normalizeCitationUrl,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  toPosixPath,
  validateManifestV1,
} from "./citations_lib";

import { readJsonlObjects } from "./citations_validate_lib";

export const gate_c_compute = tool({
  description: "Compute deterministic Gate C metrics from citation artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute path to extracted-urls.txt"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    citations_path?: string;
    extracted_urls_path?: string;
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
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || path.join(runRoot, "citations", "extracted-urls.txt");
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(extractedUrlsPath)) {
        return err("INVALID_ARGS", "extracted_urls_path must be absolute", { extracted_urls_path: args.extracted_urls_path ?? null });
      }

      let extractedRaw: string;
      try {
        extractedRaw = await fs.promises.readFile(extractedUrlsPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { extracted_urls_path: extractedUrlsPath });
        throw e;
      }

      const extractedOriginal = extractedRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const normalizedExtractedSet = new Set<string>();
      for (const urlOriginal of extractedOriginal) {
        const normalized = normalizeCitationUrl(urlOriginal);
        if ("normalized_url" in normalized) {
          normalizedExtractedSet.add(normalized.normalized_url);
        } else {
          return err("SCHEMA_VALIDATION_FAILED", "failed to normalize extracted URL", {
            url_original: urlOriginal,
            ...normalized.details,
          });
        }
      }
      const normalizedExtracted = Array.from(normalizedExtractedSet).sort((a, b) => a.localeCompare(b));

      let citationRecords: Array<Record<string, unknown>>;
      try {
        citationRecords = await readJsonlObjects(citationsPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { citations_path: citationsPath });
        if (e instanceof SyntaxError) return err("INVALID_JSONL", "citations.jsonl malformed", { citations_path: citationsPath, message: String(e) });
        throw e;
      }

      const statusByNormalized = new Map<string, string>();
      for (const record of citationRecords) {
        const normalizedUrl = String(record.normalized_url ?? "").trim();
        const status = String(record.status ?? "").trim();
        if (!normalizedUrl) return err("SCHEMA_VALIDATION_FAILED", "citation record missing normalized_url", { record });
        if (!status) return err("SCHEMA_VALIDATION_FAILED", "citation record missing status", { normalized_url: normalizedUrl });
        if (statusByNormalized.has(normalizedUrl)) {
          return err("SCHEMA_VALIDATION_FAILED", "duplicate normalized_url in citations.jsonl", {
            normalized_url: normalizedUrl,
          });
        }
        statusByNormalized.set(normalizedUrl, status);
      }

      const denominator = normalizedExtracted.length;
      let validatedCount = 0;
      let invalidCount = 0;
      let uncategorizedCount = 0;

      for (const normalizedUrl of normalizedExtracted) {
        const status = statusByNormalized.get(normalizedUrl);
        if (status === "valid" || status === "paywalled") {
          validatedCount += 1;
        } else if (status === "invalid" || status === "blocked" || status === "mismatch") {
          invalidCount += 1;
        } else {
          uncategorizedCount += 1;
        }
      }

      const rate = (num: number, den: number) => (den <= 0 ? 0 : Number((num / den).toFixed(6)));
      const metrics = {
        validated_url_rate: rate(validatedCount, denominator),
        invalid_url_rate: rate(invalidCount, denominator),
        uncategorized_url_rate: rate(uncategorizedCount, denominator),
      };

      const warnings: string[] = [];
      if (denominator <= 0) warnings.push("NO_URLS_EXTRACTED");

      const pass = denominator > 0
        && metrics.validated_url_rate >= 0.9
        && metrics.invalid_url_rate <= 0.1
        && metrics.uncategorized_url_rate === 0;
      const status: "pass" | "fail" = pass ? "pass" : "fail";

      const notes = denominator <= 0
        ? "Gate C failed: NO_URLS_EXTRACTED"
        : `Gate C ${status}: ${validatedCount}/${denominator} validated, ${invalidCount} invalid, ${uncategorizedCount} uncategorized.`;

      const checkedAt = nowIso();
      const update = {
        C: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, citationsPath)),
            toPosixPath(path.relative(runRoot, extractedUrlsPath)),
          ],
          warnings,
          notes,
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_c_compute.inputs.v1",
        extracted_set: normalizedExtracted,
        citations_set: Array.from(statusByNormalized.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([normalized_url, s]) => ({ normalized_url, status: s })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_c_compute",
            run_id: String(manifest.run_id ?? ""),
            reason,
            status,
            metrics,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "C",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "gate_c_compute failed", { message: String(e) });
    }
  },
});
