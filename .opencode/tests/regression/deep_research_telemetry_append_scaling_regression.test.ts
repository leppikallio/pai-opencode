import { describe, expect, test } from "bun:test";

import { run_init } from "../../tools/deep_research_cli";
import * as deepResearch from "../../tools/deep_research_cli";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const telemetry_append = ((deepResearch as any).telemetry_append ??
  (deepResearch as any).deep_research_telemetry_append) as any | undefined;

function toolArgKeys(toolValue: unknown): Set<string> {
  if (!toolValue || typeof toolValue !== "object") return new Set<string>();
  const args = (toolValue as { args?: Record<string, unknown> }).args;
  return new Set(Object.keys(args ?? {}));
}

function buildTelemetryAppendArgs(args: {
  manifestPath: string;
  runId: string;
  event: Record<string, unknown>;
}): Record<string, unknown> {
  const keys = toolArgKeys(telemetry_append);
  const out: Record<string, unknown> = { ...args.event };

  if (keys.has("manifest_path")) out.manifest_path = args.manifestPath;
  if (keys.has("run_id")) out.run_id = args.runId;
  if (keys.has("event")) out.event = args.event;
  if (keys.has("entry")) out.entry = args.event;
  if (keys.has("telemetry_event")) out.telemetry_event = args.event;
  if (keys.has("event_json")) out.event_json = JSON.stringify(args.event);
  if (keys.has("reason")) out.reason = "test: telemetry scaling append";

  if (!("manifest_path" in out)) out.manifest_path = args.manifestPath;
  if (!("reason" in out)) out.reason = "test: telemetry scaling append";

  return out;
}

describe("deep_research telemetry append scaling (regression)", () => {
  const maybeTest = telemetry_append ? test : test.skip;

  maybeTest("keeps append throughput bounded as stream grows", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_telemetry_scaling_001";
        const initRaw = (await (run_init as any).execute(
          {
            query: "telemetry append scaling regression",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const total = 5000;
        const midpoint = total / 2;

        const firstStart = Date.now();
        for (let i = 0; i < midpoint; i += 1) {
          const raw = (await (telemetry_append as any).execute(
            buildTelemetryAppendArgs({
              manifestPath,
              runId,
              event: {
                event_type: "run_status",
                status: "running",
              },
            }),
            makeToolContext(),
          )) as string;
          const out = parseToolJson(raw);
          expect(out.ok).toBe(true);
        }
        const firstHalfMs = Date.now() - firstStart;

        const secondStart = Date.now();
        for (let i = midpoint; i < total; i += 1) {
          const raw = (await (telemetry_append as any).execute(
            buildTelemetryAppendArgs({
              manifestPath,
              runId,
              event: {
                event_type: "run_status",
                status: "running",
              },
            }),
            makeToolContext(),
          )) as string;
          const out = parseToolJson(raw);
          expect(out.ok).toBe(true);
        }
        const secondHalfMs = Date.now() - secondStart;

        const growthRatio = secondHalfMs / Math.max(firstHalfMs, 0.001);

        expect(growthRatio).toBeLessThanOrEqual(2);

      });
    });
  }, 30_000);
});
