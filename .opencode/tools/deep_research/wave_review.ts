import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { wave_output_validate } from "./wave_output_validate";
import {
  atomicWriteJson,
  buildRetryChangeNote,
  collectWaveReviewMetrics,
  err,
  errorCode,
  isInteger,
  readJson,
  toFailureShape,
  truncateMessage,
  validatePerspectivesV1,
} from "./wave_tools_shared";
import type { ToolWithExecute } from "./wave_tools_shared";
import { parseJsonSafe, statPath } from "./wave_tools_io";

export const wave_review = tool({
  description: "Deterministic offline aggregation for wave output reviewer enforcement",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json (perspectives.v1)"),
    outputs_dir: tool.schema.string().describe("Absolute directory containing <perspective_id>.md outputs"),
    perspective_ids: tool.schema.any().optional().describe("Optional subset of perspective ids to validate"),
    max_failures: tool.schema.number().optional().describe("Retry/report cap (1..500), defaults to 25"),
    report_path: tool.schema.string().optional().describe("Optional absolute path to write JSON report"),
  },
  async execute(args: {
    perspectives_path: string;
    outputs_dir: string;
    perspective_ids?: unknown;
    max_failures?: number;
    report_path?: string;
  }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const outputsDir = args.outputs_dir.trim();
      const reportPath = (args.report_path ?? "").trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }

      if (!outputsDir) return err("INVALID_ARGS", "outputs_dir must be non-empty");
      if (!path.isAbsolute(outputsDir)) {
        return err("INVALID_ARGS", "outputs_dir must be absolute", { outputs_dir: args.outputs_dir });
      }

      if (reportPath && !path.isAbsolute(reportPath)) {
        return err("INVALID_ARGS", "report_path must be absolute", { report_path: args.report_path });
      }

      const maxFailuresRaw = args.max_failures ?? 25;
      if (!isInteger(maxFailuresRaw) || maxFailuresRaw < 1 || maxFailuresRaw > 500) {
        return err("INVALID_ARGS", "max_failures must be an integer in range 1..500", {
          max_failures: args.max_failures ?? null,
        });
      }
      const maxFailures = maxFailuresRaw;

      const outputsDirStat = await statPath(outputsDir);
      if (!outputsDirStat || !outputsDirStat.isDirectory()) {
        return err("NOT_FOUND", "outputs_dir not found or not a directory", { outputs_dir: outputsDir });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "perspectives_path contains invalid JSON", { perspectives_path: perspectivesPath });
        throw e;
      }

      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const perspectives = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? []);
      const perspectiveMap = new Map<string, Record<string, unknown>>();
      for (const perspective of perspectives) {
        perspectiveMap.set(String(perspective.id ?? ""), perspective);
      }

      let selectedPerspectiveIds: string[];
      if (args.perspective_ids !== undefined) {
        if (!Array.isArray(args.perspective_ids)) {
          return err("INVALID_ARGS", "perspective_ids must be an array when provided", {
            perspective_ids: args.perspective_ids,
          });
        }

        const cleanedIds = args.perspective_ids.map((value) => String(value ?? "").trim());
        if (cleanedIds.some((value) => value.length === 0)) {
          return err("INVALID_ARGS", "perspective_ids must contain non-empty strings", {
            perspective_ids: args.perspective_ids,
          });
        }

        const uniqueSortedIds = Array.from(new Set(cleanedIds)).sort((a, b) => a.localeCompare(b));
        for (const perspectiveId of uniqueSortedIds) {
          if (!perspectiveMap.has(perspectiveId)) {
            return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
              perspective_id: perspectiveId,
            });
          }
        }
        selectedPerspectiveIds = uniqueSortedIds;
      } else {
        selectedPerspectiveIds = Array.from(perspectiveMap.keys()).sort((a, b) => a.localeCompare(b));
      }

      const results: Array<{
        perspective_id: string;
        markdown_path: string;
        pass: boolean;
        metrics: { words: number; sources: number; missing_sections: string[] };
        failure: { code: string; message: string; details: Record<string, unknown> } | null;
      }> = [];

      const failedResults: Array<{
        perspective_id: string;
        failure: { code: string; message: string; details: Record<string, unknown> };
      }> = [];

      for (const perspectiveId of selectedPerspectiveIds) {
        const perspective = perspectiveMap.get(perspectiveId);
        if (!perspective) {
          return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
            perspective_id: perspectiveId,
          });
        }
        const markdownPath = path.join(outputsDir, `${perspectiveId}.md`);
        const markdownStat = await statPath(markdownPath);
        if (!markdownStat || !markdownStat.isFile()) {
          return err("OUTPUT_NOT_FOUND", "expected markdown output missing", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
          });
        }

        const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
        const requiredSections = Array.isArray(contract.must_include_sections)
          ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
          : [];

        const metrics = await collectWaveReviewMetrics({
          markdownPath,
          requiredSections,
        });

        const validationRaw = (await (wave_output_validate as unknown as ToolWithExecute).execute({
          perspectives_path: perspectivesPath,
          perspective_id: perspectiveId,
          markdown_path: markdownPath,
        })) as string;
        const validationParsed = parseJsonSafe(validationRaw);

        if (!validationParsed.ok) {
          return err("WRITE_FAILED", "wave_output_validate returned non-JSON", {
            perspective_id: perspectiveId,
            raw: validationParsed.value,
          });
        }

        const validationObj = validationParsed.value as Record<string, unknown>;
        if (validationObj.ok === true) {
          results.push({
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
            pass: true,
            metrics,
            failure: null,
          });
          continue;
        }

        const failure = toFailureShape(validationObj.error);
        if (failure.code === "NOT_FOUND") {
          return err("OUTPUT_NOT_FOUND", "expected markdown output missing", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
          });
        }

        if (failure.code === "PERSPECTIVE_NOT_FOUND") {
          return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
            perspective_id: perspectiveId,
          });
        }

        results.push({
          perspective_id: perspectiveId,
          markdown_path: markdownPath,
          pass: false,
          metrics,
          failure,
        });
        failedResults.push({
          perspective_id: perspectiveId,
          failure,
        });
      }

      const retryDirectives = failedResults.slice(0, maxFailures).map(({ perspective_id, failure }) => ({
        perspective_id,
        action: "retry",
        change_note: buildRetryChangeNote(failure),
        blocking_error_code: failure.code,
      }));

      const failuresSample = failedResults.slice(0, maxFailures).map((entry) => entry.perspective_id);
      const failedCount = failedResults.length;
      const validatedCount = selectedPerspectiveIds.length;
      const reportNotes = failedCount === 0
        ? "All perspectives passed wave output contract validation."
        : `${failedCount}/${validatedCount} perspectives failed contract validation; retry directives emitted.`;

      const payload = {
        ok: true,
        pass: failedCount === 0,
        perspectives_path: perspectivesPath,
        outputs_dir: outputsDir,
        validated: validatedCount,
        failed: failedCount,
        results,
        retry_directives: retryDirectives,
        report: {
          failures_sample: failuresSample,
          failures_omitted: Math.max(0, failedCount - failuresSample.length),
          notes: truncateMessage(reportNotes),
        },
        report_path: reportPath || null,
      };

      if (reportPath) {
        try {
          await atomicWriteJson(reportPath, payload);
        } catch (e) {
          return err("WRITE_FAILED", "failed to write report_path", {
            report_path: reportPath,
            message: String(e),
          });
        }
      }

      return JSON.stringify(payload, null, 2);
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path or outputs_dir not found");
      return err("WRITE_FAILED", "wave review failed", { message: String(e) });
    }
  },
});
