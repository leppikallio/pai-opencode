import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteText,
  err,
  errorCode,
  getManifestArtifacts,
  getStringProp,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  validateManifestV1,
} from "./citations_lib";

import { readJsonlObjects } from "./citations_validate_lib";

export const citations_render_md = tool({
  description: "Render deterministic validated-citations markdown report",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    output_md_path: tool.schema.string().optional().describe("Absolute output markdown path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    citations_path?: string;
    output_md_path?: string;
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

      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const outputMdPath = (args.output_md_path ?? "").trim() || path.join(runRoot, "citations", "validated-citations.md");
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(outputMdPath)) return err("INVALID_ARGS", "output_md_path must be absolute", { output_md_path: args.output_md_path ?? null });

      let records: Array<Record<string, unknown>>;
      try {
        records = await readJsonlObjects(citationsPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "citations.jsonl missing", { citations_path: citationsPath });
        if (e instanceof SyntaxError) return err("INVALID_JSONL", "citations.jsonl malformed", { citations_path: citationsPath, message: String(e) });
        throw e;
      }

      records.sort((a, b) => {
        const an = String(a.normalized_url ?? "");
        const bn = String(b.normalized_url ?? "");
        const byNormalized = an.localeCompare(bn);
        if (byNormalized !== 0) return byNormalized;
        return String(a.cid ?? "").localeCompare(String(b.cid ?? ""));
      });

      const lines: string[] = [
        "# Validated Citations",
        "",
        `Run ID: ${runId}`,
        `Rendered: ${records.length}`,
        "",
      ];

      for (const record of records) {
        const cid = String(record.cid ?? "").trim();
        const url = String(record.url ?? "").trim();
        const status = String(record.status ?? "").trim();

        lines.push(`## ${cid || "(missing-cid)"}`);
        lines.push(`- URL: ${url || "(missing-url)"}`);
        lines.push(`- Status: ${status || "(missing-status)"}`);

        const title = String(record.title ?? "").trim();
        const publisher = String(record.publisher ?? "").trim();
        if (title) lines.push(`- Title: ${title}`);
        if (publisher) lines.push(`- Publisher: ${publisher}`);
        lines.push("");
      }

      const markdown = `${lines.join("\n")}\n`;
      try {
        await atomicWriteText(outputMdPath, markdown);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write validated-citations.md", {
          output_md_path: outputMdPath,
          message: String(e),
        });
      }

      const inputsDigest = sha256DigestForJson({
        schema: "citations_render_md.inputs.v1",
        run_id: runId,
        records: records.map((record) => ({
          normalized_url: String(record.normalized_url ?? ""),
          cid: String(record.cid ?? ""),
          url: String(record.url ?? ""),
          status: String(record.status ?? ""),
          title: String(record.title ?? ""),
          publisher: String(record.publisher ?? ""),
        })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_render_md",
            run_id: runId,
            reason,
            output_md_path: outputMdPath,
            rendered: records.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        output_md_path: outputMdPath,
        rendered: records.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "citations_render_md failed", { message: String(e) });
    }
  },
});
