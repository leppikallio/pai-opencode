import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { withTempDir } from "../helpers/dr-harness";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const cliPath = path.join(repoRoot, ".opencode", "pai-tools", "deep-research-cli.ts");

async function runCli(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", cliPath, ...args],
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

function expectSingleJsonStdout(
  res: { exit: number; stdout: string; stderr: string },
  expectedExit: number,
): Record<string, unknown> {
  expect(res.exit).toBe(expectedExit);
  const trimmed = res.stdout.trim();
  expect(trimmed.startsWith("{")).toBe(true);
  expect(trimmed.endsWith("}")).toBe(true);
  expect(trimmed.split(/\r?\n/)).toHaveLength(1);
  return JSON.parse(trimmed) as Record<string, unknown>;
}

describe("deep_research stale tick marker guard (regression)", () => {
  test("tick returns PREVIOUS_TICK_INCOMPLETE when stale marker exists", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_tick_marker_regression_001";

      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]), 0);

      const contract = initPayload.contract as Record<string, unknown>;
      const manifestPath = String(contract.manifest_path ?? "");
      const runRoot = String(contract.run_root ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);
      expect(runRoot.length).toBeGreaterThan(0);

      const markerPath = path.join(runRoot, "logs", "tick-in-progress.json");
      const staleTs = new Date(Date.now() - (6 * 60 * 1000)).toISOString();
      const markerPayload = {
        schema_version: "tick_in_progress.v1",
        ts: staleTs,
        stage: "wave1",
        reason: "simulated stale marker",
      };
      await fs.mkdir(path.dirname(markerPath), { recursive: true });
      await fs.writeFile(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, "utf8");

      const tickPayload = expectSingleJsonStdout(await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "regression stale marker check",
        "--driver",
        "live",
        "--json",
      ]), 0);

      expect(tickPayload.ok).toBe(false);
      const error = tickPayload.error as Record<string, unknown>;
      expect(String(error.code ?? "")).toBe("PREVIOUS_TICK_INCOMPLETE");

      const details = (error.details ?? {}) as Record<string, unknown>;
      expect(String(details.marker_path ?? "")).toBe(markerPath);
      const marker = details.marker as Record<string, unknown>;
      expect(String(marker.schema_version ?? "")).toBe("tick_in_progress.v1");
      expect(String(marker.ts ?? "")).toBe(staleTs);
    });
  });
});
