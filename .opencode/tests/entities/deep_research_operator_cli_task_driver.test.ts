import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

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

function extractField(stdout: string, field: string): string {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = stdout.match(pattern);
  if (!match) throw new Error(`field ${field} missing from output:\n${stdout}`);
  return match[1].trim();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("deep_research operator CLI task driver (entity)", () => {
  test("tick --driver task prompt-outs and agent-result ingests canonical wave outputs", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_task_driver_001";
      const initRes = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base]);
      expect(initRes.exit).toBe(0);

      const manifestPath = extractField(initRes.stdout, "manifest_path");
      const runRoot = extractField(initRes.stdout, "run_root");

      await fs.stat(path.join(runRoot, "operator", "scope.json"));
      await fs.stat(path.join(runRoot, "perspectives.json"));
      await fs.stat(path.join(runRoot, "wave-1", "wave1-plan.json"));

      const tickRes = await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "test task driver prompt-out",
        "--driver",
        "task",
      ]);
      expect(tickRes.exit).toBe(0);
      expect(`${tickRes.stdout}\n${tickRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      const promptPath = path.join(runRoot, "operator", "prompts", "wave1", "p1.md");
      await fs.stat(promptPath);

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = JSON.parse(await fs.readFile(haltLatestPath, "utf8")) as Record<string, unknown>;
      const haltError = (haltLatest.error ?? {}) as Record<string, unknown>;
      expect(String(haltLatest.schema_version ?? "")).toBe("halt.v1");
      expect(String(haltError.code ?? "")).toBe("RUN_AGENT_REQUIRED");
      const nextCommands = Array.isArray(haltLatest.next_commands) ? haltLatest.next_commands : [];
      expect(nextCommands.some((item) => String(item).startsWith('bun "pai-tools/deep-research-cli.ts"'))).toBe(true);
      expect(nextCommands.some((item) => String(item).includes("agent-result") && String(item).includes("--perspective \"p1\""))).toBe(true);

      const inputMarkdownPath = fixturePath("wave-output", "valid.md");
      const agentRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "wave1",
        "--perspective",
        "p1",
        "--input",
        inputMarkdownPath,
        "--agent-run-id",
        "agent-run-p1-001",
        "--reason",
        "test ingest p1",
      ]);
      expect(agentRes.exit).toBe(0);

      const outputPath = path.join(runRoot, "wave-1", "p1.md");
      const outputMarkdown = await fs.readFile(outputPath, "utf8");
      expect(outputMarkdown).toContain("## Findings");

      const planPath = path.join(runRoot, "wave-1", "wave1-plan.json");
      const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as { entries?: Array<Record<string, unknown>> };
      const planEntry = (plan.entries ?? []).find((entry) => String(entry.perspective_id ?? "") === "p1");
      expect(planEntry).toBeDefined();
      const expectedPromptDigest = `sha256:${sha256Hex(String(planEntry?.prompt_md ?? ""))}`;

      const metaPath = path.join(runRoot, "wave-1", "p1.meta.json");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(meta.schema_version ?? "")).toBe("wave-output-meta.v1");
      expect(String(meta.prompt_digest ?? "")).toBe(expectedPromptDigest);
      expect(String(meta.agent_run_id ?? "")).toBe("agent-run-p1-001");
      expect(String(meta.source_input_path ?? "")).toBe(inputMarkdownPath);
    });
  });
});
