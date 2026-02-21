import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const tick_ledger_append = ((deepResearch as any).tick_ledger_append ??
  (deepResearch as any).deep_research_tick_ledger_append) as any | undefined;

function parseJsonl(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

async function initRun(base: string, runId: string): Promise<{ manifestPath: string; gatesPath: string; runRoot: string }> {
  const initRaw = (await (run_init as any).execute(
    {
      query: "E4 observability test",
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
  const gatesPath = String((init as any).gates_path);
  const runRoot = path.dirname(manifestPath);
  return { manifestPath, gatesPath, runRoot };
}

function repoRootFromCwd(): string {
  return path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

describe("deep_research tick ledger + CLI observability", () => {
  const maybeTest = tick_ledger_append ? test : test.skip;

  maybeTest("appends explicit tick ledger entry", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("tick-ledger-tool", async (base) => {
        const runId = "dr_test_e4_tick_ledger_001";
        const { manifestPath, runRoot } = await initRun(base, runId);

        const raw = (await (tick_ledger_append as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: append tick ledger",
            entry: {
              tick_index: 1,
              phase: "finish",
              stage_before: "init",
              stage_after: "wave1",
              status_before: "running",
              status_after: "running",
              result: { ok: true },
              inputs_digest: "sha256:test",
              artifacts: {
                manifest_path: manifestPath,
              },
            },
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(raw);
        expect(out.ok).toBe(true);

        const ledgerPath = path.join(runRoot, "logs", "ticks.jsonl");
        const rows = parseJsonl(await fs.readFile(ledgerPath, "utf8"));
        expect(rows.length).toBe(1);
        expect(String(rows[0]?.run_id ?? "")).toBe(runId);
        expect(String(rows[0]?.phase ?? "")).toBe("finish");
      });
    });
  });

  test("fixture tick writes ledger + telemetry + metrics artifacts", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("tick-ledger-cli", async (base) => {
        const runId = "dr_test_e4_tick_cli_001";
        const { manifestPath, gatesPath, runRoot } = await initRun(base, runId);

        const repoRoot = repoRootFromCwd();
        const proc = Bun.spawn(
          [
            "bun",
            ".opencode/pai-tools/deep-research-option-c.ts",
            "tick",
            "--manifest",
            manifestPath,
            "--gates",
            gatesPath,
            "--reason",
            "test: fixture tick",
            "--driver",
            "fixture",
          ],
          {
            cwd: repoRoot,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              PAI_DR_OPTION_C_ENABLED: "1",
              PAI_DR_NO_WEB: "1",
            },
          },
        );

        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        expect(exitCode).toBe(0);
        expect(stderr.trim()).toBe("");
        expect(stdout).toContain("tick.ok:");

        const ledgerPath = path.join(runRoot, "logs", "ticks.jsonl");
        const telemetryPath = path.join(runRoot, "logs", "telemetry.jsonl");
        const metricsPath = path.join(runRoot, "metrics", "run-metrics.json");

        const ledger = parseJsonl(await fs.readFile(ledgerPath, "utf8"));
        expect(ledger.length).toBeGreaterThanOrEqual(2);
        expect(String(ledger[0]?.phase ?? "")).toBe("start");
        expect(String(ledger[1]?.phase ?? "")).toBe("finish");
        expect(typeof (ledger[1]?.result as Record<string, unknown>)?.ok).toBe("boolean");

        const telemetry = parseJsonl(await fs.readFile(telemetryPath, "utf8"));
        const eventTypes = telemetry.map((row) => String(row.event_type ?? ""));
        expect(eventTypes).toContain("stage_started");
        expect(eventTypes).toContain("stage_finished");

        const metricsDoc = JSON.parse(await fs.readFile(metricsPath, "utf8")) as Record<string, unknown>;
        expect(String(metricsDoc.schema_version ?? "")).toBe("run_metrics.v1");
      });
    });
  });
});
