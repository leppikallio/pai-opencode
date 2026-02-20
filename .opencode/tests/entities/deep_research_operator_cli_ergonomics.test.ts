import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  fixturePath,
  withTempDir,
} from "../helpers/dr-harness";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const cliPath = path.join(repoRoot, ".opencode", "pai-tools", "deep-research-option-c.ts");

async function runCli(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", cliPath, ...args],
    cwd: repoRoot,
    // Pass an explicit process environment snapshot to child process.
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

function parseJsonStdout(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

function expectSingleJsonStdout(res: { exit: number; stdout: string; stderr: string }, expectedExit: number): Record<string, unknown> {
  expect(res.exit).toBe(expectedExit);
  const trimmed = res.stdout.trim();
  expect(trimmed.startsWith("{")).toBe(true);
  expect(trimmed.endsWith("}")).toBe(true);
  expect(trimmed.split(/\r?\n/)).toHaveLength(1);
  return parseJsonStdout(trimmed);
}

function extractField(stdout: string, field: string): string {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = stdout.match(pattern);
  if (!match) throw new Error(`field ${field} missing from output:\n${stdout}`);
  return match[1].trim();
}

async function initRun(runId: string, runsRoot: string): Promise<{ manifestPath: string; gatesPath: string }> {
  const initRes = await runCli(["init", "Q", "--run-id", runId, "--runs-root", runsRoot]);
  expect(initRes.exit).toBe(0);
  expect(initRes.stderr).not.toContain("ERROR:");
  return {
    manifestPath: extractField(initRes.stdout, "manifest_path"),
    gatesPath: extractField(initRes.stdout, "gates_path"),
  };
}

describe("deep_research operator CLI ergonomics (entity)", () => {
  test("init preserves existing perspectives unless --force", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_init_resume_001";

      const init1 = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base]);
      expect(init1.exit).toBe(0);
      expect(init1.stderr).not.toContain("ERROR:");

      const runRoot = extractField(init1.stdout, "run_root");
      const perspectivesPath = path.join(runRoot, "perspectives.json");
      const wave1PlanPath = path.join(runRoot, "wave-1", "wave1-plan.json");

      const wave1PlanRaw1 = await fs.readFile(wave1PlanPath, "utf8");
      const wave1Plan1 = JSON.parse(wave1PlanRaw1) as { generated_at?: string };
      const generatedAt1 = String(wave1Plan1.generated_at ?? "");
      expect(generatedAt1.length).toBeGreaterThan(0);

      const raw = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
      raw.perspectives[0].title = "SENTINEL";
      await fs.writeFile(perspectivesPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

      const init2 = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base]);
      expect(init2.exit).toBe(0);
      expect(init2.stderr).not.toContain("ERROR:");

      // Without --force, init must not overwrite the wave1 plan artifact.
      const wave1PlanRaw2 = await fs.readFile(wave1PlanPath, "utf8");
      expect(wave1PlanRaw2).toBe(wave1PlanRaw1);

      const after2 = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
      expect(after2.perspectives[0].title).toBe("SENTINEL");

      const init3 = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base, "--force"]);
      expect(init3.exit).toBe(0);
      expect(init3.stderr).not.toContain("ERROR:");

      const wave1PlanRaw3 = await fs.readFile(wave1PlanPath, "utf8");
      const wave1Plan3 = JSON.parse(wave1PlanRaw3) as { generated_at?: string };
      expect(String(wave1Plan3.generated_at ?? "")).not.toBe(generatedAt1);

      const after3 = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
      expect(after3.perspectives[0].title).toBe("Default synthesis perspective");
    });
  });

  test("status/inspect/triage/pause/resume/tick/run accept --run-id", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_run_handle_001";
      await initRun(runId, base);

      const commands: Array<string[]> = [
        ["status", "--run-id", runId, "--runs-root", base],
        ["inspect", "--run-id", runId, "--runs-root", base],
        ["triage", "--run-id", runId, "--runs-root", base],
        ["pause", "--run-id", runId, "--runs-root", base, "--reason", "test pause"],
        ["resume", "--run-id", runId, "--runs-root", base, "--reason", "test resume"],
        ["tick", "--run-id", runId, "--runs-root", base, "--reason", "test tick", "--driver", "fixture"],
        ["run", "--run-id", runId, "--runs-root", base, "--reason", "test run", "--driver", "fixture", "--max-ticks", "1"],
      ];

      for (const cmd of commands) {
        const res = await runCli(cmd);
        expect(res.exit).toBe(0);
        expect(res.stderr).not.toContain("ERROR:");
      }
    });
  });

  test("stage-advance accepts requested-next perspectives", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_stage_advance_001";
      const initRes = await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--no-perspectives",
        "--json",
      ]);
      const initPayload = expectSingleJsonStdout(initRes, 0);
      const manifestPath = String(initPayload.manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);
      expect(String(initPayload.stage_current ?? "")).toBe("init");

      const advanceRes = await runCli([
        "stage-advance",
        "--manifest",
        manifestPath,
        "--requested-next",
        "perspectives",
        "--reason",
        "test stage advance perspectives",
        "--json",
      ]);

      const advancePayload = expectSingleJsonStdout(advanceRes, 0);
      expect(advancePayload.command).toBe("stage-advance");
      expect(advancePayload.from).toBe("init");
      expect(advancePayload.to).toBe("perspectives");
      expect(advancePayload.stage_current).toBe("perspectives");
    });
  });

  test("status/inspect/triage --json emit one parseable object with required keys", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_001";
      const { manifestPath } = await initRun(runId, base);

        const commands: Array<{ cmd: string[]; expectsBlockers: boolean }> = [
          { cmd: ["status", "--manifest", manifestPath, "--json"], expectsBlockers: false },
          { cmd: ["inspect", "--manifest", manifestPath, "--json"], expectsBlockers: true },
          { cmd: ["triage", "--manifest", manifestPath, "--json"], expectsBlockers: true },
        ];

      for (const entry of commands) {
        const res = await runCli(entry.cmd);
        expect(res.exit).toBe(0);
        expect(res.stderr).not.toContain("ERROR:");

        const payload = parseJsonStdout(res.stdout);
        expect(payload.run_id).toBe(runId);
        expect(typeof payload.run_root).toBe("string");
        expect(payload.manifest_path).toBe(manifestPath);
        expect(typeof payload.gates_path).toBe("string");
        expect(typeof payload.stage_current).toBe("string");
        expect(typeof payload.status).toBe("string");

        const gateSummary = payload.gate_statuses_summary as Record<string, unknown>;
        expect(gateSummary).toBeTruthy();
        for (const gateId of ["A", "B", "C", "D", "E", "F"]) {
          expect(gateSummary[gateId]).toBeTruthy();
        }

        if (entry.expectsBlockers) {
          const blockers = payload.blockers_summary as {
            missing_artifacts?: unknown;
            blocked_gates?: unknown;
          };
          expect(blockers).toBeTruthy();
          expect(Array.isArray(blockers.missing_artifacts)).toBe(true);
          expect(Array.isArray(blockers.blocked_gates)).toBe(true);
        }
      }
    });
  });

  test("init/tick/run/pause/resume/cancel/agent-result --json emit one object", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_json_ops_001";

      const assertOneJsonObject = (res: { exit: number; stdout: string; stderr: string }): Record<string, unknown> => {
        expect(res.exit).toBe(0);
        expect(res.stderr).not.toContain("ERROR:");
        const trimmed = res.stdout.trim();
        expect(trimmed.startsWith("{")).toBe(true);
        expect(trimmed.endsWith("}")).toBe(true);
        expect(trimmed.split(/\r?\n/)).toHaveLength(1);
        return parseJsonStdout(trimmed);
      };

      const initPayload = assertOneJsonObject(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]));

      const manifestPath = String(initPayload.manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);

      const tickPayload = assertOneJsonObject(await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "json tick",
        "--driver",
        "fixture",
        "--json",
      ]));
      expect(tickPayload.command).toBe("tick");

      const pausePayload = assertOneJsonObject(await runCli([
        "pause",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "json pause",
        "--json",
      ]));
      expect(pausePayload.command).toBe("pause");

      const resumePayload = assertOneJsonObject(await runCli([
        "resume",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "json resume",
        "--json",
      ]));
      expect(resumePayload.command).toBe("resume");

      const agentResultPayload = assertOneJsonObject(await runCli([
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
        "json-agent-run-001",
        "--reason",
        "json agent result",
        "--json",
      ]));
      expect(agentResultPayload.command).toBe("agent-result");

      const cancelPayload = assertOneJsonObject(await runCli([
        "cancel",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "json cancel",
        "--json",
      ]));
      expect(cancelPayload.command).toBe("cancel");

      const runPayload = assertOneJsonObject(await runCli([
        "run",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "json run",
        "--driver",
        "fixture",
        "--max-ticks",
        "1",
        "--json",
      ]));
      expect(runPayload.command).toBe("run");
    });
  });

  test("tick derives gates from manifest when --gates is omitted", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_optional_gates_001";
      const { manifestPath, gatesPath } = await initRun(runId, base);

      const res = await runCli(["tick", "--manifest", manifestPath, "--reason", "test optional gates", "--driver", "fixture"]);
      expect(res.exit).toBe(0);
      expect(res.stdout).toContain("tick.driver: fixture");
      expect(res.stdout).toContain(`gates_path: ${gatesPath}`);
    });
  });

  test("rerun wave1 writes deterministic retry directive artifact", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_rerun_wave1_001";
      const { manifestPath } = await initRun(runId, base);
      const runRoot = path.dirname(manifestPath);

      const beforeManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const beforeStage = String(beforeManifest?.stage?.current ?? "");

      const res = await runCli([
        "rerun",
        "wave1",
        "--manifest",
        manifestPath,
        "--perspective",
        "p2",
        "--reason",
        "manual rerun for p2",
      ]);

      expect(res.exit).toBe(0);
      expect(res.stderr).not.toContain("ERROR:");

      const retryPath = path.join(runRoot, "retry", "retry-directives.json");
      const retryArtifact = JSON.parse(await fs.readFile(retryPath, "utf8"));

      expect(retryArtifact.schema_version).toBe("wave1.retry_directives.v1");
      expect(retryArtifact.run_id).toBe(runId);
      expect(retryArtifact.stage).toBe("wave1");
      expect(retryArtifact.consumed_at).toBeNull();
      expect(Array.isArray(retryArtifact.retry_directives)).toBe(true);
      expect(retryArtifact.retry_directives).toHaveLength(1);
      expect(retryArtifact.retry_directives[0]).toMatchObject({
        perspective_id: "p2",
        action: "retry",
        change_note: "manual rerun for p2",
      });

      const afterManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const afterStage = String(afterManifest?.stage?.current ?? "");
      expect(afterStage).toBe(beforeStage);
    });
  });

  test("run supports --until stage boundary", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_until_001";
      await initRun(runId, base);

      const res = await runCli([
        "run",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "test until",
        "--driver",
        "fixture",
        "--max-ticks",
        "3",
        "--until",
        "wave1",
      ]);

      expect(res.exit).toBe(0);
      expect(res.stdout).toContain("run.ok: true");
      expect(res.stdout).toContain("run.until_reached: wave1");
    });
  });

  test("cancel sets terminal status and run exits immediately", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_cancel_001";
      await initRun(runId, base);

      const cancelRes = await runCli(["cancel", "--run-id", runId, "--runs-root", base, "--reason", "test cancel"]);
      expect(cancelRes.exit).toBe(0);
      expect(cancelRes.stdout).toContain("cancel.ok: true");

      const runRes = await runCli([
        "run",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--reason",
        "after cancel",
        "--driver",
        "fixture",
        "--max-ticks",
        "2",
      ]);

      expect(runRes.exit).toBe(0);
      expect(runRes.stdout).toContain("run.ok: true");
      expect(runRes.stdout).toContain("status: cancelled");
    });
  });

  test("--run-id requires --runs-root", async () => {
    const res = await runCli(["status", "--run-id", "dr_test_missing_runs_root"]);
    expect(res.exit).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toContain("--runs-root is required when using --run-id");
  });

  test("invalid args with --json emit one parseable JSON error object", async () => {
    const res = await runCli(["not-a-real-command", "--json"]);
    const payload = expectSingleJsonStdout(res, 1);

    expect(payload.ok).toBe(false);
    expect(payload.command).toBe("not-a-real-command");
    const error = payload.error as Record<string, unknown>;
    expect(typeof error.code).toBe("string");
    expect(typeof error.message).toBe("string");
  });

  test("command failure with --json emits one parseable JSON error object", async () => {
    const res = await runCli(["status", "--run-id", "dr_test_missing_runs_root", "--json"]);
    const payload = expectSingleJsonStdout(res, 1);

    expect(payload.ok).toBe(false);
    expect(payload.command).toBe("status");
    const error = payload.error as Record<string, unknown>;
    expect(String(error.message ?? "")).toContain("--runs-root is required when using --run-id");
  });
});
