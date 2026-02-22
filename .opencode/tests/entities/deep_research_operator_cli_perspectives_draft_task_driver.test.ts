import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

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

function parseJsonStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("stdout missing JSON payload");
  return JSON.parse(trimmed) as Record<string, unknown>;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

  describe("deep_research operator CLI perspectives-draft task driver (entity)", () => {
    test("perspectives-draft --driver task writes prompt and halts with RUN_AGENT_REQUIRED", async () => {
      await withTempDir(async (base) => {
        const requiredPerspectiveIds = [
          "primary",
          "ensemble-independent",
          "ensemble-contrarian",
        ];
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

      const policyPath = path.join(runRoot, "operator", "config", "perspectives-policy.json");
      const policy = JSON.parse(await fs.readFile(policyPath, "utf8")) as Record<string, unknown>;
      expect(String(policy.schema_version ?? "")).toBe("perspectives-policy.v1");

      const perspectivesStatePath = path.join(runRoot, "operator", "state", "perspectives-state.json");
        const stateAfterInitialDraft = JSON.parse(await fs.readFile(perspectivesStatePath, "utf8")) as Record<string, unknown>;
        expect(String(stateAfterInitialDraft.schema_version ?? "")).toBe("perspectives-draft-state.v1");
        expect(String(stateAfterInitialDraft.status ?? "")).toBe("awaiting_agent_results");
        expect(String(stateAfterInitialDraft.policy_path ?? "")).toBe(policyPath);

        for (const perspectiveId of requiredPerspectiveIds) {
          const promptPath = path.join(runRoot, "operator", "prompts", "perspectives", `${perspectiveId}.md`);
          await fs.stat(promptPath);
        }

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

        const missingIds = missing
          .map((item) => String(item.perspective_id ?? "").trim())
          .filter((id) => id.length > 0)
          .sort();
        expect(missingIds).toEqual([...requiredPerspectiveIds].sort());

        for (const entry of missing) {
          expect(String(entry.prompt_digest ?? "")).toMatch(/^sha256:[a-f0-9]{64}$/u);
          const perspectiveId = String(entry.perspective_id ?? "").trim();
          const expectedPromptPath = path.join(runRoot, "operator", "prompts", "perspectives", `${perspectiveId}.md`);
          expect(String(entry.prompt_path ?? "")).toBe(expectedPromptPath);
        }
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
      expect((ingestPayload.result as any)?.stage).toBe("perspectives");
      expect((ingestPayload.result as any)?.noop).toBe(false);

      const expectedOutputPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.json");
      const expectedMetaPath = path.join(runRoot, "operator", "outputs", "perspectives", "primary.meta.json");
      expect(String((ingestPayload.result as any)?.output_path ?? "")).toBe(expectedOutputPath);
      expect(String((ingestPayload.result as any)?.meta_path ?? "")).toBe(expectedMetaPath);

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
      expect((noopPayload.result as any)?.noop).toBe(true);
      expect((noopPayload.result as any)?.stage).toBe("perspectives");

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

  test("perspectives-draft task flow auto-promotes ingested output to wave1 (M6 happy path)", async () => {
    await withTempDir(async (base) => {
      const requiredPerspectiveIds = [
        "primary",
        "ensemble-independent",
        "ensemble-contrarian",
      ];
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

      const policyPath = path.join(runRoot, "operator", "config", "perspectives-policy.json");
      const policy = JSON.parse(await fs.readFile(policyPath, "utf8")) as Record<string, unknown>;
      expect(String(policy.schema_version ?? "")).toBe("perspectives-policy.v1");

      const perspectivesStatePath = path.join(runRoot, "operator", "state", "perspectives-state.json");
      const stateAfterInitialDraft = JSON.parse(await fs.readFile(perspectivesStatePath, "utf8")) as Record<string, unknown>;
      expect(String(stateAfterInitialDraft.schema_version ?? "")).toBe("perspectives-draft-state.v1");
      expect(String(stateAfterInitialDraft.status ?? "")).toBe("awaiting_agent_results");
      expect(String(stateAfterInitialDraft.policy_path ?? "")).toBe(policyPath);

      for (const perspectiveId of requiredPerspectiveIds) {
        const track = perspectiveId === "ensemble-independent"
          ? "independent"
          : perspectiveId === "ensemble-contrarian"
          ? "contrarian"
          : "standard";
        const perspectivePayload = {
          schema_version: "perspectives-draft-output.v1",
          run_id: runId,
          source: {
            agent_type: "Engineer",
            label: `task-driver-transition-test:${perspectiveId}`,
          },
          candidates: [
            {
              title: `${perspectiveId} perspective`,
              questions: ["What should Wave 1 focus on first?"],
              track,
              recommended_agent_type: "researcher",
              domain: "technical",
              confidence: 86,
              rationale: "Covers M6 auto-promotion from ingested draft output.",
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

        const inputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.input.json`);
        await fs.mkdir(path.dirname(inputPath), { recursive: true });
        await fs.writeFile(inputPath, `${JSON.stringify(perspectivePayload, null, 2)}\n`, "utf8");

        const ingestRes = await runCli([
          "agent-result",
          "--manifest",
          manifestPath,
          "--stage",
          "perspectives",
          "--perspective",
          perspectiveId,
          "--input",
          inputPath,
          "--agent-run-id",
          `agent-run-${perspectiveId}-transition-001`,
          "--reason",
          `test ingest perspectives ${perspectiveId} for transition`,
          "--json",
        ]);
        expect(ingestRes.exit).toBe(0);
        const ingestPayload = parseJsonStdout(ingestRes.stdout);
        expect(ingestPayload.ok).toBe(true);
        expect((ingestPayload.result as any)?.noop).toBe(false);
      }

      const secondDraftRes = await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--reason",
        "test perspectives draft auto-promote after output",
        "--driver",
        "task",
      ]);
      expect(secondDraftRes.exit).toBe(0);
      expect(`${secondDraftRes.stdout}\n${secondDraftRes.stderr}`).not.toContain("RUN_AGENT_REQUIRED");

      const perspectivesPath = path.join(runRoot, "perspectives.json");
      const perspectivesDoc = JSON.parse(await fs.readFile(perspectivesPath, "utf8")) as Record<string, unknown>;
      expect(String(perspectivesDoc.schema_version ?? "")).toBe("perspectives.v1");
      expect(String(perspectivesDoc.run_id ?? "")).toBe(runId);
      const perspectives = Array.isArray(perspectivesDoc.perspectives)
        ? perspectivesDoc.perspectives as Array<Record<string, unknown>>
        : [];
      expect(perspectives.length).toBeGreaterThan(0);
      expect(String(perspectives[0]?.id ?? "").length).toBeGreaterThan(0);

      await fs.stat(path.join(runRoot, "wave-1", "wave1-plan.json"));

      const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        stage?: Record<string, unknown>;
      };
      expect(String(manifestAfter.stage?.current ?? "")).toBe("wave1");

      const stateAfterSecondDraft = JSON.parse(await fs.readFile(perspectivesStatePath, "utf8")) as Record<string, unknown>;
      expect(String(stateAfterSecondDraft.schema_version ?? "")).toBe("perspectives-draft-state.v1");
      expect(String(stateAfterSecondDraft.status ?? "")).toBe("promoted");
      expect(String(stateAfterSecondDraft.policy_path ?? "")).toBe(policyPath);
    });
  });

  test("perspectives-draft applies deterministic vote selection with policy thresholds", async () => {
    await withTempDir(async (base) => {
      const requiredPerspectiveIds = [
        "primary",
        "ensemble-independent",
        "ensemble-contrarian",
      ];
      const runId = "dr_test_cli_perspectives_draft_005";
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
        "test deterministic vote draft",
        "--driver",
        "task",
      ]);
      expect(draftRes.exit).toBe(0);
      expect(`${draftRes.stdout}\n${draftRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      for (const perspectiveId of requiredPerspectiveIds) {
        const candidates = perspectiveId === "primary"
          ? [
            {
              title: "Shared standard lens",
              questions: ["Which baseline evidence should Wave 1 gather first?"],
              track: "standard",
              recommended_agent_type: "researcher",
              domain: "technical",
              confidence: 76,
              rationale: "Shared across multiple sources with moderate confidence.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
            {
              title: "Primary solo standard lens",
              questions: ["Which current events should influence prioritization?"],
              track: "standard",
              recommended_agent_type: "researcher",
              domain: "news",
              confidence: 86,
              rationale: "Single-source but above backup threshold.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
            {
              title: "Independent shared lens",
              questions: ["Which independent checks should validate baseline claims?"],
              track: "independent",
              recommended_agent_type: "researcher",
              domain: "academic",
              confidence: 87,
              rationale: "Cross-source independent candidate.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
          ]
          : perspectiveId === "ensemble-independent"
          ? [
            {
              title: "Shared standard lens",
              questions: ["Which baseline evidence should Wave 1 gather first?"],
              track: "standard",
              recommended_agent_type: "researcher",
              domain: "technical",
              confidence: 78,
              rationale: "Boosts agreement count for shared standard candidate.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
            {
              title: "Independent shared lens",
              questions: ["Which independent checks should validate baseline claims?"],
              track: "independent",
              recommended_agent_type: "researcher",
              domain: "academic",
              confidence: 82,
              rationale: "Second source for independent candidate agreement.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
          ]
          : [
            {
              title: "Shared standard lens",
              questions: ["Which baseline evidence should Wave 1 gather first?"],
              track: "standard",
              recommended_agent_type: "researcher",
              domain: "technical",
              confidence: 74,
              rationale: "Third source for shared standard candidate agreement.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
            {
              title: "Contrarian low-confidence lens",
              questions: ["Which assumptions are likely wrong in the baseline plan?"],
              track: "contrarian",
              recommended_agent_type: "researcher",
              domain: "security",
              confidence: 84,
              rationale: "Below backup threshold to validate deterministic filtering.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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
          ];

        const perspectivePayload = {
          schema_version: "perspectives-draft-output.v1",
          run_id: runId,
          source: {
            agent_type: "Engineer",
            label: `task-driver-vote-test:${perspectiveId}`,
          },
          candidates,
        };

        const inputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.input.json`);
        await fs.mkdir(path.dirname(inputPath), { recursive: true });
        await fs.writeFile(inputPath, `${JSON.stringify(perspectivePayload, null, 2)}\n`, "utf8");

        const ingestRes = await runCli([
          "agent-result",
          "--manifest",
          manifestPath,
          "--stage",
          "perspectives",
          "--perspective",
          perspectiveId,
          "--input",
          inputPath,
          "--agent-run-id",
          `agent-run-${perspectiveId}-vote-001`,
          "--reason",
          `test ingest perspectives ${perspectiveId} for vote`,
          "--json",
        ]);
        expect(ingestRes.exit).toBe(0);
      }

      const secondDraftRes = await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--reason",
        "test deterministic vote merge after outputs",
        "--driver",
        "task",
      ]);
      expect(secondDraftRes.exit).toBe(0);
      expect(`${secondDraftRes.stdout}\n${secondDraftRes.stderr}`).not.toContain("RUN_AGENT_REQUIRED");

      const mergeReportPath = path.join(runRoot, "operator", "drafts", "perspectives.merge-report.json");
      const mergeReport = JSON.parse(await fs.readFile(mergeReportPath, "utf8")) as Record<string, unknown>;
      expect(Number(mergeReport.candidate_count_in ?? 0)).toBeGreaterThan(Number(mergeReport.candidate_count_out ?? 0));
      expect(Number(mergeReport.candidate_count_out ?? 0)).toBe(3);

      const perspectivesPath = path.join(runRoot, "perspectives.json");
      const perspectivesDoc = JSON.parse(await fs.readFile(perspectivesPath, "utf8")) as Record<string, unknown>;
      const perspectives = Array.isArray(perspectivesDoc.perspectives)
        ? perspectivesDoc.perspectives as Array<Record<string, unknown>>
        : [];
      expect(perspectives.length).toBeGreaterThan(0);

      const titles = perspectives.map((entry) => String(entry.title ?? ""));
      expect(titles).toEqual([
        "Shared standard lens",
        "Primary solo standard lens",
        "Independent shared lens",
      ]);
      expect(titles).not.toContain("Contrarian low-confidence lens");

      const tracks = perspectives.map((entry) => String(entry.track ?? ""));
      expect(tracks).toEqual(["standard", "standard", "independent"]);

      const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        stage?: Record<string, unknown>;
      };
      expect(String(manifestAfter.stage?.current ?? "")).toBe("wave1");
    });
  });

  test("perspectives-draft fail-closes when policy filters all candidates", async () => {
    await withTempDir(async (base) => {
      const requiredPerspectiveIds = [
        "primary",
        "ensemble-independent",
        "ensemble-contrarian",
      ];
      const runId = "dr_test_cli_perspectives_draft_006";
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
        "test fail-closed empty selection",
        "--driver",
        "task",
      ]);
      expect(draftRes.exit).toBe(0);
      expect(`${draftRes.stdout}\n${draftRes.stderr}`).toContain("RUN_AGENT_REQUIRED");

      for (const perspectiveId of requiredPerspectiveIds) {
        const track = perspectiveId === "ensemble-independent"
          ? "independent"
          : perspectiveId === "ensemble-contrarian"
          ? "contrarian"
          : "standard";

        const perspectivePayload = {
          schema_version: "perspectives-draft-output.v1",
          run_id: runId,
          source: {
            agent_type: "Engineer",
            label: `task-driver-empty-selection-test:${perspectiveId}`,
          },
          candidates: [
            {
              title: `${perspectiveId} low-confidence single-source lens`,
              questions: ["What weak signal should be ignored for wave selection?"],
              track,
              recommended_agent_type: "researcher",
              domain: "technical",
              confidence: 10,
              rationale: "Intentionally below deterministic backup threshold.",
              platform_requirements: [
                { name: "none", reason: "No hard platform dependency." },
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

        const inputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.input.json`);
        await fs.mkdir(path.dirname(inputPath), { recursive: true });
        await fs.writeFile(inputPath, `${JSON.stringify(perspectivePayload, null, 2)}\n`, "utf8");

        const ingestRes = await runCli([
          "agent-result",
          "--manifest",
          manifestPath,
          "--stage",
          "perspectives",
          "--perspective",
          perspectiveId,
          "--input",
          inputPath,
          "--agent-run-id",
          `agent-run-${perspectiveId}-empty-selection-001`,
          "--reason",
          `test ingest perspectives ${perspectiveId} for empty selection`,
          "--json",
        ]);
        expect(ingestRes.exit).toBe(0);
      }

      const secondDraftRes = await runCli([
        "perspectives-draft",
        "--manifest",
        manifestPath,
        "--reason",
        "test deterministic empty selection halt",
        "--driver",
        "task",
        "--json",
      ]);
      expect(secondDraftRes.exit).toBe(0);

      const secondDraftPayload = parseJsonStdout(secondDraftRes.stdout);
      expect(secondDraftPayload.ok).toBe(false);
      expect(secondDraftPayload.command).toBe("perspectives-draft");
      const secondDraftError = secondDraftPayload.error as Record<string, unknown>;
      expect(String(secondDraftError.code ?? "")).toBe("PERSPECTIVES_SELECTION_EMPTY");
      const secondDraftDetails = (secondDraftError.details ?? {}) as Record<string, unknown>;
      expect(String(secondDraftDetails.policy_path ?? "").length).toBeGreaterThan(0);
      expect(String(secondDraftDetails.draft_path ?? "").length).toBeGreaterThan(0);
      expect(String(secondDraftDetails.merge_report_path ?? "").length).toBeGreaterThan(0);
      expect(Number(secondDraftDetails.candidate_count_in ?? -1)).toBe(3);
      expect(Number(secondDraftDetails.candidate_count_out ?? -1)).toBe(0);
      const thresholds = (secondDraftDetails.thresholds ?? {}) as Record<string, unknown>;
      expect(Number(thresholds.ensemble_threshold ?? -1)).toBeGreaterThanOrEqual(0);
      expect(Number(thresholds.backup_threshold ?? -1)).toBeGreaterThanOrEqual(0);

      const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        stage?: Record<string, unknown>;
      };
      expect(String(manifestAfter.stage?.current ?? "")).toBe("perspectives");

      const perspectivesPath = path.join(runRoot, "perspectives.json");
      await expect(fs.stat(perspectivesPath)).rejects.toBeTruthy();

      const haltLatestPath = path.join(runRoot, "operator", "halt", "latest.json");
      const haltLatest = JSON.parse(await fs.readFile(haltLatestPath, "utf8")) as Record<string, unknown>;
      const haltError = (haltLatest.error ?? {}) as Record<string, unknown>;
      expect(String(haltError.code ?? "")).toBe("PERSPECTIVES_SELECTION_EMPTY");
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
      expect((rawInputPayload.result as any)?.noop).toBe(false);

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
      expect((noopRawInputPayload.result as any)?.noop).toBe(true);
      const finalMeta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(String(finalMeta.agent_run_id ?? "")).toBe("agent-run-primary-raw-001");
    });
  });
});
