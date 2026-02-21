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

function extractField(stdout: string, field: string): string {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = stdout.match(pattern);
  if (!match) throw new Error(`field ${field} missing from output:\n${stdout}`);
  return match[1].trim();
}

describe("deep_research operator CLI wave2 task driver (entity)", () => {
  test("tick --driver task prompt-outs wave2 gaps and agent-result ingests wave2 outputs", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_wave2_task_driver_001";
      const initRes = await runCli(["init", "Q", "--run-id", runId, "--runs-root", base]);
      expect(initRes.exit).toBe(0);

      const manifestPath = extractField(initRes.stdout, "manifest_path");
      const runRoot = extractField(initRes.stdout, "run_root");

      // Seed pivot decision + force stage to wave2 (test isolation; no wave1 required here).
      const pivotPath = path.join(runRoot, "pivot.json");
      await fs.writeFile(
        pivotPath,
        `${JSON.stringify(
          {
            schema_version: "pivot.v1",
            run_id: runId,
            created_at: new Date().toISOString(),
            decision: {
              wave2_required: true,
              wave2_gap_ids: ["gap_alpha"],
            },
            gaps: [
              {
                gap_id: "gap_alpha",
                priority: "P1",
                text: "Need one follow-up source for the main claim.",
                from_perspective_id: "p1",
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
      manifestRaw.stage = { ...(manifestRaw.stage ?? {}), current: "wave2" };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifestRaw, null, 2)}\n`, "utf8");

      const tickRes = await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "test wave2 task driver prompt-out",
        "--driver",
        "task",
      ]);
      expect(tickRes.exit).toBe(0);
      expect(`${tickRes.stdout}\n${tickRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      const promptPath = path.join(runRoot, "operator", "prompts", "wave2", "gap_alpha.md");
      await fs.stat(promptPath);

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = JSON.parse(await fs.readFile(haltLatestPath, "utf8")) as Record<string, unknown>;
      const haltError = (haltLatest.error ?? {}) as Record<string, unknown>;
      expect(String(haltLatest.schema_version ?? "")).toBe("halt.v1");
      expect(String(haltError.code ?? "")).toBe("RUN_AGENT_REQUIRED");
      const nextCommands = Array.isArray(haltLatest.next_commands) ? haltLatest.next_commands : [];
      expect(nextCommands.some((item) => String(item).startsWith('bun "pai-tools/deep-research-cli.ts"'))).toBe(true);
      expect(nextCommands.some((item) => String(item).includes("agent-result") && String(item).includes("--stage wave2") && String(item).includes("--perspective \"gap_alpha\""))).toBe(true);

      const inputMarkdownPath = path.join(repoRoot, ".opencode", "tests", "fixtures", "wave-output", "valid-no-example.md");
      const agentRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "wave2",
        "--perspective",
        "gap_alpha",
        "--input",
        inputMarkdownPath,
        "--agent-run-id",
        "agent-run-gap-alpha-001",
        "--reason",
        "test ingest wave2 gap_alpha",
      ]);
      expect(agentRes.exit).toBe(0);

      const outputPath = path.join(runRoot, "wave-2", "gap_alpha.md");
      const outputMarkdown = await fs.readFile(outputPath, "utf8");
      expect(outputMarkdown).toContain("## Findings");
      expect(outputMarkdown).toContain("## Sources");

      const tickResume = await runCli([
        "tick",
        "--manifest",
        manifestPath,
        "--reason",
        "resume wave2 after agent-result",
        "--driver",
        "task",
      ]);
      expect(tickResume.exit).toBe(0);

      const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
      expect(String(manifestAfter.stage?.current ?? "")).toBe("citations");
    });
  });
});
