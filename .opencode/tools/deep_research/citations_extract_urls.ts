import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  atomicWriteText,
  err,
  errorCode,
  extractHttpUrlsFromLine,
  findHeadingSection,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  listMarkdownFilesRecursive,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  statPath,
  toPosixPath,
  validateManifestV1,
} from "./citations_lib";

export const citations_extract_urls = tool({
  description: "Extract candidate citation URLs from wave markdown",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    include_wave2: tool.schema.boolean().optional().describe("Whether to include wave-2 artifacts (default true)"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute output path for extracted-urls.txt"),
    found_by_path: tool.schema.string().optional().describe("Absolute output path for found-by.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    include_wave2?: boolean;
    extracted_urls_path?: string;
    found_by_path?: string;
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
      const pathsObj = getManifestPaths(manifest);

      const wave1DirName = String(pathsObj.wave1_dir ?? "wave-1");
      const wave2DirName = String(pathsObj.wave2_dir ?? "wave-2");
      const defaultExtractedPath = path.join(runRoot, "citations", "extracted-urls.txt");
      const defaultFoundByPath = path.join(runRoot, "citations", "found-by.json");

      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || defaultExtractedPath;
      const foundByPath = (args.found_by_path ?? "").trim() || defaultFoundByPath;
      if (!path.isAbsolute(extractedUrlsPath)) {
        return err("INVALID_ARGS", "extracted_urls_path must be absolute", { extracted_urls_path: args.extracted_urls_path ?? null });
      }
      if (!path.isAbsolute(foundByPath)) {
        return err("INVALID_ARGS", "found_by_path must be absolute", { found_by_path: args.found_by_path ?? null });
      }

      const includeWave2 = args.include_wave2 ?? true;
      const wave1Dir = path.join(runRoot, wave1DirName);
      const wave2Dir = path.join(runRoot, wave2DirName);

      const wave1Stat = await statPath(wave1Dir);
      if (!wave1Stat?.isDirectory()) {
        return err("NOT_FOUND", "wave dir missing", { wave_dir: wave1DirName, path: wave1Dir });
      }

      const scanTargets: Array<{ wave: "wave-1" | "wave-2"; dir: string }> = [{ wave: "wave-1", dir: wave1Dir }];
      if (includeWave2) {
        const wave2Stat = await statPath(wave2Dir);
        if (wave2Stat?.isDirectory()) scanTargets.push({ wave: "wave-2", dir: wave2Dir });
      }

      const scannedFiles: Array<{ wave: "wave-1" | "wave-2"; abs: string }> = [];
      for (const target of scanTargets) {
        const files = await listMarkdownFilesRecursive(target.dir);
        for (const file of files) scannedFiles.push({ wave: target.wave, abs: file });
      }
      scannedFiles.sort((a, b) => a.abs.localeCompare(b.abs));

      const extractedAll: string[] = [];
      const foundByItems: Array<{
        url_original: string;
        wave: "wave-1" | "wave-2";
        perspective_id: string;
        source_line: string;
        ordinal: number;
      }> = [];

      for (const file of scannedFiles) {
        const markdown = await fs.promises.readFile(file.abs, "utf8");
        const section = findHeadingSection(markdown, "Sources");
        if (section === null) continue;

        const perspectiveId = path.basename(file.abs, path.extname(file.abs));
        const lines = section.split(/\r?\n/);
        let ordinal = 0;
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const urls = extractHttpUrlsFromLine(line);
          for (const url of urls) {
            ordinal += 1;
            extractedAll.push(url);
            foundByItems.push({
              url_original: url,
              wave: file.wave,
              perspective_id: perspectiveId,
              source_line: line,
              ordinal,
            });
          }
        }
      }

      const uniqueUrls = Array.from(new Set(extractedAll)).sort((a, b) => a.localeCompare(b));

      const boundedByUrl = new Map<string, typeof foundByItems>();
      for (const item of foundByItems) {
        const list = boundedByUrl.get(item.url_original) ?? [];
        if (list.length < 20) list.push(item);
        boundedByUrl.set(item.url_original, list);
      }

      const foundBySorted = Array.from(boundedByUrl.entries())
        .flatMap(([, items]) => items)
        .sort((a, b) => {
          const byUrl = a.url_original.localeCompare(b.url_original);
          if (byUrl !== 0) return byUrl;
          const byWave = a.wave.localeCompare(b.wave);
          if (byWave !== 0) return byWave;
          const byPerspective = a.perspective_id.localeCompare(b.perspective_id);
          if (byPerspective !== 0) return byPerspective;
          return a.ordinal - b.ordinal;
        });

      const extractedText = uniqueUrls.length > 0 ? `${uniqueUrls.join("\n")}\n` : "";
      const foundByDoc = {
        schema_version: "found_by.v1",
        run_id: runId,
        items: foundBySorted,
      };

      const inputsDigest = sha256DigestForJson({
        schema: "citations_extract_urls.inputs.v1",
        run_id: runId,
        include_wave2: includeWave2,
        run_root: runRoot,
        wave1_dir: wave1DirName,
        wave2_dir: wave2DirName,
        scanned_files: scannedFiles.map((entry) => toPosixPath(path.relative(runRoot, entry.abs))),
      });

      try {
        await atomicWriteText(extractedUrlsPath, extractedText);
        await atomicWriteJson(foundByPath, foundByDoc);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write output artifacts", {
          extracted_urls_path: extractedUrlsPath,
          found_by_path: foundByPath,
          message: String(e),
        });
      }

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_extract_urls",
            run_id: runId,
            reason,
            extracted_urls_path: extractedUrlsPath,
            found_by_path: foundByPath,
            total_found: extractedAll.length,
            unique_found: uniqueUrls.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        extracted_urls_path: extractedUrlsPath,
        found_by_path: foundByPath,
        total_found: extractedAll.length,
        unique_found: uniqueUrls.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact missing");
      return err("WRITE_FAILED", "citations_extract_urls failed", { message: String(e) });
    }
  },
});
