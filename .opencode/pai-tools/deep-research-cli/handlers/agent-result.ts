import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveDeepResearchCliFlagsV1 } from "../../../tools/deep_research_cli/lifecycle_lib";
import { sha256DigestForJson } from "../../../tools/deep_research_cli/wave_tools_shared";
import { emitJsonV1 } from "../cli/json-contract";
import {
  throwWithCode,
  throwWithCodeAndDetails,
} from "../cli/errors";
import {
  asObject,
  readJsonObject,
} from "../utils/io-json";
import { fileExists } from "../utils/fs-utils";
import {
  assertWithinRoot,
  isSafeSegment,
  normalizeOptional,
  requireAbsolutePath,
} from "../utils/paths";
import {
  printContract,
  resolvePerspectivesPathFromManifest,
  summarizeManifest,
  withRunLock,
} from "../utils/run-handle";
import { resolveDeepResearchCliInvocation } from "../utils/cli-invocation";
import { nowIso } from "../utils/time";
import {
  normalizePromptDigest,
  promptDigestFromPromptMarkdown,
} from "../utils/digest";
import { normalizePerspectivesDraftOutputV1 } from "../perspectives/schema";

export type AgentResultCliArgs = {
  manifest: string;
  stage: "perspectives" | "wave1" | "wave2" | "summaries" | "synthesis";
  perspective: string;
  input: string;
  agentRunId: string;
  reason: string;
  force: boolean;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  json?: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchCliFlagsV1();
  if (!flags.cliEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

async function readPromptDigestFromMeta(metaPath: string): Promise<string | null> {
  const exists = await fileExists(metaPath);
  if (!exists) return null;

  try {
    const metaRaw = await readJsonObject(metaPath);
    return normalizePromptDigest(metaRaw.prompt_digest);
  } catch {
    return null;
  }
}

async function readWave1PlanEntries(args: {
  runRoot: string;
  manifest: Record<string, unknown>;
}): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave1PlanPath = path.join(args.runRoot, "wave-1", "wave1-plan.json");
  const wave1Plan = await readJsonObject(wave1PlanPath);

  const perspectivesPath = await resolvePerspectivesPathFromManifest(args.manifest);
  const perspectivesDoc = await readJsonObject(perspectivesPath);
  const expectedDigest = sha256DigestForJson(perspectivesDoc);
  const actualDigest = typeof wave1Plan.perspectives_digest === "string"
    ? wave1Plan.perspectives_digest.trim()
    : "";
  if (!actualDigest || actualDigest !== expectedDigest) {
    throwWithCodeAndDetails(
      "WAVE1_PLAN_STALE",
      "WAVE1_PLAN_STALE: wave1 plan perspectives digest mismatch",
      {
        plan_path: wave1PlanPath,
        perspectives_path: perspectivesPath,
        expected_digest: expectedDigest,
        actual_digest: actualDigest || null,
      },
    );
  }

  const entries = Array.isArray(wave1Plan.entries)
    ? (wave1Plan.entries as Array<unknown>)
    : [];
  const out: Array<{ perspectiveId: string; promptMd: string }> = [];

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    const perspectiveId = String(entry.perspective_id ?? "").trim();
    const promptMd = String(entry.prompt_md ?? "");
    if (!perspectiveId || !promptMd.trim()) continue;
    if (!isSafeSegment(perspectiveId)) continue;
    out.push({ perspectiveId, promptMd });
  }

  if (out.length === 0) {
    throw new Error(`wave1 plan has no valid entries (${wave1PlanPath})`);
  }
  return out;
}

async function readWave2PlanEntries(runRoot: string): Promise<Array<{ perspectiveId: string; promptMd: string }>> {
  const wave2PlanPath = path.join(runRoot, "wave-2", "wave2-plan.json");
  const wave2Plan = await readJsonObject(wave2PlanPath);
  const entries = Array.isArray(wave2Plan.entries)
    ? (wave2Plan.entries as Array<unknown>)
    : [];
  const out: Array<{ perspectiveId: string; promptMd: string }> = [];

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    const perspectiveId = String(entry.perspective_id ?? "").trim();
    const promptMd = String(entry.prompt_md ?? "");
    if (!perspectiveId || !promptMd.trim()) continue;
    if (!isSafeSegment(perspectiveId)) continue;
    out.push({ perspectiveId, promptMd });
  }

  if (out.length === 0) {
    throw new Error(`wave2 plan has no valid entries (${wave2PlanPath})`);
  }
  return out;
}

export async function runAgentResult(args: AgentResultCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const inputPath = requireAbsolutePath(args.input, "--input");
  const stage = args.stage;
  const perspectiveId = args.perspective.trim();
  const agentRunId = args.agentRunId.trim();
  const reason = args.reason.trim();

  if (stage !== "perspectives" && stage !== "wave1" && stage !== "wave2" && stage !== "summaries" && stage !== "synthesis") {
    throw new Error("--stage must be perspectives|wave1|wave2|summaries|synthesis");
  }
  if (!isSafeSegment(perspectiveId)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!agentRunId) {
    throw new Error("--agent-run-id must be non-empty");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const sourceInputText = await fs.readFile(inputPath, "utf8");
  if (!sourceInputText.trim()) {
    throw new Error("--input is empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runRoot = summary.runRoot;
  let promptMd: string;
  let promptDigest: string;
  let outputPath: string;
  let rawOutputPath: string | null = null;
  let metaPath: string;
  let normalizedPerspectivesOutput: ReturnType<typeof normalizePerspectivesDraftOutputV1> | null = null;
  let noop = false;

  if (stage === "perspectives") {
    const promptPath = path.join(runRoot, "operator", "prompts", "perspectives", `${perspectiveId}.md`);
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`perspectives prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);

    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(sourceInputText);
    } catch {
      throwWithCode("AGENT_RESULT_PERSPECTIVES_INPUT_INVALID_JSON", "--input must be valid JSON for stage=perspectives");
    }

    normalizedPerspectivesOutput = normalizePerspectivesDraftOutputV1({
      value: parsedInput,
      expectedRunId: summary.runId,
    });

    rawOutputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.raw.json`);
    outputPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.json`);
    metaPath = path.join(runRoot, "operator", "outputs", "perspectives", `${perspectiveId}.meta.json`);
  } else if (stage === "wave1" || stage === "wave2") {
    const planEntries = stage === "wave1"
      ? await readWave1PlanEntries({ runRoot, manifest })
      : await readWave2PlanEntries(runRoot);
    const planEntry = planEntries.find((entry) => entry.perspectiveId === perspectiveId);
    if (!planEntry) {
      throw new Error(`perspective ${perspectiveId} not found in ${stage} plan`);
    }
    promptMd = planEntry.promptMd;
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    const waveDir = stage === "wave1" ? "wave-1" : "wave-2";
    outputPath = path.join(runRoot, waveDir, `${perspectiveId}.md`);
    metaPath = path.join(runRoot, waveDir, `${perspectiveId}.meta.json`);
  } else if (stage === "summaries") {
    const promptPath = path.join(runRoot, "operator", "prompts", "summaries", `${perspectiveId}.md`);
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`summary prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "summaries", `${perspectiveId}.md`);
    metaPath = path.join(runRoot, "summaries", `${perspectiveId}.meta.json`);
  } else {
    const promptPath = path.join(runRoot, "operator", "prompts", "synthesis", "final-synthesis.md");
    promptMd = await fs.readFile(promptPath, "utf8");
    if (!promptMd.trim()) throw new Error(`synthesis prompt missing/empty: ${promptPath}`);
    promptDigest = promptDigestFromPromptMarkdown(promptMd);
    outputPath = path.join(runRoot, "synthesis", "final-synthesis.md");
    metaPath = path.join(runRoot, "synthesis", "final-synthesis.meta.json");
  }

  assertWithinRoot(runRoot, outputPath, `${stage} output`);
  if (rawOutputPath) {
    assertWithinRoot(runRoot, rawOutputPath, `${stage} raw output`);
  }
  assertWithinRoot(runRoot, metaPath, `${stage} meta sidecar`);

  const startedAt = normalizeOptional(args.startedAt);
  const finishedAt = normalizeOptional(args.finishedAt);
  const model = normalizeOptional(args.model);
  const ingestedAt = nowIso();

  const sidecar = {
    schema_version: stage === "perspectives" ? "agent-result-meta.v1" : "wave-output-meta.v1",
    prompt_digest: promptDigest,
    agent_run_id: agentRunId,
    ingested_at: ingestedAt,
    source_input_path: inputPath,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(model ? { model } : {}),
  };

  await withRunLock({
    runRoot,
    reason: `operator-cli agent-result: ${reason}`,
    fn: async () => {
      if (stage === "perspectives") {
        const outputExists = await fileExists(outputPath);
        const rawExists = rawOutputPath ? await fileExists(rawOutputPath) : false;
        const metaExists = await fileExists(metaPath);
        const normalizedInputPath = path.resolve(inputPath);
        const normalizedRawOutputPath = rawOutputPath ? path.resolve(rawOutputPath) : null;
        const inputMatchesRawOutput = rawOutputPath ? normalizedInputPath === normalizedRawOutputPath : false;

        if (!args.force && outputExists && metaExists) {
          const existingPromptDigest = await readPromptDigestFromMeta(metaPath);
          if (existingPromptDigest === promptDigest) {
            noop = true;
            return;
          }
          if (existingPromptDigest) {
            throwWithCode(
              "AGENT_RESULT_PROMPT_DIGEST_CONFLICT",
              `perspectives output/meta prompt_digest mismatch for ${perspectiveId}; use --force to overwrite`,
            );
          }
        }

        if (!args.force && outputExists) {
          throwWithCode(
            "AGENT_RESULT_META_CONFLICT",
            `perspectives output exists with missing/invalid meta for ${perspectiveId}; use --force to overwrite`,
          );
        }

        if (!args.force && (metaExists || (!inputMatchesRawOutput && rawExists))) {
          throwWithCode(
            "AGENT_RESULT_CONFLICT",
            `perspectives artifacts already exist for ${perspectiveId}; use --force to overwrite`,
          );
        }

        if (!rawOutputPath || !normalizedPerspectivesOutput) {
          throwWithCode("AGENT_RESULT_INTERNAL_ERROR", "perspectives ingest was not initialized");
        }

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        if (!inputMatchesRawOutput && !rawExists) {
          await fs.writeFile(rawOutputPath, sourceInputText, "utf8");
        }
        await fs.writeFile(outputPath, `${JSON.stringify(normalizedPerspectivesOutput, null, 2)}\n`, "utf8");
        await fs.writeFile(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
        return;
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${sourceInputText.trim()}\n`, "utf8");
      await fs.writeFile(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    },
  });

  if (args.json) {
    emitJsonV1({
      ok: true,
      command: "agent-result",
      contract: {
        run_id: summary.runId,
        run_root: runRoot,
        manifest_path: manifestPath,
        gates_path: summary.gatesPath,
        stage_current: summary.stageCurrent,
        status: summary.status,
        cli_invocation: resolveDeepResearchCliInvocation(),
      },
      result: {
        stage,
        perspective_id: perspectiveId,
        output_path: outputPath,
        meta_path: metaPath,
        ...(rawOutputPath ? { raw_output_path: rawOutputPath } : {}),
        prompt_digest: promptDigest,
        noop,
      },
      error: null,
      halt: null,
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("agent_result.ok: true");
  console.log(`agent_result.stage: ${stage}`);
  console.log(`agent_result.perspective_id: ${perspectiveId}`);
  console.log(`agent_result.output_path: ${outputPath}`);
  console.log(`agent_result.meta_path: ${metaPath}`);
  console.log(`agent_result.prompt_digest: ${promptDigest}`);
}
