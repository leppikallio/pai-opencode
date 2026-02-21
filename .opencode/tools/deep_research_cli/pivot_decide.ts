import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  compareGapPriority,
  err,
  errorCode,
  extractPivotGapsFromMarkdown,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  normalizeGapPriority,
  normalizeOutputPathForPivotArtifact,
  normalizeTagList,
  normalizeWhitespace,
  nowIso,
  ok,
  readJson,
  resolveRunPath,
  sha256DigestForJson,
  validateManifestV1,
} from "./wave_tools_shared";

export const pivot_decide = tool({
  description: "Build deterministic pivot decision artifact from Wave 1 outputs",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    wave1_outputs: tool.schema.unknown().describe("Array of { perspective_id, output_md_path }"),
    wave1_validation_reports: tool.schema.unknown().describe("Array of validator success reports from deep_research_wave_output_validate"),
    explicit_gaps: tool.schema.unknown().optional().describe("Optional normalized explicit gaps"),
    reason: tool.schema.string().optional().describe("Optional audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    wave1_outputs: unknown;
    wave1_validation_reports: unknown;
    explicit_gaps?: unknown;
    reason?: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
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

      const pathsObj = getManifestPaths(manifest);
      const pivotFile = String(pathsObj.pivot_file ?? "pivot.json");
      const pivotPath = path.isAbsolute(pivotFile) ? pivotFile : path.join(runRoot, pivotFile);

      if (!Array.isArray(args.wave1_outputs) || !Array.isArray(args.wave1_validation_reports)) {
        return err("INVALID_ARGS", "wave1_outputs and wave1_validation_reports must be arrays");
      }
      if (args.wave1_outputs.length === 0) {
        return err("INVALID_ARGS", "wave1_outputs must contain at least one entry");
      }
      if (args.wave1_outputs.length !== args.wave1_validation_reports.length) {
        return err("INVALID_ARGS", "wave1_outputs and wave1_validation_reports length mismatch", {
          wave1_outputs: args.wave1_outputs.length,
          wave1_validation_reports: args.wave1_validation_reports.length,
        });
      }

      const seenPerspectiveIds = new Set<string>();
      const wave1Pairs: Array<{
        perspective_id: string;
        output_abs_path: string;
        output_md: string;
        validator_report: {
          ok: true;
          perspective_id: string;
          markdown_path: string;
          words: number;
          sources: number;
          missing_sections: string[];
        };
      }> = [];

      for (let i = 0; i < args.wave1_outputs.length; i += 1) {
        const outputRaw = args.wave1_outputs[i];
        const reportRaw = args.wave1_validation_reports[i];

        if (!isPlainObject(outputRaw)) {
          return err("INVALID_ARGS", "wave1_outputs entry must be object", { index: i });
        }
        if (!isPlainObject(reportRaw)) {
          return err("INVALID_ARGS", "wave1_validation_reports entry must be object", { index: i });
        }

        const perspectiveId = normalizeWhitespace(String(outputRaw.perspective_id ?? ""));
        const outputObj = isPlainObject(outputRaw) ? (outputRaw as Record<string, unknown>) : {};
        const outputMdPathRaw = normalizeWhitespace(String(outputObj.output_md_path ?? ""));
        if (!perspectiveId) {
          return err("INVALID_ARGS", "wave1_outputs perspective_id missing", { index: i });
        }
        if (!outputMdPathRaw) {
          return err("INVALID_ARGS", "wave1_outputs output_md_path missing", { index: i, perspective_id: perspectiveId });
        }
        if (seenPerspectiveIds.has(perspectiveId)) {
          return err("INVALID_ARGS", "wave1_outputs perspective_id must be unique", { perspective_id: perspectiveId });
        }
        seenPerspectiveIds.add(perspectiveId);

        if (reportRaw.ok !== true) {
          return err("WAVE1_NOT_VALIDATED", "wave1 validation report has ok=false", {
            index: i,
            perspective_id: perspectiveId,
          });
        }

        const reportPerspectiveId = normalizeWhitespace(String(reportRaw.perspective_id ?? ""));
        if (!reportPerspectiveId || reportPerspectiveId !== perspectiveId) {
          return err("MISMATCHED_PERSPECTIVE_ID", "output/report perspective mismatch", {
            index: i,
            output_perspective_id: perspectiveId,
            report_perspective_id: reportPerspectiveId,
          });
        }

        const missingSectionsRaw = reportRaw.missing_sections;
        if (!Array.isArray(missingSectionsRaw)) {
          return err("INVALID_ARGS", "validation report missing_sections must be array", {
            index: i,
            perspective_id: perspectiveId,
          });
        }
        const missingSections = missingSectionsRaw
          .map((value) => normalizeWhitespace(String(value ?? "")))
          .filter((value) => value.length > 0);
        if (missingSections.length > 0) {
          return err("WAVE1_CONTRACT_NOT_MET", "wave1 report contains missing sections", {
            perspective_id: perspectiveId,
            missing_sections: missingSections,
          });
        }

        const markdownPath = normalizeWhitespace(String(reportRaw.markdown_path ?? ""));
        if (!markdownPath) {
          return err("INVALID_ARGS", "validation report markdown_path missing", {
            index: i,
            perspective_id: perspectiveId,
          });
        }

        const words = Number(reportRaw.words ?? Number.NaN);
        const sources = Number(reportRaw.sources ?? Number.NaN);
        if (!Number.isFinite(words) || words < 0 || !Number.isFinite(sources) || sources < 0) {
          return err("INVALID_ARGS", "validation report words/sources invalid", {
            index: i,
            perspective_id: perspectiveId,
            words: reportRaw.words ?? null,
            sources: reportRaw.sources ?? null,
          });
        }

        const outputAbsPath = resolveRunPath(runRoot, outputMdPathRaw);
        const outputMd = normalizeOutputPathForPivotArtifact(runRoot, outputAbsPath);

        wave1Pairs.push({
          perspective_id: perspectiveId,
          output_abs_path: outputAbsPath,
          output_md: outputMd,
          validator_report: {
            ok: true,
            perspective_id: reportPerspectiveId,
            markdown_path: markdownPath,
            words: Math.floor(words),
            sources: Math.floor(sources),
            missing_sections: [],
          },
        });
      }

      let gaps: Array<{
        gap_id: string;
        priority: "P0" | "P1" | "P2" | "P3";
        text: string;
        tags: string[];
        source: "explicit" | "parsed_wave1";
        from_perspective_id?: string;
      }> = [];
      if (args.explicit_gaps !== undefined && args.explicit_gaps !== null) {
        if (!Array.isArray(args.explicit_gaps)) {
          return err("INVALID_ARGS", "explicit_gaps must be an array when provided");
        }

        if (args.explicit_gaps.length > 0) {
          const seenGapIds = new Set<string>();
          for (let i = 0; i < args.explicit_gaps.length; i += 1) {
            const entry = args.explicit_gaps[i];
            if (!isPlainObject(entry)) {
              return err("INVALID_ARGS", "explicit_gaps entry must be object", { index: i });
            }

            const gapId = normalizeWhitespace(String(entry.gap_id ?? ""));
            if (!gapId) return err("INVALID_ARGS", "explicit gap_id missing", { index: i });
            if (seenGapIds.has(gapId)) {
              return err("DUPLICATE_GAP_ID", "duplicate explicit gap_id", { gap_id: gapId });
            }
            seenGapIds.add(gapId);

            const priority = normalizeGapPriority(entry.priority);
            if (!priority) {
              return err("INVALID_GAP_PRIORITY", "gap priority must be one of P0|P1|P2|P3", {
                gap_id: gapId,
                priority: entry.priority ?? null,
              });
            }

            const text = normalizeWhitespace(String(entry.text ?? ""));
            if (!text) return err("INVALID_ARGS", "explicit gap text missing", { gap_id: gapId });

            const fromPerspectiveId = normalizeWhitespace(String(entry.from_perspective_id ?? ""));
            const gap = {
              gap_id: gapId,
              priority,
              text,
              tags: normalizeTagList(entry.tags),
              source: "explicit" as const,
            };
            if (fromPerspectiveId) {
              gaps.push({ ...gap, from_perspective_id: fromPerspectiveId });
            } else {
              gaps.push(gap);
            }
          }
        }
      }

      if (gaps.length === 0 && (!Array.isArray(args.explicit_gaps) || args.explicit_gaps.length === 0)) {
        for (const pair of wave1Pairs) {
          let markdown: string;
          try {
            markdown = await fs.promises.readFile(pair.output_abs_path, "utf8");
          } catch (e) {
            if (errorCode(e) === "ENOENT") {
              return err("NOT_FOUND", "wave1 output markdown not found", {
                perspective_id: pair.perspective_id,
                output_md_path: pair.output_abs_path,
              });
            }
            throw e;
          }

          const extracted = extractPivotGapsFromMarkdown(markdown, pair.perspective_id);
          if (extracted.ok === false) {
            return err(extracted.code, extracted.message, extracted.details);
          }
          gaps.push(...extracted.gaps);
        }
      }

      gaps = gaps.sort((a, b) => {
        const byPriority = compareGapPriority(a.priority, b.priority);
        if (byPriority !== 0) return byPriority;
        return a.gap_id.localeCompare(b.gap_id);
      });

      const p0Count = gaps.filter((gap) => gap.priority === "P0").length;
      const p1Count = gaps.filter((gap) => gap.priority === "P1").length;
      const p2Count = gaps.filter((gap) => gap.priority === "P2").length;
      const p3Count = gaps.filter((gap) => gap.priority === "P3").length;
      const totalGaps = gaps.length;

      let wave2Required = false;
      let ruleHit = "Wave2Skip.NoGaps";
      let explanation = "Wave 2 skipped because total_gaps=0 (rule Wave2Skip.NoGaps).";

      if (p0Count >= 1) {
        wave2Required = true;
        ruleHit = "Wave2Required.P0";
        explanation = `Wave 2 required because p0_count=${p0Count} (rule Wave2Required.P0).`;
      } else if (p1Count >= 2) {
        wave2Required = true;
        ruleHit = "Wave2Required.P1";
        explanation = `Wave 2 required because p1_count=${p1Count} (rule Wave2Required.P1).`;
      } else if (totalGaps >= 4 && (p1Count + p2Count) >= 3) {
        wave2Required = true;
        ruleHit = "Wave2Required.Volume";
        explanation = `Wave 2 required because total_gaps=${totalGaps} and p1_count+p2_count=${p1Count + p2Count} (rule Wave2Required.Volume).`;
      } else {
        wave2Required = false;
        ruleHit = "Wave2Skip.NoGaps";
        explanation = `Wave 2 skipped because total_gaps=${totalGaps} (rule Wave2Skip.NoGaps).`;
      }

      let wave2GapIds: string[] = [];
      if (wave2Required) {
        wave2GapIds = gaps
          .filter((gap) => gap.priority === "P0" || gap.priority === "P1")
          .map((gap) => gap.gap_id);
        if (wave2GapIds.length === 0) {
          wave2GapIds = gaps.slice(0, 3).map((gap) => gap.gap_id);
        }
      }

      const sortedWave1 = [...wave1Pairs].sort((a, b) => a.perspective_id.localeCompare(b.perspective_id));
      const wave1Outputs = sortedWave1.map((entry) => ({
        perspective_id: entry.perspective_id,
        output_md: entry.output_md,
        validator_report: entry.validator_report,
      }));

      const normalizedGapsForDigest = gaps.map((gap) => {
        const out: Record<string, unknown> = {
          gap_id: gap.gap_id,
          priority: gap.priority,
          text: gap.text,
          tags: gap.tags,
          source: gap.source,
        };
        if (gap.from_perspective_id) out.from_perspective_id = gap.from_perspective_id;
        return out;
      });

      const inputsDigest = sha256DigestForJson({
        wave1_validation_reports: wave1Outputs.map((entry) => entry.validator_report),
        gaps: normalizedGapsForDigest,
      });

      const generatedAt = nowIso();
      const pivotDecision = {
        schema_version: "pivot_decision.v1",
        run_id: runId,
        generated_at: generatedAt,
        inputs_digest: inputsDigest,
        wave1: {
          outputs: wave1Outputs,
        },
        gaps: normalizedGapsForDigest,
        decision: {
          wave2_required: wave2Required,
          rule_hit: ruleHit,
          metrics: {
            p0_count: p0Count,
            p1_count: p1Count,
            p2_count: p2Count,
            p3_count: p3Count,
            total_gaps: totalGaps,
          },
          explanation,
          wave2_gap_ids: wave2GapIds,
        },
      };

      await atomicWriteJson(pivotPath, pivotDecision);

      const reason = normalizeWhitespace(String(args.reason ?? ""));
      let auditWritten = false;
      if (reason) {
        try {
          await appendAuditJsonl({
            runRoot,
            event: {
              ts: generatedAt,
              kind: "pivot_decide",
              run_id: runId,
              reason,
              pivot_path: pivotPath,
              wave2_required: wave2Required,
              rule_hit: ruleHit,
              inputs_digest: inputsDigest,
            },
          });
          auditWritten = true;
        } catch {
          auditWritten = false;
        }
      }

      return ok({
        pivot_path: pivotPath,
        wave2_required: wave2Required,
        rule_hit: ruleHit,
        inputs_digest: inputsDigest,
        total_gaps: totalGaps,
        audit_written: auditWritten,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact not found");
      return err("WRITE_FAILED", "pivot_decide failed", { message: String(e) });
    }
  },
});
