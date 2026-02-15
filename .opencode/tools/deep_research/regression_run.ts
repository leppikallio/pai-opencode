import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  FIXTURE_REGRESSION_REPORT_SCHEMA_VERSION,
  parseToolResult,
  sortedLex,
} from "./deep_research_shared_lib";
import { fixture_replay } from "./fixture_replay";
import type { ToolWithExecute } from "./types";
import { err, ok } from "./utils";
import { statPath } from "./wave_tools_io";

export const regression_run = tool({
  description: "Run offline deep research fixture regression replay suite",
  args: {
    fixtures_root: tool.schema.string().describe("Absolute root containing fixture bundles"),
    bundle_ids: tool.schema.array(tool.schema.string()).describe("Bundle IDs to replay"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { fixtures_root: string; bundle_ids: string[]; reason: string }) {
    try {
      const fixturesRoot = args.fixtures_root.trim();
      const reason = args.reason.trim();
      if (!fixturesRoot || !path.isAbsolute(fixturesRoot)) return err("INVALID_ARGS", "fixtures_root must be absolute", { fixtures_root: args.fixtures_root });
      if (!Array.isArray(args.bundle_ids)) return err("INVALID_ARGS", "bundle_ids must be string[]", { bundle_ids: args.bundle_ids ?? null });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const rootStat = await statPath(fixturesRoot);
      if (!rootStat?.isDirectory()) {
        return err("INVALID_ARGS", "fixtures_root not found or not a directory", {
          fixtures_root: fixturesRoot,
        });
      }

      const bundleIds = sortedLex([...new Set(args.bundle_ids.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0))]);
      if (bundleIds.length === 0) return err("INVALID_ARGS", "bundle_ids must include at least one id");

      const outcomes: Array<Record<string, unknown>> = [];
      let passCount = 0;
      let failCount = 0;
      let errorCount = 0;

      for (const bundleId of bundleIds) {
        const bundleRoot = path.join(fixturesRoot, bundleId);
        const replayRaw = await (fixture_replay as unknown as ToolWithExecute).execute({
          bundle_root: bundleRoot,
          reason: `regression_run:${reason}:${bundleId}`,
        });

        const replayParsed = parseToolResult(replayRaw);
        if (!replayParsed.ok) {
          errorCount += 1;
          outcomes.push({
            bundle_id: bundleId,
            bundle_root: bundleRoot,
            ok: false,
            status: "error",
            error: {
              code: replayParsed.code,
              message: replayParsed.message,
            },
          });
          continue;
        }

        const replayStatus = String(replayParsed.value.status ?? "fail").trim() === "pass" ? "pass" : "fail";
        if (replayStatus === "pass") passCount += 1;
        else failCount += 1;

        outcomes.push({
          bundle_id: bundleId,
          bundle_root: bundleRoot,
          ok: true,
          status: replayStatus,
          replay_report_path: String(replayParsed.value.replay_report_path ?? ""),
        });
      }

      const total = bundleIds.length;
      const summary = {
        total,
        pass: passCount,
        fail: failCount,
        error: errorCount,
      };

      return ok({
        schema_version: FIXTURE_REGRESSION_REPORT_SCHEMA_VERSION,
        fixtures_root: fixturesRoot,
        status: failCount === 0 && errorCount === 0 ? "pass" : "fail",
        summary,
        outcomes,
      });
    } catch (e) {
      return err("WRITE_FAILED", "regression_run failed", { message: String(e) });
    }
  },
});

export const deep_research_regression_run = regression_run;
