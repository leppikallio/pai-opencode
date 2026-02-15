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
      if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });

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
      if (!fixtureBundleDir || !path.isAbsolute(fixtureBundleDir)) {
        return err("INVALID_ARGS", "fixture_bundle_dir must be absolute in fixture mode", {
          fixture_bundle_dir: args.fixture_bundle_dir ?? null,
        });
      }

      await fs.promises.readFile(draftPath, "utf8");
      await fs.promises.readFile(citationsPath, "utf8");

      const fixtureBundlePath = path.join(fixtureBundleDir, "review-bundle.json");
      const fixtureBundleRaw = await readJson(fixtureBundlePath);
      if (!isPlainObject(fixtureBundleRaw)) {
        return err("SCHEMA_VALIDATION_FAILED", "fixture review bundle must be object", {
          fixture_bundle_path: fixtureBundlePath,
        });
      }

      const fixtureDoc = fixtureBundleRaw as Record<string, unknown>;
      const decision = String(fixtureDoc.decision ?? "").trim();
      if (decision !== "PASS" && decision !== "CHANGES_REQUIRED") {
        return err("SCHEMA_VALIDATION_FAILED", "review bundle decision invalid", { decision });
      }

      const findings = Array.isArray(fixtureDoc.findings)
        ? (fixtureDoc.findings as unknown[]).slice(0, 100)
        : [];
      const directives = Array.isArray(fixtureDoc.directives)
        ? (fixtureDoc.directives as unknown[]).slice(0, 100)
        : [];

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
