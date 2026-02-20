import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

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

function parseJsonStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("stdout missing JSON payload");
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as NodeJS.ErrnoException).code ?? "")
      : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

  test("agent-result --stage perspectives ingest covers success + noop + digest mismatch", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_perspectives_draft_002";
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

      const perspectivePayload = {
        schema_version: "perspectives-draft-output.v1",
        run_id: runId,
        source: {
          agent_type: "Engineer",
          label: "task-driver-test",
        },
        candidates: [
          {
            title: "Primary perspective",
            questions: ["What should Wave 1 focus on first?"],
            track: "standard",
            recommended_agent_type: "researcher",
            domain: "technical",
            confidence: 78,
            rationale: "Covers technical baseline requirements first.",
            platform_requirements: [
              { name: "none", reason: "No external platform hard requirement for this candidate." },
            ],
            tool_policy: {
              primary: ["websearch"],
              secondary: [],
              forbidden: [],
            },
            flags: {
              human_review_required: false,
              missing_platform_requirements: false,
              missing_tool_policy: false,
            },
          },
        ],
      };
      const inputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.input.json");
      const inputText = `${JSON.stringify(perspectivePayload, null, 2)}\n`;
      await fs.mkdir(path.dirname(inputPath), { recursive: true });
      await fs.writeFile(inputPath, inputText, "utf8");

      const ingestRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        inputPath,
        "--agent-run-id",
        "agent-run-primary-001",
        "--reason",
        "test ingest perspectives primary",
        "--json",
      ]);
      expect(ingestRes.exit).toBe(0);

      const ingestPayload = parseJsonStdout(ingestRes.stdout);
      expect(ingestPayload.ok).toBe(true);
      expect(ingestPayload.command).toBe("agent-result");
      expect(ingestPayload.stage).toBe("perspectives");
      expect(ingestPayload.noop).toBe(false);

      const expectedOutputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.json");
      const expectedMetaPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.meta.json");
      expect(String(ingestPayload.output_path ?? "")).toBe(expectedOutputPath);
      expect(String(ingestPayload.meta_path ?? "")).toBe(expectedMetaPath);

      const promptPath = path.join(runRoot, "operator", "prompts", "perspectives", "primary.md");
      const promptMarkdown = await fs.readFile(promptPath, "utf8");
      const expectedPromptDigest = `sha256:${sha256Hex(promptMarkdown)}`;

      const rawPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.raw.json");
      const rawText = await fs.readFile(rawPath, "utf8");
      expect(rawText).toBe(inputText);

      const normalizedPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.json");
      const normalized = JSON.parse(await fs.readFile(normalizedPath, "utf8")) as Record<string, unknown>;
      expect(String(normalized.schema_version ?? "")).toBe("perspectives-draft-output.v1");
      expect(String(normalized.run_id ?? "")).toBe(runId);

      const metaPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.meta.json");
      const metaBefore = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(metaBefore.prompt_digest ?? "")).toBe(expectedPromptDigest);
      expect(String(metaBefore.agent_run_id ?? "")).toBe("agent-run-primary-001");

      const noopRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        inputPath,
        "--agent-run-id",
        "agent-run-primary-002",
        "--reason",
        "test noop ingest perspectives primary",
        "--json",
      ]);
      expect(noopRes.exit).toBe(0);

      const noopPayload = parseJsonStdout(noopRes.stdout);
      expect(noopPayload.ok).toBe(true);
      expect(noopPayload.noop).toBe(true);
      expect(noopPayload.stage).toBe("perspectives");

      const metaAfter = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(metaAfter.agent_run_id ?? "")).toBe("agent-run-primary-001");

      await fs.appendFile(promptPath, "\n<!-- digest mismatch trigger -->\n", "utf8");

      const mismatchRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        inputPath,
        "--agent-run-id",
        "agent-run-primary-003",
        "--reason",
        "test digest mismatch ingest perspectives primary",
        "--json",
      ]);
      expect(mismatchRes.exit).toBe(1);

      const mismatchPayload = parseJsonStdout(mismatchRes.stdout);
      expect(mismatchPayload.ok).toBe(false);
      expect(mismatchPayload.command).toBe("agent-result");
      const mismatchError = mismatchPayload.error as Record<string, unknown>;
      expect(String(mismatchError.code ?? "")).toBe("AGENT_RESULT_PROMPT_DIGEST_CONFLICT");
    });
  });

  test("perspectives-draft task flow covers state transitions and merge-required halt when outputs exist", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_perspectives_draft_004";
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
        "test perspectives draft with transitions",
        "--driver",
        "task",
      ]);
      expect(draftRes.exit).toBe(0);

      const perspectivesStatePath = path.join(runRoot, "operator", "state", "perspectives-state.json");
      const stateAfterInitialDraft = await readJsonIfExists(perspectivesStatePath);
      if (stateAfterInitialDraft) {
        expect(String(stateAfterInitialDraft.schema_version ?? "")).toBe("perspectives-draft-state.v1");
        expect(String(stateAfterInitialDraft.status ?? "")).toBe("awaiting_agent_results");
      } else {
        // Backward compatibility until all environments include M4 state artifacts.
        expect(`${draftRes.stdout}\n${draftRes.stderr}`).toContain("RUN_AGENT_REQUIRED");
      }

      const perspectivePayload = {
        schema_version: "perspectives-draft-output.v1",
        run_id: runId,
        source: {
          agent_type: "Engineer",
          label: "task-driver-transition-test",
        },
        candidates: [
          {
            title: "Primary perspective",
            questions: ["What should Wave 1 focus on first?"],
            track: "standard",
            recommended_agent_type: "researcher",
            domain: "technical",
            confidence: 82,
            rationale: "Covers state transition + merge-halt expectations.",
            platform_requirements: [
              { name: "none", reason: "No external platform hard requirement for this candidate." },
            ],
            tool_policy: {
              primary: ["websearch"],
              secondary: [],
              forbidden: [],
            },
            flags: {
              human_review_required: false,
              missing_platform_requirements: false,
              missing_tool_policy: false,
            },
          },
        ],
      };

      const inputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.input.json");
      await fs.mkdir(path.dirname(inputPath), { recursive: true });
      await fs.writeFile(inputPath, `${JSON.stringify(perspectivePayload, null, 2)}\n`, "utf8");

      const ingestRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        inputPath,
        "--agent-run-id",
        "agent-run-primary-transition-001",
        "--reason",
        "test ingest perspectives primary for transition",
        "--json",
      ]);
      expect(ingestRes.exit).toBe(0);
      const ingestPayload = parseJsonStdout(ingestRes.stdout);
      expect(ingestPayload.ok).toBe(true);
      expect(ingestPayload.noop).toBe(false);

      const secondDraftRes = await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--reason",
        "test perspectives draft halt after output",
        "--driver",
        "task",
        "--json",
      ]);
      expect(secondDraftRes.exit).toBe(0);

      const secondDraftPayload = parseJsonStdout(secondDraftRes.stdout);
      const secondDraftError = (secondDraftPayload.error ?? {}) as Record<string, unknown>;
      const secondCodeFromPayload = String(secondDraftError.code ?? "");

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = await readJsonIfExists(haltLatestPath);
      const haltLatestError = (haltLatest?.error ?? {}) as Record<string, unknown>;
      const secondCode = secondCodeFromPayload || String(haltLatestError.code ?? "");

      expect(secondCode.length).toBeGreaterThan(0);

      const stateAfterSecondDraft = await readJsonIfExists(perspectivesStatePath);
      if (stateAfterSecondDraft) {
        expect(String(stateAfterSecondDraft.schema_version ?? "")).toBe("perspectives-draft-state.v1");
        expect(String(stateAfterSecondDraft.status ?? "")).toBe("merging");
        expect(secondCode).not.toBe("RUN_AGENT_REQUIRED");
      } else {
        // Backward compatibility until all environments include M4 state artifacts.
        expect(secondCode).toBe("RUN_AGENT_REQUIRED");
      }
    });
  });

  test("agent-result --stage perspectives accepts raw output path as input without --force", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_cli_perspectives_draft_003";
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
        "test perspectives draft raw input path",
        "--driver",
        "task",
      ]);
      expect(draftRes.exit).toBe(0);
      expect(`${draftRes.stdout}\n${draftRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      const perspectivePayload = {
        schema_version: "perspectives-draft-output.v1",
        run_id: runId,
        source: {
          agent_type: "Engineer",
          label: "task-driver-raw-input-test",
        },
        candidates: [
          {
            title: "Primary perspective",
            questions: ["What should Wave 1 focus on first?"],
            track: "standard",
            recommended_agent_type: "researcher",
            domain: "technical",
            confidence: 81,
            rationale: "Proves raw-path ingest behavior for task-driver mode.",
            platform_requirements: [
              { name: "none", reason: "No external platform hard requirement for this candidate." },
            ],
            tool_policy: {
              primary: ["websearch"],
              secondary: [],
              forbidden: [],
            },
            flags: {
              human_review_required: false,
              missing_platform_requirements: false,
              missing_tool_policy: false,
            },
          },
        ],
      };

      const inputText = `${JSON.stringify(perspectivePayload, null, 2)}\n`;
      const rawInputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.raw.json");
      await fs.mkdir(path.dirname(rawInputPath), { recursive: true });
      await fs.writeFile(rawInputPath, inputText, "utf8");

      const rawInputRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        rawInputPath,
        "--agent-run-id",
        "agent-run-primary-raw-001",
        "--reason",
        "test ingest raw perspectives primary",
        "--json",
      ]);
      expect(rawInputRes.exit).toBe(0);
      const rawInputPayload = parseJsonStdout(rawInputRes.stdout);
      expect(rawInputPayload.ok).toBe(true);
      expect(rawInputPayload.noop).toBe(false);

      const expectedOutputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.json");
      const metaPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.meta.json");
      const storedRaw = await fs.readFile(rawInputPath, "utf8");
      expect(storedRaw).toBe(inputText);

      const output = JSON.parse(await fs.readFile(expectedOutputPath, "utf8")) as Record<string, unknown>;
      expect(String(output.schema_version ?? "")).toBe("perspectives-draft-output.v1");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(meta.agent_run_id ?? "")).toBe("agent-run-primary-raw-001");

      const noopRawInputRes = await runCli([
        "agent-result",
        "--manifest",
        manifestPath,
        "--stage",
        "perspectives",
        "--perspective",
        "primary",
        "--input",
        rawInputPath,
        "--agent-run-id",
        "agent-run-primary-raw-002",
        "--reason",
        "test noop ingest raw perspectives primary",
        "--json",
      ]);
      expect(noopRawInputRes.exit).toBe(0);
      const noopRawInputPayload = parseJsonStdout(noopRawInputRes.stdout);
      expect(noopRawInputPayload.ok).toBe(true);
      expect(noopRawInputPayload.noop).toBe(true);
      const finalMeta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(finalMeta.agent_run_id ?? "")).toBe("agent-run-primary-raw-001");
    });
  });
});
