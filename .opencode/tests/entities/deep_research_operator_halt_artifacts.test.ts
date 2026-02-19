import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
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

function extractField(stdout: string, field: string): string {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = stdout.match(pattern);
  if (!match) throw new Error(`field ${field} missing from output:\n${stdout}`);
  return match[1].trim();
}

async function initRun(runId: string, runsRoot: string): Promise<{ manifestPath: string; runRoot: string }> {
  const initRes = await runCli(["init", "Q", "--run-id", runId, "--runs-root", runsRoot]);
  expect(initRes.exit).toBe(0);
  expect(initRes.stderr.trim()).toBe("");
  return {
    manifestPath: extractField(initRes.stdout, "manifest_path"),
    runRoot: extractField(initRes.stdout, "run_root"),
  };
}

async function forceDeterministicTickFailure(runRoot: string): Promise<void> {
  await fs.rm(path.join(runRoot, "perspectives.json"), { force: true });
}

async function readHaltLatest(runRoot: string): Promise<Record<string, unknown>> {
  const latestPath = path.join(runRoot, "operator", "halt", "latest.json");
  const latestRaw = await fs.readFile(latestPath, "utf8");
  return JSON.parse(latestRaw) as Record<string, unknown>;
}

describe("deep_research operator CLI halt artifacts (entity)", () => {
  test("tick failure writes halt/latest and increments deterministic tick index", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_halt_tick_001";
      const { manifestPath, runRoot } = await initRun(runId, base);
      await forceDeterministicTickFailure(runRoot);

        const tick1 = await runCli([
          "tick",
          "--manifest",
          manifestPath,
          "--reason",
          "test halt tick 1",
          "--driver",
          "fixture",
        ]);
        expect(tick1.exit).toBe(0);
        expect(tick1.stdout).toContain("tick.ok: false");

        const haltDir = path.join(runRoot, "operator", "halt");
        const tick0001Exists = await fs.stat(path.join(haltDir, "tick-0001.json")).then(() => true).catch(() => false);
        expect(tick0001Exists).toBe(true);

        const latest1 = await readHaltLatest(runRoot);
        expect(String(latest1.schema_version ?? "")).toBe("halt.v1");
        const nextCommands1 = Array.isArray(latest1.next_commands) ? latest1.next_commands : [];
        expect(nextCommands1.length).toBeGreaterThan(0);
        expect(String(nextCommands1[0] ?? "").trim().length).toBeGreaterThan(0);

        const tick2 = await runCli([
          "tick",
          "--manifest",
          manifestPath,
          "--reason",
          "test halt tick 2",
          "--driver",
          "fixture",
        ]);
        expect(tick2.exit).toBe(0);
        expect(tick2.stdout).toContain("tick.ok: false");

        const tick0002Exists = await fs.stat(path.join(haltDir, "tick-0002.json")).then(() => true).catch(() => false);
        expect(tick0002Exists).toBe(true);

      const latest2 = await readHaltLatest(runRoot);
      expect(Number(latest2.tick_index ?? 0)).toBe(2);
    });
  });

  test("run loop tick failure writes halt/latest artifact", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_halt_run_001";
      const { manifestPath, runRoot } = await initRun(runId, base);
      await forceDeterministicTickFailure(runRoot);

        const runRes = await runCli([
          "run",
          "--manifest",
          manifestPath,
          "--reason",
          "test halt run",
          "--driver",
          "fixture",
          "--max-ticks",
          "1",
        ]);

        expect(runRes.exit).toBe(0);
        expect(runRes.stdout).toContain("run.ok: false");

        const haltDir = path.join(runRoot, "operator", "halt");
        const tick0001Exists = await fs.stat(path.join(haltDir, "tick-0001.json")).then(() => true).catch(() => false);
        expect(tick0001Exists).toBe(true);

        const latest = await readHaltLatest(runRoot);
        expect(String(latest.schema_version ?? "")).toBe("halt.v1");
      const nextCommands = Array.isArray(latest.next_commands) ? latest.next_commands : [];
      expect(nextCommands.length).toBeGreaterThan(0);
    });
  });
});
