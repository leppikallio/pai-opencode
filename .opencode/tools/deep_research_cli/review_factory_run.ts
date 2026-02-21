import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { validateManifestV1 } from "./schema_v1";
import {
  atomicWriteJson,
  err,
  errorCode,
  getManifestPaths,
  isPlainObject,
  ok,
  readJson,
  sha256DigestForJson,
} from "./utils";
import { appendAuditJsonl, nowIso } from "./wave_tools_shared";
import {
  countUncitedNumericClaims,
  extractCitationMentions,
  hasHeading,
  readValidatedCids,
  requiredSynthesisHeadingsV1,
  resolveArtifactPath,
  resolveRunRootFromManifest,
} from "./phase05_lib";

export const review_factory_run = tool({
  description: "Run deterministic fixture-based reviewer aggregation",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    draft_path: tool.schema.string().optional().describe("Absolute path to synthesis draft markdown"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Reviewer mode"),
    fixture_bundle_dir: tool.schema.string().optional().describe("Absolute fixture directory containing review-bundle.json"),
    review_dir: tool.schema.string().optional().describe("Absolute review output directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    draft_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_bundle_dir?: string;
    review_dir?: string;
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

      const draftPath = resolveArtifactPath(
        args.draft_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/draft-synthesis.md` : undefined,
        "synthesis/draft-synthesis.md",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const reviewDir = resolveArtifactPath(args.review_dir, runRoot, undefined, "review");
      const fixtureBundleDir = (args.fixture_bundle_dir ?? "").trim();
      if (mode === "fixture" && (!fixtureBundleDir || !path.isAbsolute(fixtureBundleDir))) {
        return err("INVALID_ARGS", "fixture_bundle_dir must be absolute in fixture mode", {
          fixture_bundle_dir: args.fixture_bundle_dir ?? null,
        });
      }

      const draftMarkdown = await fs.promises.readFile(draftPath, "utf8");
      await fs.promises.readFile(citationsPath, "utf8");

      let decision: "PASS" | "CHANGES_REQUIRED";
      let findings: unknown[];
      let directives: unknown[];

      if (mode === "fixture") {
        const fixtureBundlePath = path.join(fixtureBundleDir, "review-bundle.json");
        const fixtureBundleRaw = await readJson(fixtureBundlePath);
        if (!isPlainObject(fixtureBundleRaw)) {
          return err("SCHEMA_VALIDATION_FAILED", "fixture review bundle must be object", {
            fixture_bundle_path: fixtureBundlePath,
          });
        }

        const fixtureDoc = fixtureBundleRaw as Record<string, unknown>;
        const fixtureDecision = String(fixtureDoc.decision ?? "").trim();
        if (fixtureDecision !== "PASS" && fixtureDecision !== "CHANGES_REQUIRED") {
          return err("SCHEMA_VALIDATION_FAILED", "review bundle decision invalid", { decision: fixtureDecision });
        }

        decision = fixtureDecision;
        findings = Array.isArray(fixtureDoc.findings)
          ? (fixtureDoc.findings as unknown[]).slice(0, 100)
          : [];
        directives = Array.isArray(fixtureDoc.directives)
          ? (fixtureDoc.directives as unknown[]).slice(0, 100)
          : [];
      } else {
        const requiredHeadings = requiredSynthesisHeadingsV1();
        const missingHeadings = requiredHeadings.filter((heading) => !hasHeading(draftMarkdown, heading));
        const cited = extractCitationMentions(draftMarkdown);
        const validatedCids = await readValidatedCids(citationsPath);
        const unknownCids = cited.filter((cid) => !validatedCids.has(cid));
        const uncitedNumericClaims = countUncitedNumericClaims(draftMarkdown);

        findings = [];
        directives = [];

        if (missingHeadings.length > 0) {
          findings.push({
            id: "missing_required_headings",
            severity: "high",
            message: `Missing required headings: ${missingHeadings.join(", ")}`,
          });
          directives.push({
            id: "add_required_headings",
            action: "Add all required synthesis headings",
            headings: missingHeadings,
          });
        }

        if (cited.length === 0) {
          findings.push({
            id: "missing_citations",
            severity: "high",
            message: "Draft must include citation syntax [@cid]",
          });
          directives.push({
            id: "add_citations",
            action: "Add at least one validated citation reference",
          });
        }

        if (unknownCids.length > 0) {
          findings.push({
            id: "unknown_cids",
            severity: "high",
            message: `Unknown citation ids: ${unknownCids.join(", ")}`,
          });
          directives.push({
            id: "replace_unknown_cids",
            action: "Replace unknown citations with validated citation ids",
            cids: unknownCids,
          });
        }

        if (uncitedNumericClaims > 0) {
          findings.push({
            id: "uncited_numeric_claims",
            severity: "high",
            message: `Detected ${uncitedNumericClaims} uncited numeric claim(s)`,
          });
          directives.push({
            id: "cite_numeric_claims",
            action: "Add citations near numeric claims or remove unsupported numbers",
          });
        }

        decision = findings.length === 0 ? "PASS" : "CHANGES_REQUIRED";
      }

      const reviewBundle = {
        schema_version: "review_bundle.v1",
        run_id: runId,
        decision,
        findings,
        directives,
      };

      await ensureDir(reviewDir);
      const reviewBundlePath = path.join(reviewDir, "review-bundle.json");
      await atomicWriteJson(reviewBundlePath, reviewBundle);
      await atomicWriteJson(path.join(reviewDir, "revision-directives.json"), {
        schema_version: "revision_directives.v1",
        run_id: runId,
        directives,
      });

      const inputsDigest = sha256DigestForJson({
        schema: "review_factory_run.inputs.v1",
        run_id: runId,
        decision,
        findings_count: findings.length,
        directives_count: directives.length,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "review_factory_run",
            run_id: runId,
            reason,
            decision,
            findings_count: findings.length,
            directives_count: directives.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        review_bundle_path: reviewBundlePath,
        decision,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "review_factory_run failed", { message: String(e) });
    }
  },
});

export const deep_research_review_factory_run = review_factory_run;
