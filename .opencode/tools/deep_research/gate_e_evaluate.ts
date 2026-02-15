import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { toPosixPath } from "./citations_lib";
import { validateManifestV1 } from "./schema_v1";
import {
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
import {
  countUncitedNumericClaims,
  formatRate,
  readValidatedCids,
  requiredSynthesisHeadingsV1,
  resolveArtifactPath,
  resolveRunRootFromManifest,
  hasHeading,
} from "./phase05_lib";

export const gate_e_evaluate = tool({
  description: "Compute deterministic Gate E metrics from final synthesis",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    synthesis_path: tool.schema.string().optional().describe("Absolute path to final-synthesis.md"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    synthesis_path?: string;
    citations_path?: string;
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

      const synthesisPath = resolveArtifactPath(
        args.synthesis_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/final-synthesis.md` : undefined,
        "synthesis/final-synthesis.md",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );

      if (!path.isAbsolute(synthesisPath)) return err("INVALID_ARGS", "synthesis_path must be absolute", { synthesis_path: args.synthesis_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });

      const markdown = await fs.promises.readFile(synthesisPath, "utf8");
      const validatedCids = await readValidatedCids(citationsPath);
      const requiredHeadings = requiredSynthesisHeadingsV1();
      const headingsPresent = requiredHeadings.filter((heading) => hasHeading(markdown, heading)).length;
      const reportSectionsPresent = requiredHeadings.length > 0
        ? formatRate(headingsPresent / requiredHeadings.length)
        : 0;

      const allMentions = [...markdown.matchAll(/\[@([A-Za-z0-9_:-]+)\]/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
      const usedValidCidSet = new Set<string>();
      for (const cid of allMentions) {
        if (validatedCids.has(cid)) usedValidCidSet.add(cid);
      }

      const validatedCidsCount = validatedCids.size;
      const usedCidsCount = usedValidCidSet.size;
      const totalCidMentions = allMentions.length;

      const citationUtilizationRate = validatedCidsCount > 0
        ? formatRate(usedCidsCount / validatedCidsCount)
        : 0;
      const duplicateCitationRate = totalCidMentions > 0
        ? formatRate(1 - (usedCidsCount / totalCidMentions))
        : 0;

      const uncitedNumericClaims = countUncitedNumericClaims(markdown);

      const metrics = {
        uncited_numeric_claims: uncitedNumericClaims,
        report_sections_present: reportSectionsPresent,
        citation_utilization_rate: citationUtilizationRate,
        duplicate_citation_rate: duplicateCitationRate,
      };

      const warnings: string[] = [];
      if (citationUtilizationRate < 0.6) warnings.push("LOW_CITATION_UTILIZATION");
      if (duplicateCitationRate > 0.2) warnings.push("HIGH_DUPLICATE_CITATION_RATE");

      const passHard = uncitedNumericClaims === 0 && reportSectionsPresent === 1;
      const status: "pass" | "fail" = passHard ? "pass" : "fail";
      const checkedAt = nowIso();
      const update = {
        E: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, synthesisPath)),
            toPosixPath(path.relative(runRoot, citationsPath)),
          ],
          warnings,
          notes: passHard
            ? "Gate E hard metrics satisfied"
            : "Gate E hard metric failure",
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_e_evaluate.inputs.v1",
        run_id: runId,
        markdown_hash: sha256HexLowerUtf8(markdown),
        validated_cids_count: validatedCidsCount,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_e_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            warnings,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "E",
        status,
        metrics,
        warnings,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_e_evaluate failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_e_evaluate = gate_e_evaluate;
