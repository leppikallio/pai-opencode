import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { validateManifestV1 } from "./schema_v1";
import {
  atomicWriteJson,
  atomicWriteText,
  err,
  errorCode,
  getManifestPaths,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  sha256HexLowerUtf8,
} from "./utils";
import { appendAuditJsonl } from "./wave_tools_shared";
import { toPosixPath } from "./citations_lib";
import {
  extractCitationMentions,
  hasHeading,
  readValidatedCids,
  requiredSynthesisHeadingsV1,
  resolveArtifactPath,
  resolveRunRootFromManifest,
} from "./phase05_lib";

function sanitizeSynthesisLine(input: string): string {
  return input
    .replace(/\[@[A-Za-z0-9_:-]+\]/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\b\d+(?:\.\d+)?%?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const synthesis_write = tool({
  description: "Write bounded synthesis draft from summary-pack and citations",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute path to summary-pack.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Write mode"),
    fixture_draft_path: tool.schema.string().optional().describe("Absolute fixture markdown path for mode=fixture"),
    output_path: tool.schema.string().optional().describe("Absolute synthesis output path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    summary_pack_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_draft_path?: string;
    output_path?: string;
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

      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const outputPath = resolveArtifactPath(
        args.output_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/draft-synthesis.md` : undefined,
        "synthesis/draft-synthesis.md",
      );
      const fixtureDraftPath = (args.fixture_draft_path ?? "").trim();

      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(outputPath)) return err("INVALID_ARGS", "output_path must be absolute", { output_path: args.output_path ?? null });
      if (mode === "fixture" && (!fixtureDraftPath || !path.isAbsolute(fixtureDraftPath))) {
        return err("INVALID_ARGS", "fixture_draft_path must be absolute in fixture mode", {
          fixture_draft_path: args.fixture_draft_path ?? null,
        });
      }

      const summaryPackRaw = await readJson(summaryPackPath);
      if (!isPlainObject(summaryPackRaw) || summaryPackRaw.schema_version !== "summary_pack.v1") {
        return err("SCHEMA_VALIDATION_FAILED", "summary-pack schema_version must be summary_pack.v1", {
          summary_pack_path: summaryPackPath,
        });
      }
      const summaryPackDoc = summaryPackRaw as Record<string, unknown>;
      const validatedCids = await readValidatedCids(citationsPath);

      let markdown: string;
      if (mode === "fixture") {
        markdown = await fs.promises.readFile(fixtureDraftPath, "utf8");
      } else {
        const entries = Array.isArray(summaryPackDoc.summaries)
          ? (summaryPackDoc.summaries as Array<Record<string, unknown>>)
          : [];

        const collectedCids = new Set<string>();
        const keyFindings: string[] = [];

        for (const entry of entries) {
          const perspectiveId = String(entry.perspective_id ?? "").trim() || "unknown";
          const summaryMd = String(entry.summary_md ?? "").trim();
          if (summaryMd) {
            const summaryPath = path.isAbsolute(summaryMd)
              ? summaryMd
              : path.join(runRoot, summaryMd);
            try {
              const content = await fs.promises.readFile(summaryPath, "utf8");
              for (const cid of extractCitationMentions(content)) {
                if (validatedCids.has(cid)) collectedCids.add(cid);
              }

              const summaryLines = content
                .split(/\r?\n/)
                .map((line: string) => sanitizeSynthesisLine(line))
                .filter((line: string) => line.length > 0)
                .filter((line: string) => !line.startsWith("## "));
              if (summaryLines.length > 0) {
                keyFindings.push(`${summaryLines[0]} (${perspectiveId})`);
              }
            } catch (e) {
              if (errorCode(e) === "ENOENT") {
                return err("NOT_FOUND", "summary markdown missing", {
                  perspective_id: perspectiveId,
                  summary_md: summaryMd,
                });
              }
              throw e;
            }
          }

          const keyClaims = Array.isArray(entry.key_claims)
            ? (entry.key_claims as Array<Record<string, unknown>>)
            : [];
          for (const keyClaim of keyClaims) {
            const claimCids = Array.isArray(keyClaim.citation_cids)
              ? keyClaim.citation_cids
              : [];
            for (const cidRaw of claimCids) {
              const cid = String(cidRaw ?? "").trim();
              if (cid && validatedCids.has(cid)) collectedCids.add(cid);
            }
          }
        }

        const selectedCids = [...collectedCids].sort((a, b) => a.localeCompare(b));
        if (selectedCids.length === 0) {
          const fallbackCid = [...validatedCids].sort((a, b) => a.localeCompare(b))[0] ?? "";
          if (fallbackCid) selectedCids.push(fallbackCid);
        }
        if (selectedCids.length === 0) {
          return err("SCHEMA_VALIDATION_FAILED", "generate mode requires at least one validated citation", {
            summary_pack_path: summaryPackPath,
          });
        }

        const findings = (keyFindings.length > 0
          ? keyFindings.slice(0, 3)
          : ["Bounded synthesis compiled from generated summaries"])
          .map((line, idx) => `- ${line} [@${selectedCids[idx % selectedCids.length]}]`);
        const evidence = selectedCids.slice(0, 4).map((cid) => `- Supporting citation [@${cid}]`);

        markdown = [
          "## Summary",
          `Generated synthesis draft based on validated summary artifacts [@${selectedCids[0]}]`,
          "",
          "## Key Findings",
          ...findings,
          "",
          "## Evidence",
          ...evidence,
          "",
          "## Caveats",
          "- This draft is bounded by available summaries and validated citations.",
          "",
        ].join("\n");
      }

      const requiredHeadings = requiredSynthesisHeadingsV1();
      for (const heading of requiredHeadings) {
        if (!hasHeading(markdown, heading)) {
          return err("SCHEMA_VALIDATION_FAILED", "missing required synthesis heading", {
            heading,
          });
        }
      }

      const cited = extractCitationMentions(markdown);
      if (cited.length === 0) return err("SCHEMA_VALIDATION_FAILED", "draft must include citation syntax [@cid]");
      for (const cid of cited) {
        if (!validatedCids.has(cid)) {
          return err("UNKNOWN_CID", "draft references cid not present in validated pool", { cid });
        }
      }

      await atomicWriteText(outputPath, markdown);

      const inputsDigest = sha256DigestForJson({
        schema: "synthesis_write.inputs.v1",
        mode,
        run_id: runId,
        summary_pack_path: toPosixPath(path.relative(runRoot, summaryPackPath)),
        draft_hash: sha256HexLowerUtf8(markdown),
        cited,
      });

      const generatedAt = nowIso();
      const synthesisMetaPath = path.join(path.dirname(outputPath), "final-synthesis.meta.json");
      await atomicWriteJson(synthesisMetaPath, {
        schema_version: "synthesis_meta.v1",
        mode,
        generated_at: generatedAt,
        inputs_digest: inputsDigest,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: generatedAt,
            kind: "synthesis_write",
            run_id: runId,
            reason,
            output_path: toPosixPath(path.relative(runRoot, outputPath)),
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        output_path: outputPath,
        meta_path: synthesisMetaPath,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "synthesis_write failed", { message: String(e) });
    }
  },
});

export const deep_research_synthesis_write = synthesis_write;
