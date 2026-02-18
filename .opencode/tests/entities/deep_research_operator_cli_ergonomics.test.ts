import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  withEnv,
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
    // Bun.spawn does not reliably inherit runtime mutations to process.env.
    // Pass an explicit snapshot so `withEnv()` affects the child process.
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

function extractField(stdout: string, field: string): string {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = stdout.match(pattern);
  if (!match) throw new Error(`field ${field} missing from output:\n${stdout}`);
  return match[1].trim();
}

async function initRun(runId: string): Promise<{ manifestPath: string; gatesPath: string }> {
  const initRes = await runCli(["init", "Q", "--run-id", runId]);
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
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: base }, async () => {
        const runId = "dr_test_cli_init_resume_001";

        const init1 = await runCli(["init", "Q", "--run-id", runId]);
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

        const init2 = await runCli(["init", "Q", "--run-id", runId]);
        expect(init2.exit).toBe(0);
        expect(init2.stderr).not.toContain("ERROR:");

        // Without --force, init must not overwrite the wave1 plan artifact.
        const wave1PlanRaw2 = await fs.readFile(wave1PlanPath, "utf8");
        expect(wave1PlanRaw2).toBe(wave1PlanRaw1);

        const after2 = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
        expect(after2.perspectives[0].title).toBe("SENTINEL");

        const init3 = await runCli(["init", "Q", "--run-id", runId, "--force"]);
        expect(init3.exit).toBe(0);
        expect(init3.stderr).not.toContain("ERROR:");

        const wave1PlanRaw3 = await fs.readFile(wave1PlanPath, "utf8");
        const wave1Plan3 = JSON.parse(wave1PlanRaw3) as { generated_at?: string };
        expect(String(wave1Plan3.generated_at ?? "")).not.toBe(generatedAt1);

        const after3 = JSON.parse(await fs.readFile(perspectivesPath, "utf8"));
        expect(after3.perspectives[0].title).toBe("Default synthesis perspective");
      });
    });
  });

  test("status/inspect/triage/pause/resume/tick/run accept --run-id", async () => {
    await withTempDir(async (base) => {
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: base }, async () => {
        const runId = "dr_test_cli_run_handle_001";
        await initRun(runId);

        const commands: Array<string[]> = [
          ["status", "--run-id", runId],
          ["inspect", "--run-id", runId],
          ["triage", "--run-id", runId],
          ["pause", "--run-id", runId, "--reason", "test pause"],
          ["resume", "--run-id", runId, "--reason", "test resume"],
          ["tick", "--run-id", runId, "--reason", "test tick", "--driver", "fixture"],
          ["run", "--run-id", runId, "--reason", "test run", "--driver", "fixture", "--max-ticks", "1"],
        ];

        for (const cmd of commands) {
          const res = await runCli(cmd);
          expect(res.exit).toBe(0);
          expect(res.stderr).not.toContain("ERROR:");
        }
      });
    });
  });

  test("tick derives gates from manifest when --gates is omitted", async () => {
    await withTempDir(async (base) => {
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: base }, async () => {
        const runId = "dr_test_cli_optional_gates_001";
        const { manifestPath, gatesPath } = await initRun(runId);

        const res = await runCli(["tick", "--manifest", manifestPath, "--reason", "test optional gates", "--driver", "fixture"]);
        expect(res.exit).toBe(0);
        expect(res.stdout).toContain("tick.driver: fixture");
        expect(res.stdout).toContain(`gates_path: ${gatesPath}`);
      });
    });
  });

  test("run supports --until stage boundary", async () => {
    await withTempDir(async (base) => {
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: base }, async () => {
        const runId = "dr_test_cli_until_001";
        await initRun(runId);

        const res = await runCli([
          "run",
          "--run-id",
          runId,
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
  });

  test("cancel sets terminal status and run exits immediately", async () => {
    await withTempDir(async (base) => {
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: base }, async () => {
        const runId = "dr_test_cli_cancel_001";
        await initRun(runId);

        const cancelRes = await runCli(["cancel", "--run-id", runId, "--reason", "test cancel"]);
        expect(cancelRes.exit).toBe(0);
        expect(cancelRes.stdout).toContain("cancel.ok: true");

        const runRes = await runCli([
          "run",
          "--run-id",
          runId,
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
  });
});
