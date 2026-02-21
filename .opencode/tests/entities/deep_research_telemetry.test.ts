import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const telemetry_append = ((deepResearch as any).telemetry_append ??
  (deepResearch as any).deep_research_telemetry_append) as any | undefined;
const run_metrics_write = ((deepResearch as any).run_metrics_write ??
  (deepResearch as any).deep_research_run_metrics_write) as any | undefined;

function toolArgKeys(toolValue: unknown): Set<string> {
  if (!toolValue || typeof toolValue !== "object") return new Set<string>();
  const args = (toolValue as { args?: Record<string, unknown> }).args;
  return new Set(Object.keys(args ?? {}));
}

async function withDeterministicTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), "dr-phase06-tests", name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function initRun(base: string, runId: string): Promise<{ manifestPath: string; runRoot: string }> {
  const initRaw = (await (run_init as any).execute(
    {
      query: "P06 telemetry fixture",
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
  const runRoot = path.dirname(manifestPath);
  return { manifestPath, runRoot };
}

function buildTelemetryAppendArgs(args: {
  manifestPath: string;
  runRoot: string;
  runId: string;
  event: Record<string, unknown>;
}): Record<string, unknown> {
  const keys = toolArgKeys(telemetry_append);
  const out: Record<string, unknown> = { ...args.event };

  if (keys.has("manifest_path")) out.manifest_path = args.manifestPath;
  if (keys.has("run_id")) out.run_id = args.runId;
  if (keys.has("telemetry_path")) out.telemetry_path = path.join(args.runRoot, "logs", "telemetry.jsonl");
  if (keys.has("event")) out.event = args.event;
  if (keys.has("entry")) out.entry = args.event;
  if (keys.has("telemetry_event")) out.telemetry_event = args.event;
  if (keys.has("event_json")) out.event_json = JSON.stringify(args.event);
  if (keys.has("reason")) out.reason = "test: append telemetry event";

  if (!("manifest_path" in out)) out.manifest_path = args.manifestPath;
  if (!("reason" in out)) out.reason = "test: append telemetry event";

  return out;
}

function buildRunMetricsArgs(args: {
  manifestPath: string;
  runRoot: string;
  runId: string;
}): Record<string, unknown> {
  const keys = toolArgKeys(run_metrics_write);
  const out: Record<string, unknown> = {};

  if (keys.has("manifest_path")) out.manifest_path = args.manifestPath;
  if (keys.has("run_id")) out.run_id = args.runId;
  if (keys.has("telemetry_path")) out.telemetry_path = path.join(args.runRoot, "logs", "telemetry.jsonl");
  if (keys.has("metrics_path")) out.metrics_path = path.join(args.runRoot, "metrics", "run-metrics.json");
  if (keys.has("output_path")) out.output_path = path.join(args.runRoot, "metrics", "run-metrics.json");
  if (keys.has("reason")) out.reason = "test: write run metrics";

  if (!("manifest_path" in out)) out.manifest_path = args.manifestPath;
  if (!("reason" in out)) out.reason = "test: write run metrics";

  return out;
}

function parseJsonl(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("deep_research_telemetry (entity)", () => {
  const maybeTest = telemetry_append && run_metrics_write ? test : test.skip;

  maybeTest("appends fixture telemetry events and writes deterministic run metrics", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("telemetry-metrics", async (base) => {
        const runId = "dr_test_p06_telemetry_001";
        const { manifestPath, runRoot } = await initRun(base, runId);

        const telemetryFixturePath = fixturePath("runs", "p06-telemetry-minimal", "logs", "telemetry.jsonl");
        const fixtureEvents = parseJsonl(await fs.readFile(telemetryFixturePath, "utf8"));

        for (const fixtureEvent of fixtureEvents) {
          const event = { ...fixtureEvent, run_id: runId };
          const raw = (await (telemetry_append as any).execute(
            buildTelemetryAppendArgs({ manifestPath, runRoot, runId, event }),
            makeToolContext(),
          )) as string;
          const out = parseToolJson(raw);
          expect(out.ok).toBe(true);
        }

        const telemetryPath = path.join(runRoot, "logs", "telemetry.jsonl");
        const telemetryEvents = parseJsonl(await fs.readFile(telemetryPath, "utf8"));
        expect(telemetryEvents.length).toBe(fixtureEvents.length);

        const seqs = telemetryEvents.map((event) => Number(event.seq));
        for (let i = 1; i < seqs.length; i += 1) {
          expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
        }

        const metricsRaw = (await (run_metrics_write as any).execute(
          buildRunMetricsArgs({ manifestPath, runRoot, runId }),
          makeToolContext(),
        )) as string;
        const metricsOut = parseToolJson(metricsRaw);
        expect(metricsOut.ok).toBe(true);

        const metricsPath = path.join(runRoot, "metrics", "run-metrics.json");
        const metricsDoc = JSON.parse(await fs.readFile(metricsPath, "utf8")) as Record<string, unknown>;
        const expectedDoc = JSON.parse(
          await fs.readFile(fixturePath("runs", "p06-telemetry-minimal", "metrics", "run-metrics.expected.json"), "utf8"),
        ) as Record<string, unknown>;

        const runMetrics = (metricsDoc.run ?? {}) as Record<string, unknown>;
        const expectedRunMetrics = (expectedDoc.run ?? {}) as Record<string, unknown>;
        expect(String(runMetrics.status)).toBe(String(expectedRunMetrics.status));
        expect(Number(runMetrics.stages_started_total)).toBe(Number(expectedRunMetrics.stages_started_total));
        expect(Number(runMetrics.stages_finished_total)).toBe(Number(expectedRunMetrics.stages_finished_total));
        expect(Number(runMetrics.stage_timeouts_total)).toBe(Number(expectedRunMetrics.stage_timeouts_total));
        expect(Number(runMetrics.failures_total)).toBe(Number(expectedRunMetrics.failures_total));

        const metricsRawSecond = (await (run_metrics_write as any).execute(
          buildRunMetricsArgs({ manifestPath, runRoot, runId }),
          makeToolContext(),
        )) as string;
        const metricsOutSecond = parseToolJson(metricsRawSecond);
        expect(metricsOutSecond.ok).toBe(true);

        const metricsDocSecond = JSON.parse(await fs.readFile(metricsPath, "utf8"));
        expect(metricsDocSecond).toEqual(metricsDoc);
      });
    });
  });

});
