import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import { withTempDir } from "../helpers/dr-harness";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const cliPath = path.join(repoRoot, ".opencode", "pai-tools", "deep-research-option-c.ts");

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

describe("deep_research operator CLI stage preconditions (entity)", () => {
  test("perspectives-draft fails fast outside perspectives stage with deterministic CLI_ERROR", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_stage_preconditions_001";

      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--no-perspectives",
        "--json",
      ]), 0);

      const manifestPath = String(initPayload.manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);
      expect(String(initPayload.stage_current ?? "")).toBe("init");

      const draftPayload = expectSingleJsonStdout(await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--driver",
        "task",
        "--reason",
        "test perspectives stage precondition",
        "--json",
      ]), 1);

      expect(draftPayload.ok).toBe(false);
      expect(draftPayload.command).toBe("perspectives-draft");
      const error = draftPayload.error as Record<string, unknown>;
      expect(String(error.code ?? "")).toBe("CLI_ERROR");
      expect(String(error.message ?? "")).toContain("requires stage.current=perspectives");
    });
  });

  test("stage-advance init -> perspectives succeeds deterministically with --json", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_stage_preconditions_002";

      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--no-perspectives",
        "--json",
      ]), 0);

      const manifestPath = String(initPayload.manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);
      expect(String(initPayload.stage_current ?? "")).toBe("init");

      const advancePayload = expectSingleJsonStdout(await runCli([
        "stage-advance",
        "--manifest",
        manifestPath,
        "--requested-next",
        "perspectives",
        "--reason",
        "test direct stage precondition assertion",
        "--json",
      ]), 0);

      expect(advancePayload.command).toBe("stage-advance");
      expect(advancePayload.from).toBe("init");
      expect(advancePayload.to).toBe("perspectives");
      expect(advancePayload.stage_current).toBe("perspectives");
    });
  });
});
