import { describe, expect, test } from "bun:test";
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

function expectContract(contractRaw: unknown): Record<string, unknown> {
  const contract = contractRaw as Record<string, unknown>;
  expect(typeof contract.run_id).toBe("string");
  expect(typeof contract.run_root).toBe("string");
  expect(typeof contract.manifest_path).toBe("string");
  expect(typeof contract.gates_path).toBe("string");
  expect(typeof contract.stage_current).toBe("string");
  expect(typeof contract.status).toBe("string");
  expect(typeof contract.cli_invocation).toBe("string");
  return contract;
}

function manifestPathFromInitEnvelope(initPayload: Record<string, unknown>): string {
  const contract = expectContract(initPayload.contract);
  const manifestPath = String(contract.manifest_path ?? "");
  expect(manifestPath.length).toBeGreaterThan(0);
  return manifestPath;
}

describe("deep_research cli --json dr.cli.v1 envelope (regression)", () => {
  test("init --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_init_001";
      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]), 0);

      expect(initPayload.schema_version).toBe("dr.cli.v1");
      expect(initPayload.ok).toBe(true);
      expect(initPayload.command).toBe("init");

      const contract = expectContract(initPayload.contract);
      expect(contract.run_id).toBe(runId);

      const result = initPayload.result as Record<string, unknown>;
      expect(result).toBeTruthy();
      expect(typeof result.run_config_path).toBe("string");
      expect(Array.isArray(result.notes)).toBe(true);
      expect(typeof result.created).toBe("boolean");

      expect(initPayload.error).toBeNull();
      expect(initPayload.halt).toBeNull();
    });
  });

  test("tick --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_tick_001";
      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]), 0);

      const manifestPath = manifestPathFromInitEnvelope(initPayload);

      const tickPayload = expectSingleJsonStdout(await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "tick json envelope regression",
        "--driver",
        "fixture",
        "--json",
      ]), 0);

      expect(tickPayload.schema_version).toBe("dr.cli.v1");
      expect(typeof tickPayload.ok).toBe("boolean");
      expect(tickPayload.command).toBe("tick");

      const contract = expectContract(tickPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      if (tickPayload.ok === true) {
        const result = tickPayload.result as Record<string, unknown>;
        expect(result).toBeTruthy();
        expect(result.driver).toBe("fixture");
        expect(typeof result.from).toBe("string");
        expect(typeof result.to).toBe("string");
        expect(tickPayload.error).toBeNull();
      } else {
        expect(tickPayload.result).toBeNull();
        const error = tickPayload.error as Record<string, unknown>;
        expect(typeof error.code).toBe("string");
        expect(typeof error.message).toBe("string");
      }

      const halt = tickPayload.halt as Record<string, unknown> | null;
      if (halt) {
        expect(Array.isArray(halt.next_commands)).toBe(true);
      }
    });
  });

  test("status --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_status_001";
      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]), 0);

      const manifestPath = manifestPathFromInitEnvelope(initPayload);

      const statusPayload = expectSingleJsonStdout(await runCli([
        "status",
        "--manifest",
        manifestPath,
        "--json",
      ]), 0);

      expect(statusPayload.schema_version).toBe("dr.cli.v1");
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.command).toBe("status");

      const contract = expectContract(statusPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = statusPayload.result as Record<string, unknown>;
      expect(result).toBeTruthy();
      expect(result.gate_statuses_summary).toBeTruthy();
      expect(statusPayload.error).toBeNull();
      expect(statusPayload.halt).toBeNull();
    });
  });
});
