import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  atomicWriteText,
  citationCid,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  normalizeCitationUrl,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  validateManifestV1,
} from "./citations_lib";

export const citations_normalize = tool({
  description: "Normalize extracted URLs and compute deterministic cids",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute path to extracted-urls.txt"),
    normalized_urls_path: tool.schema.string().optional().describe("Absolute output path for normalized-urls.txt"),
    url_map_path: tool.schema.string().optional().describe("Absolute output path for url-map.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    extracted_urls_path?: string;
    normalized_urls_path?: string;
    url_map_path?: string;
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

      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || path.join(runRoot, "citations", "extracted-urls.txt");
      const normalizedUrlsPath = (args.normalized_urls_path ?? "").trim() || path.join(runRoot, "citations", "normalized-urls.txt");
      const urlMapPath = (args.url_map_path ?? "").trim() || path.join(runRoot, "citations", "url-map.json");

      for (const [name, p] of [
        ["extracted_urls_path", extractedUrlsPath],
        ["normalized_urls_path", normalizedUrlsPath],
        ["url_map_path", urlMapPath],
      ] as const) {
        if (!path.isAbsolute(p)) return err("INVALID_ARGS", `${name} must be absolute`, { [name]: p });
      }

      let extractedRaw: string;
      try {
        extractedRaw = await fs.promises.readFile(extractedUrlsPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "extracted urls missing", { extracted_urls_path: extractedUrlsPath });
        throw e;
      }

      const extractedUrls = extractedRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const uniqueOriginalUrls = Array.from(new Set(extractedUrls)).sort((a, b) => a.localeCompare(b));
      const urlMapItems: Array<{ url_original: string; normalized_url: string; cid: string }> = [];

      for (const urlOriginal of uniqueOriginalUrls) {
        const normalized = normalizeCitationUrl(urlOriginal);
        if ("normalized_url" in normalized) {
          urlMapItems.push({
            url_original: urlOriginal,
            normalized_url: normalized.normalized_url,
            cid: citationCid(normalized.normalized_url),
          });
          continue;
        }

        return err("SCHEMA_VALIDATION_FAILED", normalized.message, {
          url_original: urlOriginal,
          ...normalized.details,
        });
      }

      urlMapItems.sort((a, b) => {
        const byNormalized = a.normalized_url.localeCompare(b.normalized_url);
        if (byNormalized !== 0) return byNormalized;
        return a.url_original.localeCompare(b.url_original);
      });

      const normalizedUrls = Array.from(new Set(urlMapItems.map((item) => item.normalized_url))).sort((a, b) => a.localeCompare(b));
      const normalizedText = normalizedUrls.length > 0 ? `${normalizedUrls.join("\n")}\n` : "";
      const urlMapDoc = {
        schema_version: "url_map.v1",
        run_id: runId,
        items: urlMapItems,
      };

      const inputsDigest = sha256DigestForJson({
        schema: "citations_normalize.inputs.v1",
        run_id: runId,
        extracted_urls: uniqueOriginalUrls,
      });

      try {
        await atomicWriteText(normalizedUrlsPath, normalizedText);
        await atomicWriteJson(urlMapPath, urlMapDoc);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write output artifacts", {
          normalized_urls_path: normalizedUrlsPath,
          url_map_path: urlMapPath,
          message: String(e),
        });
      }

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_normalize",
            run_id: runId,
            reason,
            normalized_urls_path: normalizedUrlsPath,
            url_map_path: urlMapPath,
            unique_normalized: normalizedUrls.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        normalized_urls_path: normalizedUrlsPath,
        url_map_path: urlMapPath,
        unique_normalized: normalizedUrls.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact missing");
      return err("WRITE_FAILED", "citations_normalize failed", { message: String(e) });
    }
  },
});
