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

describe("deep_research operator CLI perspectives-draft task driver (entity)", () => {
  test("perspectives-draft --driver task writes prompt and halts with RUN_AGENT_REQUIRED", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_perspectives_draft_001";
      const initRes = await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--no-perspectives",
      ]);
      expect(initRes.exit).toBe(0);

      const manifestPath = extractField(initRes.stdout, "manifest_path");
      const runRoot = extractField(initRes.stdout, "run_root");

      const advanceRes = await runCli([
        "stage-advance",
        "--manifest",
        manifestPath,
        "--requested-next",
        "perspectives",
        "--reason",
        "test enter perspectives stage",
      ]);
      expect(advanceRes.exit).toBe(0);

      const draftRes = await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--reason",
        "test perspectives draft prompt-out",
        "--driver",
        "task",
      ]);
      expect(draftRes.exit).toBe(0);
      expect(`${draftRes.stdout}\n${draftRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      const promptPath = path.join(runRoot, "operator", "prompts", "perspectives", "primary.md");
      await fs.stat(promptPath);

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = JSON.parse(await fs.readFile(haltLatestPath, "utf8")) as Record<string, unknown>;
      const haltError = (haltLatest.error ?? {}) as Record<string, unknown>;
      const haltDetails = (haltError.details ?? {}) as Record<string, unknown>;
      const missing = Array.isArray(haltDetails.missing_perspectives)
        ? haltDetails.missing_perspectives as Array<Record<string, unknown>>
        : [];

      expect(String(haltLatest.schema_version ?? "")).toBe("halt.v1");
      expect(String(haltError.code ?? "")).toBe("RUN_AGENT_REQUIRED");
      expect(String(haltDetails.stage ?? "")).toBe("perspectives");
      expect(missing.length).toBeGreaterThan(0);
      expect(String(missing[0]?.perspective_id ?? "")).toBe("primary");
      expect(String(missing[0]?.prompt_path ?? "")).toBe(promptPath);
      expect(String(missing[0]?.prompt_digest ?? "")).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });
  });
});
