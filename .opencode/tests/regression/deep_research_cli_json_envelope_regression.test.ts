import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import {
  fixturePath,
  withTempDir,
} from "../helpers/dr-harness";

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

  test("run --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_run_001";
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

      const runPayload = expectSingleJsonStdout(await runCli([
        "run",
        "--manifest",
        manifestPath,
        "--reason",
        "run json envelope regression",
        "--driver",
        "fixture",
        "--max-ticks",
        "1",
        "--json",
      ]), 0);

      expect(runPayload.schema_version).toBe("dr.cli.v1");
      expect(typeof runPayload.ok).toBe("boolean");
      expect(runPayload.command).toBe("run");

      const contract = expectContract(runPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      if (runPayload.ok === true) {
        expect(runPayload.result).toBeTruthy();
        expect(runPayload.error).toBeNull();
      } else {
        expect(runPayload.result).toBeNull();
        const error = runPayload.error as Record<string, unknown>;
        expect(typeof error.code).toBe("string");
        expect(typeof error.message).toBe("string");
      }

      const halt = runPayload.halt as Record<string, unknown> | null;
      if (halt) {
        expect(Array.isArray(halt.next_commands)).toBe(true);
      }
    });
  });

  test("pause --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_pause_001";
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

      const pausePayload = expectSingleJsonStdout(await runCli([
        "pause",
        "--manifest",
        manifestPath,
        "--reason",
        "pause json envelope regression",
        "--json",
      ]), 0);

      expect(pausePayload.schema_version).toBe("dr.cli.v1");
      expect(pausePayload.ok).toBe(true);
      expect(pausePayload.command).toBe("pause");

      const contract = expectContract(pausePayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = pausePayload.result as Record<string, unknown>;
      expect(typeof result.checkpoint_path).toBe("string");
      expect(pausePayload.error).toBeNull();
      expect(pausePayload.halt).toBeNull();
    });
  });

  test("resume --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_resume_001";
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

      expectSingleJsonStdout(await runCli([
        "pause",
        "--manifest",
        manifestPath,
        "--reason",
        "resume json envelope pre-pause",
        "--json",
      ]), 0);

      const resumePayload = expectSingleJsonStdout(await runCli([
        "resume",
        "--manifest",
        manifestPath,
        "--reason",
        "resume json envelope regression",
        "--json",
      ]), 0);

      expect(resumePayload.schema_version).toBe("dr.cli.v1");
      expect(resumePayload.ok).toBe(true);
      expect(resumePayload.command).toBe("resume");

      const contract = expectContract(resumePayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = resumePayload.result as Record<string, unknown>;
      expect(typeof result.checkpoint_path).toBe("string");
      expect(resumePayload.error).toBeNull();
      expect(resumePayload.halt).toBeNull();
    });
  });

  test("cancel --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_cancel_001";
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

      const cancelPayload = expectSingleJsonStdout(await runCli([
        "cancel",
        "--manifest",
        manifestPath,
        "--reason",
        "cancel json envelope regression",
        "--json",
      ]), 0);

      expect(cancelPayload.schema_version).toBe("dr.cli.v1");
      expect(cancelPayload.ok).toBe(true);
      expect(cancelPayload.command).toBe("cancel");

      const contract = expectContract(cancelPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = cancelPayload.result as Record<string, unknown>;
      expect(typeof result.checkpoint_path).toBe("string");
      expect(cancelPayload.error).toBeNull();
      expect(cancelPayload.halt).toBeNull();
    });
  });

  test("agent-result --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_agent_result_001";
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

      const agentResultPayload = expectSingleJsonStdout(await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "wave1",
        "--perspective",
        "p1",
        "--input",
        fixturePath("wave-output", "valid.md"),
        "--agent-run-id",
        "json-envelope-agent-result-001",
        "--reason",
        "agent-result json envelope regression",
        "--json",
      ]), 0);

      expect(agentResultPayload.schema_version).toBe("dr.cli.v1");
      expect(agentResultPayload.ok).toBe(true);
      expect(agentResultPayload.command).toBe("agent-result");

      const contract = expectContract(agentResultPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = agentResultPayload.result as Record<string, unknown>;
      expect(result.stage).toBe("wave1");
      expect(result.perspective_id).toBe("p1");
      expect(typeof result.output_path).toBe("string");
      expect(typeof result.meta_path).toBe("string");
      expect(typeof result.prompt_digest).toBe("string");
      expect(typeof result.noop).toBe("boolean");
      expect(agentResultPayload.error).toBeNull();
      expect(agentResultPayload.halt).toBeNull();
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

  test("inspect --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_inspect_001";
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

      const inspectPayload = expectSingleJsonStdout(await runCli([
        "inspect",
        "--manifest",
        manifestPath,
        "--json",
      ]), 0);

      expect(inspectPayload.schema_version).toBe("dr.cli.v1");
      expect(inspectPayload.ok).toBe(true);
      expect(inspectPayload.command).toBe("inspect");

      const contract = expectContract(inspectPayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = inspectPayload.result as Record<string, unknown>;
      expect(result).toBeTruthy();
      expect(result.gate_statuses_summary).toBeTruthy();
      expect(result.blockers_summary).toBeTruthy();
      expect(inspectPayload.error).toBeNull();
      expect(inspectPayload.halt).toBeNull();
    });
  });

  test("triage --json emits dr.cli.v1 envelope with contract/result/error/halt keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_envelope_triage_001";
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

      const triagePayload = expectSingleJsonStdout(await runCli([
        "triage",
        "--manifest",
        manifestPath,
        "--json",
      ]), 0);

      expect(triagePayload.schema_version).toBe("dr.cli.v1");
      expect(triagePayload.ok).toBe(true);
      expect(triagePayload.command).toBe("triage");

      const contract = expectContract(triagePayload.contract);
      expect(contract.run_id).toBe(runId);
      expect(contract.manifest_path).toBe(manifestPath);

      const result = triagePayload.result as Record<string, unknown>;
      expect(result).toBeTruthy();
      expect(result.gate_statuses_summary).toBeTruthy();
      expect(result.blockers_summary).toBeTruthy();
      expect(triagePayload.error).toBeNull();
      expect(triagePayload.halt).toBeNull();
    });
  });
});
