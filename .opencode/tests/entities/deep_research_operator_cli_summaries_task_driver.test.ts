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

describe("deep_research operator CLI summaries task driver (entity)", () => {
  test("summaries stage prompt-outs and halts until agent-result ingestion", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_summaries_task_driver_001";
      const initRes = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base]);
      expect(initRes.exit).toBe(0);

      const manifestPath = extractField(initRes.stdout, "manifest_path");
      const runRoot = extractField(initRes.stdout, "run_root");

      const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
      manifestRaw.stage = { ...(manifestRaw.stage ?? {}), current: "summaries" };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

      const tickRes = await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "test summaries task driver prompt-out",
        "--driver",
        "task",
      ]);
      expect(tickRes.exit).toBe(0);
      expect(`${tickRes.stdout}\n${tickRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      const promptPath = path.join(runRoot, "operator", "prompts", "summaries", "p1.md");
      await fs.stat(promptPath);

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = JSON.parse(await fs.readFile(haltLatestPath, "utf8")) as Record<string, unknown>;
      const haltError = (haltLatest.error ?? {}) as Record<string, unknown>;
      expect(String(haltLatest.schema_version ?? "")).toBe("halt.v1");
      expect(String(haltError.code ?? "")).toBe("RUN_AGENT_REQUIRED");
      const nextCommands = Array.isArray(haltLatest.next_commands) ? haltLatest.next_commands : [];
      expect(nextCommands.some((item) => String(item).startsWith('bun "pai-tools/deep-research-option-c.ts"'))).toBe(true);
      expect(nextCommands.some((item) => String(item).includes("agent-result") && String(item).includes("--stage summaries") && String(item).includes("--perspective \"p1\""))).toBe(true);
    });
  });
});
