import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, releaseRunLock, startRunLockHeartbeat } from "./run_lock";
import {
  type ToolWithExecute,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  nowIso,
  parseJsonSafe,
  readJson,
  sha256HexLowerUtf8,
  validateManifestV1,
} from "./lifecycle_lib";
import { citations_extract_urls } from "./citations_extract_urls";
import { citations_normalize } from "./citations_normalize";
import { citations_validate } from "./citations_validate";
import { gate_c_compute } from "./gate_c_compute";
import { gates_write } from "./gates_write";
import { pivot_decide } from "./pivot_decide";
import { stage_advance } from "./stage_advance";
import { wave_output_ingest } from "./wave_output_ingest";
import { wave_output_validate } from "./wave_output_validate";
import { manifest_write } from "./manifest_write";

type ToolJsonOk = {
  ok: true;
  [key: string]: unknown;
};

type ToolJsonFailure = {
  ok: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

type PivotWaveEntry = {
  perspective_id: string;
  output_md: string;
  output_abs_path: string;
};

type PivotGap = {
  gap_id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  text: string;
  from_perspective_id: string | null;
};

type Wave2PlanEntry = {
  gap_id: string;
  perspective_id: string;
  source_perspective_id: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
  text: string;
  agent_type: string;
  output_md: string;
  prompt_md: string;
};

export type OrchestratorTickPostPivotArgs = {
  manifest_path: string;
  gates_path: string;
  reason: string;
  stage_advance_tool?: ToolWithExecute;
  pivot_decide_tool?: ToolWithExecute;
  wave_output_ingest_tool?: ToolWithExecute;
  wave_output_validate_tool?: ToolWithExecute;
  citations_extract_urls_tool?: ToolWithExecute;
  citations_normalize_tool?: ToolWithExecute;
  citations_validate_tool?: ToolWithExecute;
  gate_c_compute_tool?: ToolWithExecute;
  gates_write_tool?: ToolWithExecute;
  tool_context?: unknown;
};

export type OrchestratorTickPostPivotSuccess = {
  ok: true;
  schema_version: "orchestrator_tick.post_pivot.v1";
  run_id: string;
  from: string;
  to: string;
  decision_inputs_digest: string | null;
  pivot_created: boolean;
  wave2_plan_path: string | null;
  wave2_outputs_count: number | null;
  citations_path: string | null;
  gate_c_status: string | null;
};

export type OrchestratorTickPostPivotFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type OrchestratorTickPostPivotResult =
  | OrchestratorTickPostPivotSuccess
  | OrchestratorTickPostPivotFailure;

function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): OrchestratorTickPostPivotFailure {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isContainedWithin(baseDir: string, targetPath: string): boolean {
  if (baseDir === targetPath) return true;
  const relative = path.relative(baseDir, targetPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLatestOnlineFixturesPath(args: {
  runRoot: string;
  runRootReal: string;
}): Promise<string | null> {
  const latestPointerPath = path.join(args.runRoot, "citations", "online-fixtures.latest.json");
  if (!(await exists(latestPointerPath))) {
    return null;
  }

  let latestPointerRaw: unknown;
  try {
    latestPointerRaw = await readJson(latestPointerPath);
  } catch {
    return null;
  }

  if (!isPlainObject(latestPointerRaw)) {
    return null;
  }

  const fixturePathRaw = nonEmptyString(latestPointerRaw.path);
  if (!fixturePathRaw) {
    return null;
  }

  const fixtureResolved = await resolveContainedPath({
    runRoot: args.runRoot,
    runRootReal: args.runRootReal,
    input: fixturePathRaw,
    field: "citations.online_fixtures_latest.path",
  });
  if (!fixtureResolved.ok) {
    return null;
  }

  if (!(await exists(fixtureResolved.absPath))) {
    return null;
  }

  return fixtureResolved.absPath;
}

async function resolveContainedPath(args: {
  runRoot: string;
  runRootReal: string;
  input: string;
  field: string;
}): Promise<{ ok: true; absPath: string } | { ok: false; reason: string; details: Record<string, unknown> }> {
  const trimmed = args.input.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: "path is empty",
      details: { field: args.field, value: args.input },
    };
  }

  const absPath = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(args.runRoot, trimmed);
  const runRootAbs = path.resolve(args.runRoot);
  if (!isContainedWithin(runRootAbs, absPath)) {
    return {
      ok: false,
      reason: "path escapes run root",
      details: {
        field: args.field,
        run_root: args.runRoot,
        value: args.input,
        resolved_path: absPath,
      },
    };
  }

  let existingPath = absPath;
  while (!(await exists(existingPath))) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      return {
        ok: false,
        reason: "path has no existing parent directory",
        details: {
          field: args.field,
          run_root: args.runRoot,
          value: args.input,
          resolved_path: absPath,
        },
      };
    }
    existingPath = parent;
  }

  let existingRealPath: string;
  try {
    existingRealPath = await fs.realpath(existingPath);
  } catch (e) {
    return {
      ok: false,
      reason: "failed to canonicalize path",
      details: {
        field: args.field,
        value: args.input,
        resolved_path: absPath,
        existing_path: existingPath,
        message: String(e),
      },
    };
  }

  if (!isContainedWithin(args.runRootReal, existingRealPath)) {
    return {
      ok: false,
      reason: "path escapes run root",
      details: {
        field: args.field,
        run_root: args.runRoot,
        run_root_real: args.runRootReal,
        value: args.input,
        resolved_path: absPath,
        existing_path: existingPath,
        existing_real_path: existingRealPath,
      },
    };
  }

  return { ok: true, absPath };
}

async function executeToolJson(args: {
  name: string;
  tool: ToolWithExecute;
  payload: Record<string, unknown>;
  tool_context?: unknown;
}): Promise<ToolJsonOk | ToolJsonFailure> {
  let raw: unknown;
  try {
    raw = await args.tool.execute(args.payload, args.tool_context);
  } catch (e) {
    return {
      ok: false,
      code: `${args.name}_THREW`,
      message: `${args.name} execution threw`,
      details: { message: String(e) },
    };
  }

  if (typeof raw !== "string") {
    return {
      ok: false,
      code: `${args.name}_INVALID_RESPONSE`,
      message: `${args.name} returned non-string response`,
      details: { response_type: typeof raw },
    };
  }

  const parsed = parseJsonSafe(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return {
      ok: false,
      code: `${args.name}_INVALID_RESPONSE`,
      message: `${args.name} returned non-JSON response`,
      details: { raw },
    };
  }

  const envelope = parsed.value as Record<string, unknown>;
  if (envelope.ok === true) {
    return {
      ok: true,
      ...envelope,
    };
  }

  const upstreamError = isPlainObject(envelope.error)
    ? (envelope.error as Record<string, unknown>)
    : null;
  const upstreamDetails = isPlainObject(upstreamError?.details)
    ? (upstreamError?.details as Record<string, unknown>)
    : {};

  return {
    ok: false,
    code: String(upstreamError?.code ?? `${args.name}_FAILED`),
    message: String(upstreamError?.message ?? `${args.name} failed`),
    details: {
      ...upstreamDetails,
      tool: args.name,
    },
  };
}

async function collectPivotWaveEntries(args: {
  runRoot: string;
  runRootReal: string;
  wave1DirPath: string;
}): Promise<{ ok: true; entries: PivotWaveEntry[] } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  const planPath = path.join(args.wave1DirPath, "wave1-plan.json");
  const planExists = await exists(planPath);

  if (planExists) {
    let planRaw: unknown;
    try {
      planRaw = await readJson(planPath);
    } catch (e) {
      if (e instanceof SyntaxError) {
        return {
          ok: false,
          code: "INVALID_JSON",
          message: "wave1 plan contains invalid JSON",
          details: { plan_path: planPath },
        };
      }
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "wave1 plan not found",
        details: { plan_path: planPath, message: String(e) },
      };
    }

    if (!isPlainObject(planRaw)) {
      return {
        ok: false,
        code: "SCHEMA_VALIDATION_FAILED",
        message: "wave1 plan must be an object",
        details: { plan_path: planPath },
      };
    }

    const entriesRaw = Array.isArray(planRaw.entries)
      ? (planRaw.entries as Array<Record<string, unknown>>)
      : [];
    if (entriesRaw.length === 0) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "wave1 plan entries missing",
        details: { plan_path: planPath },
      };
    }

    const entries: PivotWaveEntry[] = [];
    for (const [index, entryRaw] of entriesRaw.entries()) {
      if (!isPlainObject(entryRaw)) {
        return {
          ok: false,
          code: "SCHEMA_VALIDATION_FAILED",
          message: "wave1 plan entry must be object",
          details: { plan_path: planPath, index },
        };
      }

      const perspectiveId = nonEmptyString(entryRaw.perspective_id);
      const outputMd = nonEmptyString(entryRaw.output_md);
      if (!perspectiveId || !outputMd) {
        return {
          ok: false,
          code: "SCHEMA_VALIDATION_FAILED",
          message: "wave1 plan entry missing perspective_id/output_md",
          details: { plan_path: planPath, index },
        };
      }

      const outputResolved = await resolveContainedPath({
        runRoot: args.runRoot,
        runRootReal: args.runRootReal,
        input: outputMd,
        field: `wave1_plan.entries[${index}].output_md`,
      });
      if (!outputResolved.ok) {
        return {
          ok: false,
          code: "PATH_TRAVERSAL",
          message: outputResolved.reason,
          details: outputResolved.details,
        };
      }

      if (!(await exists(outputResolved.absPath))) {
        continue;
      }

      entries.push({
        perspective_id: perspectiveId,
        output_md: outputMd,
        output_abs_path: outputResolved.absPath,
      });
    }

    if (entries.length === 0) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "wave1 plan outputs missing",
        details: { plan_path: planPath },
      };
    }

    entries.sort((a, b) => a.perspective_id.localeCompare(b.perspective_id));
    return { ok: true, entries };
  }

  let waveFiles: string[];
  try {
    const dirEntries = (await fs.readdir(args.wave1DirPath, { withFileTypes: true })) as Array<{
      isFile: () => boolean;
      name: string;
    }>;
    waveFiles = dirEntries
      .filter((entry: { isFile: () => boolean; name: string }) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry: { name: string }) => entry.name)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (e) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "wave-1 directory missing",
      details: { wave1_dir: args.wave1DirPath, message: String(e) },
    };
  }

  if (waveFiles.length === 0) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "no wave-1 markdown outputs available",
      details: { wave1_dir: args.wave1DirPath },
    };
  }

  const entries: PivotWaveEntry[] = waveFiles.map((fileName) => {
    const outputAbsPath = path.join(args.wave1DirPath, fileName);
    const perspectiveId = path.basename(fileName, ".md");
    const outputMd = toPosixPath(path.relative(args.runRoot, outputAbsPath));
    return {
      perspective_id: perspectiveId,
      output_md: outputMd,
      output_abs_path: outputAbsPath,
    };
  });

  return { ok: true, entries };
}

function normalizeGapId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === "..") return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

function normalizeGapPriority(value: unknown): "P0" | "P1" | "P2" | "P3" | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "P0" || trimmed === "P1" || trimmed === "P2" || trimmed === "P3"
    ? trimmed
    : null;
}

type ParsedPivotDecision = {
  wave2_required: boolean;
  wave2_gap_ids: string[];
  gaps_by_id: Map<string, PivotGap>;
};

async function readPivotDecision(args: {
  pivotPath: string;
}): Promise<{ ok: true; pivot: ParsedPivotDecision } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  let pivotRaw: unknown;
  try {
    pivotRaw = await readJson(args.pivotPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        ok: false,
        code: "INVALID_JSON",
        message: "pivot.json contains invalid JSON",
        details: { pivot_path: args.pivotPath },
      };
    }
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "pivot.json missing",
      details: { pivot_path: args.pivotPath, message: String(e) },
    };
  }

  if (!isPlainObject(pivotRaw)) {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "pivot.json must be an object",
      details: { pivot_path: args.pivotPath },
    };
  }

  const pivotObj = pivotRaw as Record<string, unknown>;
  const decisionObj = isPlainObject(pivotObj.decision)
    ? (pivotObj.decision as Record<string, unknown>)
    : null;
  if (!decisionObj) {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "pivot decision missing",
      details: { pivot_path: args.pivotPath },
    };
  }

  const wave2Required = decisionObj.wave2_required;
  if (typeof wave2Required !== "boolean") {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "pivot decision wave2_required must be boolean",
      details: { pivot_path: args.pivotPath },
    };
  }

  const wave2GapIdsRaw = Array.isArray(decisionObj.wave2_gap_ids)
    ? (decisionObj.wave2_gap_ids as unknown[])
    : null;
  if (!wave2GapIdsRaw) {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "pivot decision wave2_gap_ids must be array",
      details: { pivot_path: args.pivotPath },
    };
  }

  const normalizedWave2GapIds: string[] = [];
  for (const [index, gapIdRaw] of wave2GapIdsRaw.entries()) {
    const gapId = normalizeGapId(gapIdRaw);
    if (!gapId) {
      return {
        ok: false,
        code: "PATH_TRAVERSAL",
        message: "pivot decision contains unsafe wave2 gap id",
        details: {
          pivot_path: args.pivotPath,
          index,
          gap_id: gapIdRaw ?? null,
        },
      };
    }
    normalizedWave2GapIds.push(gapId);
  }

  const gapIdSet = new Set<string>();
  const dedupWave2GapIds: string[] = [];
  for (const gapId of normalizedWave2GapIds) {
    if (gapIdSet.has(gapId)) continue;
    gapIdSet.add(gapId);
    dedupWave2GapIds.push(gapId);
  }

  const gapsById = new Map<string, PivotGap>();
  const gapsRaw = Array.isArray(pivotObj.gaps)
    ? (pivotObj.gaps as Array<Record<string, unknown>>)
    : [];

  for (const [index, gapRaw] of gapsRaw.entries()) {
    if (!isPlainObject(gapRaw)) {
      return {
        ok: false,
        code: "SCHEMA_VALIDATION_FAILED",
        message: "pivot gap entry must be object",
        details: {
          pivot_path: args.pivotPath,
          index,
        },
      };
    }

    const gapId = normalizeGapId(gapRaw.gap_id);
    const priority = normalizeGapPriority(gapRaw.priority);
    const text = nonEmptyString(gapRaw.text);
    const fromPerspectiveId = nonEmptyString(gapRaw.from_perspective_id);

    if (!gapId || !priority || !text) {
      return {
        ok: false,
        code: "SCHEMA_VALIDATION_FAILED",
        message: "pivot gap entry is missing required fields",
        details: {
          pivot_path: args.pivotPath,
          index,
        },
      };
    }

    if (!gapsById.has(gapId)) {
      gapsById.set(gapId, {
        gap_id: gapId,
        priority,
        text,
        from_perspective_id: fromPerspectiveId,
      });
    }
  }

  return {
    ok: true,
    pivot: {
      wave2_required: wave2Required,
      wave2_gap_ids: dedupWave2GapIds,
      gaps_by_id: gapsById,
    },
  };
}

function buildWave2PromptMd(args: {
  queryText: string;
  gap: PivotGap;
}): string {
  return [
    "## Query",
    args.queryText,
    "",
    "## Wave 2 Gap Focus",
    `- gap_id: ${args.gap.gap_id}`,
    `- priority: ${args.gap.priority}`,
    `- source_perspective_id: ${args.gap.from_perspective_id ?? "n/a"}`,
    `- gap_text: ${args.gap.text}`,
    "",
    "## Contract",
    "- Address the gap with concrete follow-up findings.",
    "- Include at least one source URL bullet.",
    "- Preserve deterministic section headings: Findings, Sources, Gaps.",
    "",
  ].join("\n");
}

function buildWave2Markdown(args: { gap: PivotGap }): string {
  return [
    "## Findings",
    `Wave 2 follow-up for ${args.gap.gap_id}: ${args.gap.text}`,
    "",
    "## Sources",
    `- https://example.com/wave2/${encodeURIComponent(args.gap.gap_id)}`,
    "",
    "## Gaps",
    "No additional unresolved gaps identified for this follow-up.",
    "",
  ].join("\n");
}

async function readPerspectiveAgentTypes(
  perspectivesPath: string,
): Promise<{ ok: true; agents: Map<string, string> } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  let perspectivesRaw: unknown;
  try {
    perspectivesRaw = await readJson(perspectivesPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        ok: false,
        code: "INVALID_JSON",
        message: "perspectives.json contains invalid JSON",
        details: { perspectives_path: perspectivesPath },
      };
    }
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "perspectives.json missing",
      details: { perspectives_path: perspectivesPath, message: String(e) },
    };
  }

  if (!isPlainObject(perspectivesRaw)) {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "perspectives.json must be object",
      details: { perspectives_path: perspectivesPath },
    };
  }

  const doc = perspectivesRaw as Record<string, unknown>;
  const perspectives = Array.isArray(doc.perspectives)
    ? (doc.perspectives as Array<Record<string, unknown>>)
    : [];

  const agents = new Map<string, string>();
  for (const perspectiveRaw of perspectives) {
    if (!isPlainObject(perspectiveRaw)) continue;
    const id = nonEmptyString(perspectiveRaw.id);
    const agentType = nonEmptyString(perspectiveRaw.agent_type);
    if (!id || !agentType) continue;
    if (!agents.has(id)) agents.set(id, agentType);
  }

  return { ok: true, agents };
}

function deriveWave2Plan(args: {
  runId: string;
  runRoot: string;
  wave2DirPath: string;
  maxWave2Agents: number;
  queryText: string;
  pivot: ParsedPivotDecision;
  perspectiveAgents: Map<string, string>;
}):
  | {
    ok: true;
    plan: {
      schema_version: "wave2_plan.v1";
      run_id: string;
      generated_at: string;
      inputs_digest: string;
      entries: Wave2PlanEntry[];
    };
  }
  | { ok: false; code: string; message: string; details: Record<string, unknown> } {
  const cap = Number.isFinite(args.maxWave2Agents)
    ? Math.max(0, Math.trunc(args.maxWave2Agents))
    : 0;
  const count = args.pivot.wave2_gap_ids.length;
  if (count > cap) {
    return {
      ok: false,
      code: "WAVE_CAP_EXCEEDED",
      message: "wave2 gap ids exceed manifest limit",
      details: { cap, count, stage: "wave2" },
    };
  }

  if (count === 0) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "wave2 stage requires non-empty wave2_gap_ids",
      details: { stage: "wave2" },
    };
  }

  const runRootAbs = path.resolve(args.runRoot);
  const entries: Wave2PlanEntry[] = [];
  for (const gapId of [...args.pivot.wave2_gap_ids].sort((a, b) => a.localeCompare(b))) {
    const normalizedGapId = normalizeGapId(gapId);
    if (!normalizedGapId) {
      return {
        ok: false,
        code: "PATH_TRAVERSAL",
        message: "wave2 gap id is unsafe",
        details: { gap_id: gapId },
      };
    }

    const gap = args.pivot.gaps_by_id.get(normalizedGapId) ?? {
      gap_id: normalizedGapId,
      priority: "P2" as const,
      text: `Follow-up needed for ${normalizedGapId}`,
      from_perspective_id: null,
    };

    const outputAbsPath = path.join(args.wave2DirPath, `${normalizedGapId}.md`);
    if (!isContainedWithin(runRootAbs, outputAbsPath)) {
      return {
        ok: false,
        code: "PATH_TRAVERSAL",
        message: "wave2 output path escapes run root",
        details: {
          gap_id: normalizedGapId,
          output_path: outputAbsPath,
          run_root: args.runRoot,
        },
      };
    }

    const outputMd = toPosixPath(path.relative(args.runRoot, outputAbsPath));
    entries.push({
      gap_id: normalizedGapId,
      perspective_id: normalizedGapId,
      source_perspective_id: gap.from_perspective_id,
      priority: gap.priority,
      text: gap.text,
      agent_type: gap.from_perspective_id
        ? (args.perspectiveAgents.get(gap.from_perspective_id) ?? "researcher")
        : "researcher",
      output_md: outputMd,
      prompt_md: buildWave2PromptMd({
        queryText: args.queryText,
        gap,
      }),
    });
  }

  const digestPayload = {
    schema: "wave2_plan.inputs.v1",
    run_id: args.runId,
    query_text: args.queryText,
    max_wave2_agents: cap,
    wave2_gap_ids: entries.map((entry) => entry.gap_id),
    entries: entries.map((entry) => ({
      gap_id: entry.gap_id,
      perspective_id: entry.perspective_id,
      source_perspective_id: entry.source_perspective_id,
      priority: entry.priority,
      text: entry.text,
      agent_type: entry.agent_type,
      output_md: entry.output_md,
    })),
  };

  const inputsDigest = `sha256:${sha256HexLowerUtf8(JSON.stringify(digestPayload))}`;
  const generatedAt = nowIso();
  return {
    ok: true,
    plan: {
      schema_version: "wave2_plan.v1",
      run_id: args.runId,
      generated_at: generatedAt,
      inputs_digest: inputsDigest,
      entries,
    },
  };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<{ ok: true } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: "failed to write JSON artifact",
      details: {
        file_path: filePath,
        message: String(e),
      },
    };
  }
}

async function executeWave2Stage(args: {
  manifestPath: string;
  runId: string;
  runRoot: string;
  runRootReal: string;
  manifest: Record<string, unknown>;
  perspectivesPath: string;
  wave2DirPath: string;
  pivotPath: string;
  reason: string;
  waveOutputIngestTool: ToolWithExecute;
  waveOutputValidateTool: ToolWithExecute;
  markProgress?: (checkpoint: string) => Promise<{ ok: true } | { ok: false; code: string; message: string; details: Record<string, unknown> }>;
  tool_context?: unknown;
}): Promise<{ ok: true; plan_path: string; outputs_count: number } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  const pivot = await readPivotDecision({ pivotPath: args.pivotPath });
  if (!pivot.ok) return pivot;

  if (!pivot.pivot.wave2_required) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "wave2 stage reached while pivot decision skips wave2",
      details: {
        pivot_path: args.pivotPath,
      },
    };
  }

  const perspectiveAgentsResult = await readPerspectiveAgentTypes(args.perspectivesPath);
  if (!perspectiveAgentsResult.ok) return perspectiveAgentsResult;

  const queryObj = isPlainObject(args.manifest.query)
    ? (args.manifest.query as Record<string, unknown>)
    : {};
  const queryText = nonEmptyString(queryObj.text) ?? "";
  const limitsObj = isPlainObject(args.manifest.limits)
    ? (args.manifest.limits as Record<string, unknown>)
    : {};
  const maxWave2AgentsRaw = Number(limitsObj.max_wave2_agents ?? Number.NaN);
  if (!Number.isFinite(maxWave2AgentsRaw) || Math.trunc(maxWave2AgentsRaw) < 0) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "manifest.limits.max_wave2_agents invalid",
      details: {
        value: limitsObj.max_wave2_agents ?? null,
      },
    };
  }

  const planResult = deriveWave2Plan({
    runId: args.runId,
    runRoot: args.runRoot,
    wave2DirPath: args.wave2DirPath,
    maxWave2Agents: maxWave2AgentsRaw,
    queryText,
    pivot: pivot.pivot,
    perspectiveAgents: perspectiveAgentsResult.agents,
  });
  if (!planResult.ok) return planResult;

  const planPath = path.join(args.wave2DirPath, "wave2-plan.json");
  const planPathResolved = await resolveContainedPath({
    runRoot: args.runRoot,
    runRootReal: args.runRootReal,
    input: planPath,
    field: "manifest.artifacts.paths.wave2_plan_file",
  });
  if (!planPathResolved.ok) {
    return {
      ok: false,
      code: "PATH_TRAVERSAL",
      message: planPathResolved.reason,
      details: planPathResolved.details,
    };
  }

  const planWrite = await writeJsonFile(planPathResolved.absPath, planResult.plan);
  if (!planWrite.ok) return planWrite;

  const wave2PerspectivesPath = path.join(args.wave2DirPath, "wave2-perspectives.json");
  const wave2PerspectivesResolved = await resolveContainedPath({
    runRoot: args.runRoot,
    runRootReal: args.runRootReal,
    input: wave2PerspectivesPath,
    field: "manifest.artifacts.paths.wave2_perspectives_file",
  });
  if (!wave2PerspectivesResolved.ok) {
    return {
      ok: false,
      code: "PATH_TRAVERSAL",
      message: wave2PerspectivesResolved.reason,
      details: wave2PerspectivesResolved.details,
    };
  }

  const wave2PerspectivesDoc = {
    schema_version: "perspectives.v1",
    run_id: args.runId,
    created_at: planResult.plan.generated_at,
    perspectives: planResult.plan.entries.map((entry) => ({
      id: entry.perspective_id,
      title: `Wave 2 gap ${entry.gap_id}`,
      track: "independent",
      agent_type: entry.agent_type,
      prompt_contract: {
        max_words: 500,
        max_sources: 8,
        tool_budget: {
          search_calls: 0,
          fetch_calls: 0,
        },
        must_include_sections: ["Findings", "Sources", "Gaps"],
      },
    })),
  };

  const perspectivesWrite = await writeJsonFile(wave2PerspectivesResolved.absPath, wave2PerspectivesDoc);
  if (!perspectivesWrite.ok) return perspectivesWrite;

  const outputsForIngest = planResult.plan.entries.map((entry) => ({
    perspective_id: entry.perspective_id,
    markdown: buildWave2Markdown({
      gap: {
        gap_id: entry.gap_id,
        priority: entry.priority,
        text: entry.text,
        from_perspective_id: entry.source_perspective_id,
      },
    }),
    agent_type: entry.agent_type,
    prompt_md: entry.prompt_md,
  }));

  const ingest = await executeToolJson({
    name: "WAVE_OUTPUT_INGEST",
    tool: args.waveOutputIngestTool,
    payload: {
      manifest_path: args.manifestPath,
      perspectives_path: wave2PerspectivesResolved.absPath,
      wave: "wave2",
      outputs: outputsForIngest,
    },
    tool_context: args.tool_context,
  });
  if (!ingest.ok) {
    return {
      ok: false,
      code: ingest.code,
      message: ingest.message,
      details: ingest.details,
    };
  }

  for (const [index, entry] of planResult.plan.entries.entries()) {
    const markdownResolved = await resolveContainedPath({
      runRoot: args.runRoot,
      runRootReal: args.runRootReal,
      input: entry.output_md,
      field: `wave2_plan.entries[${index}].output_md`,
    });
    if (!markdownResolved.ok) {
      return {
        ok: false,
        code: "PATH_TRAVERSAL",
        message: markdownResolved.reason,
        details: markdownResolved.details,
      };
    }

    const validate = await executeToolJson({
      name: "WAVE_OUTPUT_VALIDATE",
      tool: args.waveOutputValidateTool,
      payload: {
        perspectives_path: wave2PerspectivesResolved.absPath,
        perspective_id: entry.perspective_id,
        markdown_path: markdownResolved.absPath,
      },
      tool_context: args.tool_context,
    });
    if (!validate.ok) {
      return {
        ok: false,
        code: validate.code,
        message: validate.message,
        details: {
          ...validate.details,
          perspective_id: entry.perspective_id,
          markdown_path: markdownResolved.absPath,
        },
      };
    }

    if (args.markProgress) {
      const progress = await args.markProgress(`wave2_output_ingested:${entry.perspective_id}`);
      if (!progress.ok) {
        return {
          ok: false,
          code: progress.code,
          message: progress.message,
          details: {
            ...progress.details,
            perspective_id: entry.perspective_id,
            checkpoint: "wave2_output_ingested",
          },
        };
      }
    }
  }

  return {
    ok: true,
    plan_path: planPathResolved.absPath,
    outputs_count: planResult.plan.entries.length,
  };
}

async function writeDeterministicCitationFixtures(args: {
  urlMapPath: string;
  fixturesPath: string;
}): Promise<{ ok: true; fixtures_count: number } | { ok: false; code: string; message: string; details: Record<string, unknown> }> {
  let urlMapRaw: unknown;
  try {
    urlMapRaw = await readJson(args.urlMapPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        ok: false,
        code: "INVALID_JSON",
        message: "url-map.json contains invalid JSON",
        details: { url_map_path: args.urlMapPath },
      };
    }
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "url-map.json missing",
      details: { url_map_path: args.urlMapPath, message: String(e) },
    };
  }

  if (!isPlainObject(urlMapRaw)) {
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: "url-map.json must be an object",
      details: { url_map_path: args.urlMapPath },
    };
  }

  const itemsRaw = Array.isArray(urlMapRaw.items)
    ? (urlMapRaw.items as Array<Record<string, unknown>>)
    : [];
  const normalizedUrls = Array.from(
    new Set(
      itemsRaw
        .map((item) => nonEmptyString(item.normalized_url))
        .filter((value): value is string => value !== null),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const fixtures = {
    items: normalizedUrls.map((normalizedUrl) => ({
      normalized_url: normalizedUrl,
      status: "valid",
      notes: "deterministic orchestrator fixture",
    })),
  };

  try {
    await fs.mkdir(path.dirname(args.fixturesPath), { recursive: true });
    await fs.writeFile(args.fixturesPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
  } catch (e) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: "failed to write citation fixtures",
      details: {
        fixtures_path: args.fixturesPath,
        message: String(e),
      },
    };
  }

  return {
    ok: true,
    fixtures_count: normalizedUrls.length,
  };
}

export async function orchestrator_tick_post_pivot(
  args: OrchestratorTickPostPivotArgs,
): Promise<OrchestratorTickPostPivotResult> {
  const manifestPath = args.manifest_path.trim();
  const gatesPath = args.gates_path.trim();
  const reason = args.reason.trim();

  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    return fail("INVALID_ARGS", "manifest_path must be absolute", {
      manifest_path: args.manifest_path,
    });
  }
  if (!gatesPath || !path.isAbsolute(gatesPath)) {
    return fail("INVALID_ARGS", "gates_path must be absolute", {
      gates_path: args.gates_path,
    });
  }
  if (!reason) return fail("INVALID_ARGS", "reason must be non-empty");

  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(manifestPath);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return fail("INVALID_JSON", "manifest_path contains invalid JSON", {
        manifest_path: manifestPath,
      });
    }
    return fail("NOT_FOUND", "manifest_path not found", {
      manifest_path: manifestPath,
      message: String(e),
    });
  }

  const manifestValidation = validateManifestV1(manifestRaw);
  if (manifestValidation) {
    return fail("SCHEMA_VALIDATION_FAILED", "manifest validation failed", {
      manifest_path: manifestPath,
      error: manifestValidation,
    });
  }

  const manifest = manifestRaw as Record<string, unknown>;
  const runId = String(manifest.run_id ?? "").trim();
  let manifestRevision = Number(manifest.revision ?? Number.NaN);
  const stageObj = isPlainObject(manifest.stage)
    ? (manifest.stage as Record<string, unknown>)
    : {};
  const queryObj = isPlainObject(manifest.query)
    ? (manifest.query as Record<string, unknown>)
    : {};
  const from = String(stageObj.current ?? "").trim();
  const sensitivity = String(queryObj.sensitivity ?? "normal").trim();
  const runOnlineValidation = sensitivity !== "no_web";
  const status = String(manifest.status ?? "").trim();
  const artifacts = getManifestArtifacts(manifest);
  const runRoot = String(
    (artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath),
  );

  if (!runId) {
    return fail("INVALID_STATE", "manifest.run_id missing", {
      manifest_path: manifestPath,
    });
  }
  if (!Number.isFinite(manifestRevision)) {
    return fail("INVALID_STATE", "manifest.revision invalid", {
      manifest_path: manifestPath,
      revision: manifest.revision ?? null,
    });
  }
  if (!from) {
    return fail("INVALID_STATE", "manifest.stage.current missing", {
      manifest_path: manifestPath,
    });
  }
  if (status === "paused") {
    return fail("PAUSED", "run is paused", {
      manifest_path: manifestPath,
      run_id: runId,
      stage: from,
    });
  }
  if (status === "cancelled") {
    return fail("CANCELLED", "run is cancelled", {
      manifest_path: manifestPath,
      run_id: runId,
      stage: from,
    });
  }
  if (!runRoot || !path.isAbsolute(runRoot)) {
    return fail("INVALID_STATE", "manifest.artifacts.root invalid", {
      manifest_path: manifestPath,
      root: runRoot,
    });
  }

  let runRootReal: string;
  try {
    runRootReal = await fs.realpath(runRoot);
  } catch (e) {
    return fail("INVALID_STATE", "manifest.artifacts.root must resolve to an existing directory", {
      manifest_path: manifestPath,
      root: runRoot,
      message: String(e),
    });
  }

  const lockResult = await acquireRunLock({
    run_root: runRoot,
    lease_seconds: 120,
    reason: `orchestrator_tick_post_pivot: ${reason}`,
  });
  if (!lockResult.ok) {
    return fail(lockResult.code, lockResult.message, lockResult.details);
  }
  const runLockHandle = lockResult.handle;
  const heartbeat = startRunLockHeartbeat({
    handle: runLockHandle,
    interval_ms: 30_000,
    lease_seconds: 120,
  });

  try {

  if (from === "summaries") {
    return {
      ok: true,
      schema_version: "orchestrator_tick.post_pivot.v1",
      run_id: runId,
      from,
      to: "summaries",
      decision_inputs_digest: null,
      pivot_created: false,
      wave2_plan_path: null,
      wave2_outputs_count: null,
      citations_path: null,
      gate_c_status: null,
    };
  }

  if (from !== "pivot" && from !== "wave2" && from !== "citations") {
    return fail("INVALID_STATE", "post-pivot tick only supports pivot|wave2|citations|summaries stages", {
      from,
    });
  }

  const pathsObj = getManifestPaths(manifest);
  const perspectivesResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.perspectives_file ?? "perspectives.json"),
    field: "manifest.artifacts.paths.perspectives_file",
  });
  if (!perspectivesResolved.ok) {
    return fail("PATH_TRAVERSAL", perspectivesResolved.reason, perspectivesResolved.details);
  }
  const perspectivesPath = perspectivesResolved.absPath;

  const wave1DirResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.wave1_dir ?? "wave-1"),
    field: "manifest.artifacts.paths.wave1_dir",
  });
  if (!wave1DirResolved.ok) {
    return fail("PATH_TRAVERSAL", wave1DirResolved.reason, wave1DirResolved.details);
  }
  const wave1DirPath = wave1DirResolved.absPath;

  const wave2DirResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.wave2_dir ?? "wave-2"),
    field: "manifest.artifacts.paths.wave2_dir",
  });
  if (!wave2DirResolved.ok) {
    return fail("PATH_TRAVERSAL", wave2DirResolved.reason, wave2DirResolved.details);
  }
  const wave2DirPath = wave2DirResolved.absPath;

  const pivotResolved = await resolveContainedPath({
    runRoot,
    runRootReal,
    input: String(pathsObj.pivot_file ?? "pivot.json"),
    field: "manifest.artifacts.paths.pivot_file",
  });
  if (!pivotResolved.ok) {
    return fail("PATH_TRAVERSAL", pivotResolved.reason, pivotResolved.details);
  }
  const pivotPath = pivotResolved.absPath;

  const stageAdvanceTool = args.stage_advance_tool ?? (stage_advance as unknown as ToolWithExecute);
  const pivotDecideTool = args.pivot_decide_tool ?? (pivot_decide as unknown as ToolWithExecute);
  const waveOutputIngestTool = args.wave_output_ingest_tool ?? (wave_output_ingest as unknown as ToolWithExecute);
  const waveOutputValidateTool = args.wave_output_validate_tool ?? (wave_output_validate as unknown as ToolWithExecute);
  const citationsExtractUrlsTool = args.citations_extract_urls_tool ?? (citations_extract_urls as unknown as ToolWithExecute);
  const citationsNormalizeTool = args.citations_normalize_tool ?? (citations_normalize as unknown as ToolWithExecute);
  const citationsValidateTool = args.citations_validate_tool ?? (citations_validate as unknown as ToolWithExecute);
  const gateCComputeTool = args.gate_c_compute_tool ?? (gate_c_compute as unknown as ToolWithExecute);
  const gatesWriteTool = args.gates_write_tool ?? (gates_write as unknown as ToolWithExecute);
  const manifestWriteTool = manifest_write as unknown as ToolWithExecute;

  const requiredTools: Array<{ name: string; tool: ToolWithExecute }> = [
    { name: "STAGE_ADVANCE", tool: stageAdvanceTool },
    { name: "PIVOT_DECIDE", tool: pivotDecideTool },
    { name: "WAVE_OUTPUT_INGEST", tool: waveOutputIngestTool },
    { name: "WAVE_OUTPUT_VALIDATE", tool: waveOutputValidateTool },
    { name: "CITATIONS_EXTRACT_URLS", tool: citationsExtractUrlsTool },
    { name: "CITATIONS_NORMALIZE", tool: citationsNormalizeTool },
    { name: "CITATIONS_VALIDATE", tool: citationsValidateTool },
    { name: "GATE_C_COMPUTE", tool: gateCComputeTool },
    { name: "GATES_WRITE", tool: gatesWriteTool },
    { name: "MANIFEST_WRITE", tool: manifestWriteTool },
  ];

  for (const requiredTool of requiredTools) {
    if (!requiredTool.tool || typeof requiredTool.tool.execute !== "function") {
      return fail("INVALID_ARGS", `${requiredTool.name.toLowerCase()} tool.execute missing`);
    }
  }

  const runStageAdvance = async (
    requestedNext?: string,
  ): Promise<ToolJsonOk | ToolJsonFailure> => {
    const payload: Record<string, unknown> = {
      manifest_path: manifestPath,
      gates_path: gatesPath,
      expected_manifest_revision: manifestRevision,
      reason,
    };
    if (requestedNext) payload.requested_next = requestedNext;
    return executeToolJson({
      name: "STAGE_ADVANCE",
      tool: stageAdvanceTool,
      payload,
      tool_context: args.tool_context,
    });
  };

  const syncManifestRevision = (
    stageAdvanceResult: ToolJsonOk,
  ): OrchestratorTickPostPivotFailure | null => {
    const nextRevision = Number(stageAdvanceResult.manifest_revision ?? Number.NaN);
    if (!Number.isFinite(nextRevision)) {
      return fail("INVALID_STATE", "stage_advance returned invalid manifest_revision", {
        manifest_revision: stageAdvanceResult.manifest_revision ?? null,
      });
    }
    manifestRevision = nextRevision;
    return null;
  };

  const markProgress = async (
    checkpoint: string,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string; details: Record<string, unknown> }> => {
    const progress = await executeToolJson({
      name: "MANIFEST_WRITE",
      tool: manifestWriteTool,
      payload: {
        manifest_path: manifestPath,
        patch: {
          stage: {
            last_progress_at: nowIso(),
          },
        },
        expected_revision: manifestRevision,
        reason: `${reason} [progress:${checkpoint}]`,
      },
      tool_context: args.tool_context,
    });

    if (!progress.ok) {
      return {
        ok: false,
        code: progress.code,
        message: progress.message,
        details: progress.details,
      };
    }

    const nextRevision = Number(progress.new_revision ?? Number.NaN);
    if (!Number.isFinite(nextRevision)) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "manifest_write returned invalid new_revision",
        details: {
          new_revision: progress.new_revision ?? null,
        },
      };
    }

    manifestRevision = nextRevision;
    return { ok: true };
  };

  let pivotCreated = false;

  if (from === "pivot") {
    if (!(await exists(pivotPath))) {
      const waveEntries = await collectPivotWaveEntries({
        runRoot,
        runRootReal,
        wave1DirPath,
      });
      if (!waveEntries.ok) {
        return fail(waveEntries.code, waveEntries.message, waveEntries.details);
      }

      const wave1Outputs: Array<{ perspective_id: string; output_md_path: string }> = [];
      const wave1ValidationReports: Array<Record<string, unknown>> = [];
      for (const entry of waveEntries.entries) {
        const validate = await executeToolJson({
          name: "WAVE_OUTPUT_VALIDATE",
          tool: waveOutputValidateTool,
          payload: {
            perspectives_path: perspectivesPath,
            perspective_id: entry.perspective_id,
            markdown_path: entry.output_abs_path,
          },
          tool_context: args.tool_context,
        });
        if (!validate.ok) {
          return fail(validate.code, validate.message, {
            ...validate.details,
            perspective_id: entry.perspective_id,
            markdown_path: entry.output_abs_path,
          });
        }

        wave1Outputs.push({
          perspective_id: entry.perspective_id,
          output_md_path: entry.output_md,
        });
        wave1ValidationReports.push({
          ok: true,
          perspective_id: entry.perspective_id,
          markdown_path: entry.output_abs_path,
          words: Number(validate.words ?? 0),
          sources: Number(validate.sources ?? 0),
          missing_sections: Array.isArray(validate.missing_sections) ? validate.missing_sections : [],
        });
      }

      const pivotResult = await executeToolJson({
        name: "PIVOT_DECIDE",
        tool: pivotDecideTool,
        payload: {
          manifest_path: manifestPath,
          wave1_outputs: wave1Outputs,
          wave1_validation_reports: wave1ValidationReports,
          reason,
        },
        tool_context: args.tool_context,
      });
      if (!pivotResult.ok) {
        return fail(pivotResult.code, pivotResult.message, pivotResult.details);
      }

      if (!(await exists(pivotPath))) {
        return fail("INVALID_STATE", "pivot_decide did not produce pivot.json", {
          pivot_path: pivotPath,
          returned_pivot_path: pivotResult.pivot_path ?? null,
        });
      }

      pivotCreated = true;
    }

    const advanceFromPivot = await runStageAdvance();
    if (!advanceFromPivot.ok) {
      return fail(advanceFromPivot.code, advanceFromPivot.message, {
        ...advanceFromPivot.details,
        from,
      });
    }

    const revisionSyncError = syncManifestRevision(advanceFromPivot);
    if (revisionSyncError) return revisionSyncError;

    const to = String(advanceFromPivot.to ?? "").trim();
    if (to !== "wave2" && to !== "citations") {
      return fail("INVALID_STATE", "pivot stage must transition to wave2 or citations", {
        from,
        to,
      });
    }

    const decisionObj = isPlainObject(advanceFromPivot.decision)
      ? (advanceFromPivot.decision as Record<string, unknown>)
      : null;
    const decisionInputsDigest =
      decisionObj && typeof decisionObj.inputs_digest === "string"
        ? decisionObj.inputs_digest
        : null;

    return {
      ok: true,
      schema_version: "orchestrator_tick.post_pivot.v1",
      run_id: runId,
      from,
      to,
      decision_inputs_digest: decisionInputsDigest,
      pivot_created: pivotCreated,
      wave2_plan_path: null,
      wave2_outputs_count: null,
      citations_path: null,
      gate_c_status: null,
    };
  }

  if (from === "wave2") {
    const wave2 = await executeWave2Stage({
      manifestPath,
      runId,
      runRoot,
      runRootReal,
      manifest,
      perspectivesPath,
      wave2DirPath,
      pivotPath,
      reason,
      waveOutputIngestTool,
      waveOutputValidateTool,
      markProgress,
      tool_context: args.tool_context,
    });
    if (!wave2.ok) {
      return fail(wave2.code, wave2.message, wave2.details);
    }

    const advanceToCitations = await runStageAdvance("citations");
    if (!advanceToCitations.ok) {
      return fail(advanceToCitations.code, advanceToCitations.message, {
        ...advanceToCitations.details,
        from,
        requested_next: "citations",
      });
    }

    const revisionSyncError = syncManifestRevision(advanceToCitations);
    if (revisionSyncError) return revisionSyncError;

    const to = String(advanceToCitations.to ?? "").trim();
    const decisionObj = isPlainObject(advanceToCitations.decision)
      ? (advanceToCitations.decision as Record<string, unknown>)
      : null;
    const decisionInputsDigest =
      decisionObj && typeof decisionObj.inputs_digest === "string"
        ? decisionObj.inputs_digest
        : null;

    return {
      ok: true,
      schema_version: "orchestrator_tick.post_pivot.v1",
      run_id: runId,
      from,
      to,
      decision_inputs_digest: decisionInputsDigest,
      pivot_created: false,
      wave2_plan_path: wave2.plan_path,
      wave2_outputs_count: wave2.outputs_count,
      citations_path: null,
      gate_c_status: null,
    };
  }

  const extract = await executeToolJson({
    name: "CITATIONS_EXTRACT_URLS",
    tool: citationsExtractUrlsTool,
    payload: {
      manifest_path: manifestPath,
      include_wave2: true,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!extract.ok) {
    return fail(extract.code, extract.message, extract.details);
  }

  const normalize = await executeToolJson({
    name: "CITATIONS_NORMALIZE",
    tool: citationsNormalizeTool,
    payload: {
      manifest_path: manifestPath,
      extracted_urls_path: extract.extracted_urls_path,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!normalize.ok) {
    return fail(normalize.code, normalize.message, normalize.details);
  }

  const urlMapPath = nonEmptyString(normalize.url_map_path);
  if (!urlMapPath || !path.isAbsolute(urlMapPath)) {
    return fail("INVALID_STATE", "citations_normalize returned invalid url_map_path", {
      url_map_path: normalize.url_map_path ?? null,
    });
  }

  const citationsValidatePayload: Record<string, unknown> = {
    manifest_path: manifestPath,
    url_map_path: urlMapPath,
    reason,
  };

  if (!runOnlineValidation) {
    const offlineFixturesPath = path.join(runRoot, "citations", "offline-fixtures.orchestrator.json");
    const fixturesResult = await writeDeterministicCitationFixtures({
      urlMapPath,
      fixturesPath: offlineFixturesPath,
    });
    if (!fixturesResult.ok) {
      return fail(fixturesResult.code, fixturesResult.message, fixturesResult.details);
    }
    citationsValidatePayload.offline_fixtures_path = offlineFixturesPath;
  } else {
    const latestOnlineFixturesPath = await resolveLatestOnlineFixturesPath({
      runRoot,
      runRootReal,
    });
    if (latestOnlineFixturesPath) {
      citationsValidatePayload.online_fixtures_path = latestOnlineFixturesPath;
    }
  }

  const validate = await executeToolJson({
    name: "CITATIONS_VALIDATE",
    tool: citationsValidateTool,
    payload: citationsValidatePayload,
    tool_context: args.tool_context,
  });
  if (!validate.ok) {
    return fail(validate.code, validate.message, validate.details);
  }

  const citationsProgress = await markProgress("citations_validated");
  if (!citationsProgress.ok) {
    return fail(citationsProgress.code, citationsProgress.message, {
      ...citationsProgress.details,
      checkpoint: "citations_validated",
    });
  }

  const citationsPath = nonEmptyString(validate.citations_path);
  if (!citationsPath || !path.isAbsolute(citationsPath)) {
    return fail("INVALID_STATE", "citations_validate returned invalid citations_path", {
      citations_path: validate.citations_path ?? null,
    });
  }

  const gateC = await executeToolJson({
    name: "GATE_C_COMPUTE",
    tool: gateCComputeTool,
    payload: {
      manifest_path: manifestPath,
      citations_path: citationsPath,
      extracted_urls_path: extract.extracted_urls_path,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!gateC.ok) {
    return fail(gateC.code, gateC.message, gateC.details);
  }

  const gateCUpdate = isPlainObject(gateC.update)
    ? (gateC.update as Record<string, unknown>)
    : null;
  const gateCInputsDigest = nonEmptyString(gateC.inputs_digest);
  if (!gateCUpdate || !gateCInputsDigest) {
    return fail("INVALID_STATE", "gate_c_compute returned incomplete gate patch", {
      update: gateC.update ?? null,
      inputs_digest: gateC.inputs_digest ?? null,
    });
  }

  let gatesRevision: number;
  try {
    const gatesDoc = await readJson(gatesPath);
    if (!isPlainObject(gatesDoc)) {
      return fail("SCHEMA_VALIDATION_FAILED", "gates document must be object", {
        gates_path: gatesPath,
      });
    }
    const revisionRaw = Number(gatesDoc.revision ?? Number.NaN);
    if (!Number.isFinite(revisionRaw)) {
      return fail("INVALID_STATE", "gates.revision invalid", {
        gates_path: gatesPath,
        revision: (gatesDoc as Record<string, unknown>).revision ?? null,
      });
    }
    gatesRevision = revisionRaw;
  } catch (e) {
    return fail("NOT_FOUND", "gates_path not found", {
      gates_path: gatesPath,
      message: String(e),
    });
  }

  const gatesWriteResult = await executeToolJson({
    name: "GATES_WRITE",
    tool: gatesWriteTool,
    payload: {
        gates_path: gatesPath,
        update: gateCUpdate,
        inputs_digest: gateCInputsDigest,
        expected_revision: gatesRevision,
        reason,
      },
      tool_context: args.tool_context,
  });
  if (!gatesWriteResult.ok) {
    return fail(gatesWriteResult.code, gatesWriteResult.message, gatesWriteResult.details);
  }

  const advanceToSummaries = await runStageAdvance("summaries");
  if (!advanceToSummaries.ok) {
    return fail(advanceToSummaries.code, advanceToSummaries.message, {
      ...advanceToSummaries.details,
      from,
      requested_next: "summaries",
    });
  }

  const finalRevisionSyncError = syncManifestRevision(advanceToSummaries);
  if (finalRevisionSyncError) return finalRevisionSyncError;

  const to = String(advanceToSummaries.to ?? "").trim();
  const decisionObj = isPlainObject(advanceToSummaries.decision)
    ? (advanceToSummaries.decision as Record<string, unknown>)
    : null;
  const decisionInputsDigest =
    decisionObj && typeof decisionObj.inputs_digest === "string"
      ? decisionObj.inputs_digest
      : null;

  return {
    ok: true,
    schema_version: "orchestrator_tick.post_pivot.v1",
    run_id: runId,
    from,
    to,
    decision_inputs_digest: decisionInputsDigest,
    pivot_created: false,
    wave2_plan_path: null,
    wave2_outputs_count: null,
    citations_path: citationsPath,
    gate_c_status: String(gateC.status ?? ""),
  };
  } finally {
    heartbeat.stop();
    await releaseRunLock(runLockHandle).catch(() => undefined);
  }
}
