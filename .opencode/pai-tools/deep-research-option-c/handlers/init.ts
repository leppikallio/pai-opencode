import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  perspectives_write,
  run_init,
  stage_advance,
  wave1_plan,
} from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import {
  asObject,
  readJsonObject,
} from "../lib/io-json";
import {
  normalizeOptional,
  requireAbsolutePath,
} from "../lib/paths";
import {
  printContract,
  resolveRunRoot,
  summarizeManifest,
} from "../lib/run-handle";
import {
  callTool,
  type ToolWithExecute,
} from "../runtime/tool-envelope";

export type InitCliArgs = {
  query: string;
  runId?: string;
  runsRoot?: string;
  sensitivity: "normal" | "restricted" | "no_web";
  mode: "quick" | "standard" | "deep";
  writePerspectives: boolean;
  force: boolean;
  json?: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error(
      "Deep research Option C is disabled in current configuration",
    );
  }
}

function defaultPerspectivePayload(runId: string): Record<string, unknown> {
  return {
    schema_version: "perspectives.v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    perspectives: [
      {
        id: "p1",
        title: "Default synthesis perspective",
        track: "standard",
        agent_type: "ClaudeResearcher",
        prompt_contract: {
          max_words: 900,
          max_sources: 12,
          tool_budget: { search_calls: 4, fetch_calls: 6 },
          must_include_sections: ["Findings", "Sources", "Gaps"],
        },
        platform_requirements: [],
        tool_policy: {
          primary: [],
          secondary: [],
          forbidden: [],
        },
      },
    ],
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function citationModeFromSensitivity(sensitivity: string): "offline" | "online" | "dry_run" {
  if (sensitivity === "no_web") return "offline";
  if (sensitivity === "restricted") return "dry_run";
  return "online";
}

function readManifestDeepFlags(manifest: Record<string, unknown>): Record<string, unknown> {
  const query = asObject(manifest.query);
  const constraints = asObject(query.constraints);
  return asObject(constraints.deep_research_flags);
}

function timestampTokenFromIso(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\..*Z$/, "Z").replace("T", "T");
}

async function writeRunConfig(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  manifest: Record<string, unknown>;
}): Promise<string> {
  const flags = resolveDeepResearchFlagsV1();
  const limits = asObject(args.manifest.limits);
  const query = asObject(args.manifest.query);
  const effectiveSensitivity = String(query.sensitivity ?? "normal");
  const deepFlags = readManifestDeepFlags(args.manifest);

  const manifestBrightDataEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT);
  const manifestApifyEndpoint = asNonEmptyString(deepFlags.PAI_DR_CITATIONS_APIFY_ENDPOINT);
  const effectiveBrightDataEndpoint = (manifestBrightDataEndpoint ?? flags.citationsBrightDataEndpoint ?? "").trim();
  const effectiveApifyEndpoint = (manifestApifyEndpoint ?? flags.citationsApifyEndpoint ?? "").trim();
  const citationMode = citationModeFromSensitivity(effectiveSensitivity);

  const brightDataSource = manifestBrightDataEndpoint
    ? "manifest"
    : flags.citationsBrightDataEndpoint
      ? "settings"
      : "run-config";
  const apifySource = manifestApifyEndpoint
    ? "manifest"
    : flags.citationsApifyEndpoint
      ? "settings"
      : "run-config";

  const runConfig = {
    schema_version: "run_config.v1",
    run_id: args.runId,
    created_at: new Date().toISOString(),
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
    effective: {
      sensitivity: effectiveSensitivity,
      flags: {
        option_c_enabled: true,
        no_web: effectiveSensitivity === "no_web" || flags.noWeb,
        citation_validation_tier: flags.citationValidationTier,
      },
      citation_endpoints: {
        extract_urls: "deep_research_citations_extract_urls",
        normalize: "deep_research_citations_normalize",
        validate: "deep_research_citations_validate",
        render_md: "deep_research_citations_render_md",
      },
      citations: {
        mode: citationMode,
        endpoints: {
          brightdata: effectiveBrightDataEndpoint,
          apify: effectiveApifyEndpoint,
        },
        source: {
          mode: "manifest",
          endpoints: {
            brightdata: brightDataSource,
            apify: apifySource,
          },
          authority: "run-config",
        },
      },
      caps: {
        max_wave1_agents: Number(limits.max_wave1_agents ?? 0),
        max_wave2_agents: Number(limits.max_wave2_agents ?? 0),
        max_summary_kb: Number(limits.max_summary_kb ?? 0),
        max_total_summary_kb: Number(limits.max_total_summary_kb ?? 0),
        max_review_iterations: Number(limits.max_review_iterations ?? 0),
      },
      source: flags.source,
    },
  };

  const outPath = path.join(args.runRoot, "run-config.json");
  await fs.writeFile(outPath, `${JSON.stringify(runConfig, null, 2)}\n`, "utf8");
  return outPath;
}

export async function runInit(args: InitCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const rootOverride = normalizeOptional(args.runsRoot);
  const init = await callTool("run_init", run_init as unknown as ToolWithExecute, {
    query: args.query,
    mode: args.mode,
    sensitivity: args.sensitivity,
    run_id: args.runId,
    ...(rootOverride ? { root_override: requireAbsolutePath(rootOverride, "--runs-root") } : {}),
  });

  const runId = String(init.run_id ?? "").trim();
  const runRoot = requireAbsolutePath(String(init.root ?? ""), "run_init root");
  const manifestPath = requireAbsolutePath(String(init.manifest_path ?? ""), "run_init manifest_path");
  const gatesPath = requireAbsolutePath(String(init.gates_path ?? ""), "run_init gates_path");

  const created = Boolean(init.created);
  const notes: string[] = [];
  let perspectivesPathOut: string | null = null;
  let wave1PlanPathOut: string | null = null;

  if (!created) {
    const existingManifest = await readJsonObject(manifestPath);
    const manifestRunRoot = resolveRunRoot(existingManifest);
    let expected = runRoot;
    let actual = manifestRunRoot;
    try {
      expected = await fs.realpath(runRoot);
    } catch {
      // best effort only
    }
    try {
      actual = await fs.realpath(manifestRunRoot);
    } catch {
      // best effort only
    }
    if (path.resolve(expected) !== path.resolve(actual)) {
      throw new Error(
        `manifest.artifacts.root mismatch for existing run (expected ${expected}, actual ${actual})`,
      );
    }
  }

  if (args.writePerspectives) {
    const perspectivesPath = path.join(runRoot, "perspectives.json");
    perspectivesPathOut = perspectivesPath;
    const perspectivesExists = await fs.stat(perspectivesPath).then(() => true).catch(() => false);

    if (!perspectivesExists || args.force || created) {
      await callTool("perspectives_write", perspectives_write as unknown as ToolWithExecute, {
        perspectives_path: perspectivesPath,
        value: defaultPerspectivePayload(runId),
        reason: created
          ? "operator-cli init: default perspectives (new run)"
          : (args.force ? "operator-cli init: default perspectives (forced overwrite)" : "operator-cli init: default perspectives (missing file)"),
      });
    } else {
      const message = "existing perspectives preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`perspectives.note: ${message}`);
      }
    }
    if (!args.json) {
      console.log(`perspectives_path: ${perspectivesPath}`);
    }

    const wave1PlanPath = path.join(runRoot, "wave-1", "wave1-plan.json");
    const wave1PlanExists = await fs.stat(wave1PlanPath).then(() => true).catch(() => false);

    if (!wave1PlanExists || args.force || created) {
      const wave1Plan = await callTool("wave1_plan", wave1_plan as unknown as ToolWithExecute, {
        manifest_path: manifestPath,
        reason: created
          ? "operator-cli init: deterministic wave1 plan (new run)"
          : (args.force ? "operator-cli init: deterministic wave1 plan (forced overwrite)" : "operator-cli init: deterministic wave1 plan (missing file)"),
      });

      const produced = String(wave1Plan.plan_path ?? "").trim();
      if (!produced || !path.isAbsolute(produced)) {
        throw new Error("wave1_plan returned invalid plan_path");
      }
      wave1PlanPathOut = produced;
      if (!args.json) {
        console.log(`wave1_plan_path: ${produced}`);
      }
    } else {
      wave1PlanPathOut = wave1PlanPath;
      const message = "existing plan preserved (use --force to overwrite)";
      notes.push(message);
      if (!args.json) {
        console.log(`wave1_plan_path: ${wave1PlanPath}`);
        console.log(`wave1_plan.note: ${message}`);
      }
    }

    const preStageManifest = await readJsonObject(manifestPath);
    const preStage = asObject(preStageManifest.stage);
    const preCurrent = String(preStage.current ?? "").trim();
    if (preCurrent === "init") {
      const stageAdvance = await callTool(
        "stage_advance:init->wave1",
        stage_advance as unknown as ToolWithExecute,
        {
          manifest_path: manifestPath,
          gates_path: gatesPath,
          requested_next: "wave1",
          reason: created
            ? "operator-cli init: deterministic init->wave1 (new run)"
            : "operator-cli init: deterministic init->wave1 (resume)",
        },
      );

      if (String(stageAdvance.from ?? "") !== "init" || String(stageAdvance.to ?? "") !== "wave1") {
        throw new Error("stage_advance init->wave1 returned unexpected transition");
      }
    }
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const runConfigPath = await writeRunConfig({
    runRoot,
    runId,
    manifestPath,
    gatesPath,
    manifest,
  });

  if (args.json) {
    emitJson({
      ok: true,
      command: "init",
      run_id: runId,
      run_root: runRoot,
      manifest_path: manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      run_config_path: runConfigPath,
      perspectives_path: perspectivesPathOut,
      wave1_plan_path: wave1PlanPathOut,
      notes,
    });
    return;
  }

  printContract({
    runId,
    runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log(`run_config_path: ${runConfigPath}`);
}
