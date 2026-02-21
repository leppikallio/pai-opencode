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

describe("deep_research tick --json halt next_commands (regression)", () => {
  test("tick --json includes halt.next_commands when tick fails", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_tick_json_next_commands_001";

      const initPayload = expectSingleJsonStdout(await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--json",
      ]), 0);

      const manifestPath = String(initPayload.manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);

      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.status = "running";
      manifest.stage = { ...(manifest.stage as Record<string, unknown> ?? {}), current: "perspectives" };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const tickPayload = expectSingleJsonStdout(await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "test tick failure json envelope",
        "--driver",
        "task",
        "--json",
      ]), 0);

      expect(tickPayload.command).toBe("tick");
      const tick = tickPayload.tick as Record<string, unknown>;
      expect(tick.ok).toBe(false);
      const tickError = tick.error as Record<string, unknown>;
      expect(String(tickError.code ?? "")).toBe("INVALID_STATE");

      const halt = tickPayload.halt as Record<string, unknown> | null;
      expect(halt).toBeTruthy();
      const nextCommands = Array.isArray(halt?.next_commands) ? halt.next_commands : [];
      expect(nextCommands.length).toBeGreaterThan(0);
      for (const command of nextCommands) {
        expect(String(command ?? "").trim().length).toBeGreaterThan(0);
      }
    });
  });
});
