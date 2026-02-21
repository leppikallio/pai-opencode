import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { validateManifestV1, validatePerspectivesV1 } from "./schema_v1";
import { toPosixPath } from "./citations_lib";
import {
  atomicWriteJson,
  atomicWriteText,
  err,
  errorCode,
  getManifestPaths,
  getNumberProp,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  sha256HexLowerUtf8,
} from "./utils";
import { appendAuditJsonl } from "./wave_tools_shared";
import {
  extractCitationMentions,
  formatRate,
  hasRawHttpUrl,
  readValidatedCids,
  resolveArtifactPath,
  resolveRunRootFromManifest,
} from "./phase05_lib";

function sanitizeSummaryLine(input: string): string {
  return input
    .replace(/\[@[A-Za-z0-9_:-]+\]/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const summary_pack_build = tool({
  description: "Build bounded summary-pack and summary markdown artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    perspectives_path: tool.schema.string().optional().describe("Absolute path to perspectives.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Build mode"),
    fixture_summaries_dir: tool.schema.string().optional().describe("Absolute fixture summaries directory for mode=fixture"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute output summary-pack path"),
    summaries_dir: tool.schema.string().optional().describe("Absolute output summaries directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    perspectives_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_summaries_dir?: string;
    summary_pack_path?: string;
    summaries_dir?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      const mode = args.mode ?? "fixture";

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (mode !== "fixture" && mode !== "generate") {
        return err("INVALID_ARGS", "mode must be fixture or generate", { mode });
      }

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const perspectivesPath = resolveArtifactPath(
        args.perspectives_path,
        runRoot,
        typeof artifactPaths.perspectives_file === "string" ? artifactPaths.perspectives_file : undefined,
        "perspectives.json",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const summariesDir = resolveArtifactPath(
        args.summaries_dir,
        runRoot,
        typeof artifactPaths.summaries_dir === "string" ? artifactPaths.summaries_dir : undefined,
        "summaries",
      );
      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const fixtureSummariesDir = (args.fixture_summaries_dir ?? "").trim();

      if (!path.isAbsolute(perspectivesPath)) return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(summariesDir)) return err("INVALID_ARGS", "summaries_dir must be absolute", { summaries_dir: args.summaries_dir ?? null });
      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (mode === "fixture" && (!fixtureSummariesDir || !path.isAbsolute(fixtureSummariesDir))) {
        return err("INVALID_ARGS", "fixture_summaries_dir must be absolute in fixture mode", {
          fixture_summaries_dir: args.fixture_summaries_dir ?? null,
        });
      }

      const relSummariesDir = toPosixPath(path.relative(runRoot, summariesDir));
      const relSummaryPackPath = toPosixPath(path.relative(runRoot, summaryPackPath));
      if (relSummariesDir.startsWith("..") || path.isAbsolute(relSummariesDir)) {
        return err("INVALID_ARGS", "summaries_dir must be under run root", { summaries_dir: summariesDir, run_root: runRoot });
      }
      if (relSummaryPackPath.startsWith("..") || path.isAbsolute(relSummaryPackPath)) {
        return err("INVALID_ARGS", "summary_pack_path must be under run root", { summary_pack_path: summaryPackPath, run_root: runRoot });
      }

      const perspectivesRaw = await readJson(perspectivesPath);
      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const perspectivesList = Array.isArray(perspectivesDoc.perspectives)
        ? (perspectivesDoc.perspectives as Array<Record<string, unknown>>)
        : [];
      const perspectives = perspectivesList
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          source_artifact: String((item as Record<string, unknown>).source_artifact ?? "").trim(),
        }))
        .filter((item) => item.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id));

      if (perspectives.length === 0) return err("SCHEMA_VALIDATION_FAILED", "perspectives list is empty", { path: "$.perspectives" });

      const validatedCids = await readValidatedCids(citationsPath);

      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxSummaryKb = getNumberProp(limitsObj, "max_summary_kb") ?? Number(limitsObj.max_summary_kb ?? 0);
      const maxTotalSummaryKb = getNumberProp(limitsObj, "max_total_summary_kb") ?? Number(limitsObj.max_total_summary_kb ?? 0);
      if (!Number.isFinite(maxSummaryKb) || maxSummaryKb <= 0) {
        return err("INVALID_STATE", "manifest.limits.max_summary_kb invalid", { value: limitsObj.max_summary_kb ?? null });
      }
      if (!Number.isFinite(maxTotalSummaryKb) || maxTotalSummaryKb <= 0) {
        return err("INVALID_STATE", "manifest.limits.max_total_summary_kb invalid", { value: limitsObj.max_total_summary_kb ?? null });
      }

      const prepared: Array<{
        perspective_id: string;
        markdown: string;
        summary_path: string;
        summary_rel: string;
        source_artifact: string;
        cids: string[];
      }> = [];

      let totalKb = 0;
      for (const perspective of perspectives) {
        const sourceArtifactRel = perspective.source_artifact || `wave-1/${perspective.id}.md`;
        const fixtureFile = path.join(fixtureSummariesDir, `${perspective.id}.md`);
        let markdown: string;
        if (mode === "fixture") {
          try {
            markdown = await fs.promises.readFile(fixtureFile, "utf8");
          } catch (e) {
            if (errorCode(e) === "ENOENT") {
              return err("NOT_FOUND", "fixture summary missing", { perspective_id: perspective.id, fixture_file: fixtureFile });
            }
            throw e;
          }
        } else {
          const sourcePath = path.isAbsolute(sourceArtifactRel)
            ? sourceArtifactRel
            : path.join(runRoot, sourceArtifactRel);
          let sourceMarkdown: string;
          try {
            sourceMarkdown = await fs.promises.readFile(sourcePath, "utf8");
          } catch (e) {
            if (errorCode(e) === "ENOENT") {
              return err("NOT_FOUND", "generate source artifact missing", {
                perspective_id: perspective.id,
                source_artifact: sourceArtifactRel,
              });
            }
            throw e;
          }

          const sourceCids = extractCitationMentions(sourceMarkdown).filter((cid) => validatedCids.has(cid));
          const fallbackCid = [...validatedCids].sort((a, b) => a.localeCompare(b))[0] ?? "";
          const selectedCids = sourceCids.length > 0
            ? sourceCids.slice(0, 3)
            : fallbackCid
              ? [fallbackCid]
              : [];
          if (selectedCids.length === 0) {
            return err("SCHEMA_VALIDATION_FAILED", "generate mode requires at least one validated citation", {
              perspective_id: perspective.id,
            });
          }

          const candidateLines = sourceMarkdown
            .split(/\r?\n/)
            .map((line) => sanitizeSummaryLine(line))
            .filter((line) => line.length > 0)
            .filter((line) => !line.startsWith("## "));

          const uniqueLines: string[] = [];
          const seen = new Set<string>();
          for (const line of candidateLines) {
            if (seen.has(line)) continue;
            seen.add(line);
            uniqueLines.push(line);
            if (uniqueLines.length >= 3) break;
          }

          if (uniqueLines.length === 0) {
            uniqueLines.push(`Deterministic summary synthesized for ${perspective.id}.`);
          }

          const findings = uniqueLines
            .slice(0, 2)
            .map((line, idx) => `- ${line} [@${selectedCids[idx % selectedCids.length]}]`);
          const evidence = selectedCids.slice(0, 3).map((cid) => `- Supporting evidence [@${cid}]`);

          markdown = [
            "## Findings",
            ...findings,
            "",
            "## Evidence",
            ...evidence,
            "",
          ].join("\n");
        }

        if (hasRawHttpUrl(markdown)) {
          return err("RAW_URL_NOT_ALLOWED", "raw URL detected in summary fixture", {
            perspective_id: perspective.id,
            fixture_file: fixtureFile,
          });
        }

        const cids = extractCitationMentions(markdown);
        for (const cid of cids) {
          if (!validatedCids.has(cid)) {
            return err("UNKNOWN_CID", "summary references cid not present in validated pool", {
              perspective_id: perspective.id,
              cid,
            });
          }
        }

        const kb = Buffer.byteLength(markdown, "utf8") / 1024;
        if (kb > maxSummaryKb) {
          return err("SIZE_CAP_EXCEEDED", "summary exceeds max_summary_kb", {
            perspective_id: perspective.id,
            summary_kb: formatRate(kb),
            max_summary_kb: maxSummaryKb,
          });
        }

        const summaryPath = path.join(summariesDir, `${perspective.id}.md`);
        const summaryRel = toPosixPath(path.relative(runRoot, summaryPath));
        prepared.push({
          perspective_id: perspective.id,
          markdown,
          summary_path: summaryPath,
          summary_rel: summaryRel,
          source_artifact: sourceArtifactRel,
          cids,
        });
        totalKb += kb;
      }

      if (totalKb > maxTotalSummaryKb) {
        return err("SIZE_CAP_EXCEEDED", "total summaries exceed max_total_summary_kb", {
          total_summary_kb: formatRate(totalKb),
          max_total_summary_kb: maxTotalSummaryKb,
        });
      }

      await ensureDir(summariesDir);
      for (const item of prepared) {
        await atomicWriteText(item.summary_path, item.markdown);
      }

      const summaryPack = {
        schema_version: "summary_pack.v1",
        run_id: runId,
        generated_at: nowIso(),
        limits: {
          max_summary_kb: maxSummaryKb,
          max_total_summary_kb: maxTotalSummaryKb,
        },
        summaries: prepared.map((item) => ({
          perspective_id: item.perspective_id,
          source_artifact: item.source_artifact,
          summary_md: item.summary_rel,
          key_claims: [
            {
              claim: `Bounded synthesis summary for ${item.perspective_id}`,
              citation_cids: item.cids,
              confidence: 80,
            },
          ],
        })),
        total_estimated_tokens: Math.max(1, Math.round((totalKb * 1024) / 4)),
      };

      await atomicWriteJson(summaryPackPath, summaryPack);

      const inputsDigest = sha256DigestForJson({
        schema: "summary_pack_build.inputs.v1",
        mode,
        run_id: runId,
        manifest_revision: Number(manifest.revision ?? 0),
        perspectives: prepared.map((item) => item.perspective_id),
        validated_cids: [...validatedCids].sort((a, b) => a.localeCompare(b)),
        artifacts: prepared.map((item) => ({
          perspective_id: item.perspective_id,
          source_artifact: item.source_artifact,
          hash: sha256HexLowerUtf8(item.markdown),
        })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "summary_pack_build",
            run_id: runId,
            reason,
            summary_count: prepared.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        summary_pack_path: summaryPackPath,
        summaries_dir: summariesDir,
        summary_count: prepared.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "summary_pack_build failed", { message: String(e) });
    }
  },
});

export const deep_research_summary_pack_build = summary_pack_build;
