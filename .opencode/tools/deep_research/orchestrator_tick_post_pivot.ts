import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ToolWithExecute,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  parseJsonSafe,
  readJson,
  validateManifestV1,
} from "./lifecycle_lib";
import { citations_extract_urls } from "./citations_extract_urls";
import { citations_normalize } from "./citations_normalize";
import { citations_validate } from "./citations_validate";
import { gate_c_compute } from "./gate_c_compute";
import { gates_write } from "./gates_write";
import { pivot_decide } from "./pivot_decide";
import { stage_advance } from "./stage_advance";
import { wave_output_validate } from "./wave_output_validate";

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

export type OrchestratorTickPostPivotArgs = {
  manifest_path: string;
  gates_path: string;
  reason: string;
  stage_advance_tool?: ToolWithExecute;
  pivot_decide_tool?: ToolWithExecute;
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
  const stageObj = isPlainObject(manifest.stage)
    ? (manifest.stage as Record<string, unknown>)
    : {};
  const from = String(stageObj.current ?? "").trim();
  const artifacts = getManifestArtifacts(manifest);
  const runRoot = String(
    (artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath),
  );

  if (!runId) {
    return fail("INVALID_STATE", "manifest.run_id missing", {
      manifest_path: manifestPath,
    });
  }
  if (!from) {
    return fail("INVALID_STATE", "manifest.stage.current missing", {
      manifest_path: manifestPath,
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

  if (from === "summaries") {
    return {
      ok: true,
      schema_version: "orchestrator_tick.post_pivot.v1",
      run_id: runId,
      from,
      to: "summaries",
      decision_inputs_digest: null,
      pivot_created: false,
      citations_path: null,
      gate_c_status: null,
    };
  }

  if (from !== "pivot" && from !== "citations") {
    return fail("INVALID_STATE", "post-pivot tick only supports pivot|citations|summaries stages", {
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
  const waveOutputValidateTool = args.wave_output_validate_tool ?? (wave_output_validate as unknown as ToolWithExecute);
  const citationsExtractUrlsTool = args.citations_extract_urls_tool ?? (citations_extract_urls as unknown as ToolWithExecute);
  const citationsNormalizeTool = args.citations_normalize_tool ?? (citations_normalize as unknown as ToolWithExecute);
  const citationsValidateTool = args.citations_validate_tool ?? (citations_validate as unknown as ToolWithExecute);
  const gateCComputeTool = args.gate_c_compute_tool ?? (gate_c_compute as unknown as ToolWithExecute);
  const gatesWriteTool = args.gates_write_tool ?? (gates_write as unknown as ToolWithExecute);

  const requiredTools: Array<{ name: string; tool: ToolWithExecute }> = [
    { name: "STAGE_ADVANCE", tool: stageAdvanceTool },
    { name: "PIVOT_DECIDE", tool: pivotDecideTool },
    { name: "WAVE_OUTPUT_VALIDATE", tool: waveOutputValidateTool },
    { name: "CITATIONS_EXTRACT_URLS", tool: citationsExtractUrlsTool },
    { name: "CITATIONS_NORMALIZE", tool: citationsNormalizeTool },
    { name: "CITATIONS_VALIDATE", tool: citationsValidateTool },
    { name: "GATE_C_COMPUTE", tool: gateCComputeTool },
    { name: "GATES_WRITE", tool: gatesWriteTool },
  ];

  for (const requiredTool of requiredTools) {
    if (!requiredTool.tool || typeof requiredTool.tool.execute !== "function") {
      return fail("INVALID_ARGS", `${requiredTool.name.toLowerCase()} tool.execute missing`);
    }
  }

  const runStageAdvance = async (
    requestedNext: string,
  ): Promise<ToolJsonOk | ToolJsonFailure> => executeToolJson({
    name: "STAGE_ADVANCE",
    tool: stageAdvanceTool,
    payload: {
      manifest_path: manifestPath,
      gates_path: gatesPath,
      requested_next: requestedNext,
      reason,
    },
    tool_context: args.tool_context,
  });

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

    const advanceToCitations = await runStageAdvance("citations");
    if (!advanceToCitations.ok) {
      return fail(advanceToCitations.code, advanceToCitations.message, {
        ...advanceToCitations.details,
        from,
        requested_next: "citations",
      });
    }

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
      pivot_created: pivotCreated,
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

  const offlineFixturesPath = path.join(runRoot, "citations", "offline-fixtures.orchestrator.json");
  const fixturesResult = await writeDeterministicCitationFixtures({
    urlMapPath,
    fixturesPath: offlineFixturesPath,
  });
  if (!fixturesResult.ok) {
    return fail(fixturesResult.code, fixturesResult.message, fixturesResult.details);
  }

  const validate = await executeToolJson({
    name: "CITATIONS_VALIDATE",
    tool: citationsValidateTool,
    payload: {
      manifest_path: manifestPath,
      url_map_path: urlMapPath,
      offline_fixtures_path: offlineFixturesPath,
      online_fixtures_path: offlineFixturesPath,
      online_dry_run: true,
      reason,
    },
    tool_context: args.tool_context,
  });
  if (!validate.ok) {
    return fail(validate.code, validate.message, validate.details);
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

  const gatesWriteResult = await executeToolJson({
    name: "GATES_WRITE",
    tool: gatesWriteTool,
    payload: {
      gates_path: gatesPath,
      update: gateCUpdate,
      inputs_digest: gateCInputsDigest,
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
    citations_path: citationsPath,
    gate_c_status: String(gateC.status ?? ""),
  };
}
