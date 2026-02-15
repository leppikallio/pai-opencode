import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { validateManifestV1 } from "./schema_v1";
import {
  atomicWriteText,
  err,
  errorCode,
  getManifestPaths,
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
      if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });

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
      if (!fixtureDraftPath || !path.isAbsolute(fixtureDraftPath)) {
        return err("INVALID_ARGS", "fixture_draft_path must be absolute in fixture mode", {
          fixture_draft_path: args.fixture_draft_path ?? null,
        });
      }

      await readJson(summaryPackPath);
      const validatedCids = await readValidatedCids(citationsPath);

      const markdown = await fs.promises.readFile(fixtureDraftPath, "utf8");
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
        run_id: runId,
        summary_pack_path: toPosixPath(path.relative(runRoot, summaryPackPath)),
        fixture_draft_hash: sha256HexLowerUtf8(markdown),
        cited,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
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
