import { tool } from "@opencode-ai/plugin";

import { fixture_replay } from "./fixture_replay";
import { runQualityAudit, type QualityAuditArgs } from "./quality_audit_lib";
import type { ToolWithExecute } from "./types";

export const quality_audit = tool({
  description: "Audit fixture bundle quality drift offline",
  args: {
    fixtures_root: tool.schema.string().optional().describe("Absolute root containing fixture bundles"),
    bundle_roots: tool.schema.array(tool.schema.string()).optional().describe("Optional absolute fixture bundle roots"),
    bundle_paths: tool.schema.array(tool.schema.string()).optional().describe("Optional alias for bundle_roots"),
    output_dir: tool.schema.string().optional().describe("Optional absolute output directory"),
    min_bundles: tool.schema.number().optional().describe("Minimum valid bundles required (default 1)"),
    include_telemetry_metrics: tool.schema.boolean().optional().describe("Include telemetry-derived metrics when present (default true)"),
    schema_version: tool.schema.string().optional().describe("Optional report schema version"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: QualityAuditArgs) {
    return runQualityAudit(args, fixture_replay as unknown as ToolWithExecute);
  },
});

export const deep_research_quality_audit = quality_audit;
