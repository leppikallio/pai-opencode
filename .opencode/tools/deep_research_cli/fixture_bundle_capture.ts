import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { appendAuditJsonl } from "./citations_lib";
import {
  FIXTURE_BUNDLE_SCHEMA_VERSION,
  atomicWriteCanonicalJson,
  bundlePath,
  resolveArtifactPath,
  resolveRunRootFromManifest,
  sha256DigestForFile,
  sortedLex,
} from "./deep_research_shared_lib";
import { validateGatesV1, validateManifestV1 } from "./schema_v1";
import { statPath } from "./wave_tools_io";
import {
  err,
  errorCode,
  getManifestPaths,
  nowIso,
  ok,
  readJson,
} from "./utils";

export const fixture_bundle_capture = tool({
  description: "Capture deterministic fixture bundle for offline replay",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to source manifest.json"),
    output_dir: tool.schema.string().describe("Absolute parent output directory"),
    bundle_id: tool.schema.string().describe("Stable fixture bundle id"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; output_dir: string; bundle_id: string; reason: string }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const outputDir = args.output_dir.trim();
      const bundleId = args.bundle_id.trim();
      const reason = args.reason.trim();

      if (!manifestPath || !path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!outputDir || !path.isAbsolute(outputDir)) return err("INVALID_ARGS", "output_dir must be absolute", { output_dir: args.output_dir });
      if (!bundleId) return err("INVALID_ARGS", "bundle_id must be non-empty");
      if (bundleId.includes("/") || bundleId.includes("\\") || bundleId === "." || bundleId === "..") {
        return err("INVALID_ARGS", "bundle_id must be a single safe path segment", { bundle_id: args.bundle_id });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;

      const runId = String(manifest.run_id ?? "").trim();
      if (!runId) return err("INVALID_STATE", "manifest.run_id missing");

      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const sourcePaths: Record<string, string> = {
        "manifest.json": manifestPath,
        "gates.json": resolveArtifactPath(undefined, runRoot, typeof artifactPaths.gates_file === "string" ? artifactPaths.gates_file : undefined, "gates.json"),
        "citations/citations.jsonl": resolveArtifactPath(undefined, runRoot, typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined, "citations/citations.jsonl"),
        "synthesis/final-synthesis.md": resolveArtifactPath(
          undefined,
          runRoot,
          typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/final-synthesis.md` : undefined,
          "synthesis/final-synthesis.md",
        ),
        "reports/gate-e-citation-utilization.json": path.join(runRoot, "reports", "gate-e-citation-utilization.json"),
        "reports/gate-e-numeric-claims.json": path.join(runRoot, "reports", "gate-e-numeric-claims.json"),
        "reports/gate-e-sections-present.json": path.join(runRoot, "reports", "gate-e-sections-present.json"),
        "reports/gate-e-status.json": path.join(runRoot, "reports", "gate-e-status.json"),
      };

      const relPaths = sortedLex(Object.keys(sourcePaths));
      const missing: string[] = [];
      const invalid: string[] = [];
      for (const relPath of relPaths) {
        const src = sourcePaths[relPath] ?? "";
        const st = await statPath(src);
        if (!st) {
          missing.push(relPath);
          continue;
        }
        if (!st.isFile()) invalid.push(relPath);
      }
      if (missing.length > 0 || invalid.length > 0) {
        return err("BUNDLE_INVALID", "required source artifacts missing or invalid", {
          missing,
          invalid,
        });
      }

      const gatesRaw = await readJson(sourcePaths["gates.json"] as string);
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;
      const gatesDoc = gatesRaw as Record<string, unknown>;
      const gatesRunId = String(gatesDoc.run_id ?? "").trim();
      if (!gatesRunId || gatesRunId !== runId) {
        return err("BUNDLE_INVALID", "manifest and gates run_id mismatch", {
          manifest_run_id: runId,
          gates_run_id: gatesRunId || null,
        });
      }

      const bundleRoot = path.join(outputDir, bundleId);
      await ensureDir(bundleRoot);

      const sha256: Record<string, string> = {};
      for (const relPath of relPaths) {
        const src = sourcePaths[relPath] as string;
        const dst = bundlePath(bundleRoot, relPath);
        await ensureDir(path.dirname(dst));
        await fs.promises.copyFile(src, dst);
        sha256[relPath] = await sha256DigestForFile(dst);
      }

      const includedPaths = sortedLex(["bundle.json", ...relPaths]);
      const inputsDigest = String(gatesDoc.inputs_digest ?? "").trim();
      const bundleDoc: Record<string, unknown> = {
        schema_version: FIXTURE_BUNDLE_SCHEMA_VERSION,
        bundle_id: bundleId,
        run_id: runId,
        created_at: nowIso(),
        no_web: true,
        included_paths: includedPaths,
        sha256,
      };
      if (inputsDigest) bundleDoc.inputs_digest = inputsDigest;

      const bundleJsonPath = bundlePath(bundleRoot, "bundle.json");
      await atomicWriteCanonicalJson(bundleJsonPath, bundleDoc);

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "fixture_bundle_capture",
            run_id: runId,
            reason,
            bundle_id: bundleId,
            bundle_root: bundleRoot,
            included_paths: includedPaths,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        schema_version: FIXTURE_BUNDLE_SCHEMA_VERSION,
        bundle_id: bundleId,
        bundle_root: bundleRoot,
        bundle_json_path: bundleJsonPath,
        run_id: runId,
        no_web: true,
        included_paths: includedPaths,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "fixture_bundle_capture failed", { message: String(e) });
    }
  },
});

export const deep_research_fixture_bundle_capture = fixture_bundle_capture;
