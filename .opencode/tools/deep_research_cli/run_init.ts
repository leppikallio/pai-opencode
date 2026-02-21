import { tool, type ToolContext } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import {
  type RunMode,
  type Sensitivity,
  atomicWriteJson,
  err,
  nowIso,
  ok,
  resolveDeepResearchFlagsV1,
  stableRunId,
  validateGatesV1,
  validateManifestV1,
} from "./lifecycle_lib";

const SCOPE_PATH_RELATIVE = "operator/scope.json";

type ScopeV1 = {
  schema_version: "scope.v1";
  run_id: string;
  updated_at: string;
  questions: string[];
  non_goals: string[];
  deliverable: string;
  time_budget_minutes: number;
  depth: RunMode;
  citation_posture: "follow_manifest";
  notes?: string;
  assumptions?: string[];
};

function defaultTimeBudgetMinutes(mode: RunMode): number {
  if (mode === "quick") return 15;
  if (mode === "deep") return 120;
  return 45;
}

function validateScopeV1(value: ScopeV1): string | null {
  if (value.schema_version !== "scope.v1") return "scope.schema_version must be scope.v1";
  if (typeof value.run_id !== "string" || value.run_id.trim().length === 0) return "scope.run_id missing";
  if (typeof value.updated_at !== "string" || Number.isNaN(new Date(value.updated_at).getTime())) {
    return "scope.updated_at must be a valid ISO timestamp";
  }
  if (!Array.isArray(value.questions) || value.questions.length < 1) return "scope.questions must be string[] with at least one item";
  if (!value.questions.every((q) => typeof q === "string" && q.trim().length > 0)) {
    return "scope.questions items must be non-empty strings";
  }
  if (!Array.isArray(value.non_goals) || !value.non_goals.every((n) => typeof n === "string")) {
    return "scope.non_goals must be string[]";
  }
  if (typeof value.deliverable !== "string" || value.deliverable.trim().length === 0) {
    return "scope.deliverable must be non-empty string";
  }
  if (!Number.isInteger(value.time_budget_minutes) || value.time_budget_minutes < 1) {
    return "scope.time_budget_minutes must be integer >= 1";
  }
  if (!["quick", "standard", "deep"].includes(value.depth)) {
    return "scope.depth must be quick|standard|deep";
  }
  if (value.citation_posture !== "follow_manifest") {
    return "scope.citation_posture must be follow_manifest";
  }
  if (value.notes !== undefined && typeof value.notes !== "string") {
    return "scope.notes must be string when provided";
  }
  if (value.assumptions !== undefined) {
    if (!Array.isArray(value.assumptions) || !value.assumptions.every((n) => typeof n === "string")) {
      return "scope.assumptions must be string[] when provided";
    }
  }
  return null;
}

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function runIdTraversalError(runId: string): string | null {
  if (path.isAbsolute(runId)) return "run_id must not be an absolute path";
  if (runId === "." || runId === "..") return "run_id must not be '.' or '..'";
  if (runId.includes("/") || runId.includes("\\")) return "run_id must not contain path separators";
  if (runId.includes("..")) return "run_id must not contain '..'";
  return null;
}

export const run_init = tool({
  description: "Initialize an Option C deep research run directory",
  args: {
    query: tool.schema.string().describe("Original user query"),
    mode: tool.schema.enum(["quick", "standard", "deep"]).describe("Run mode"),
    sensitivity: tool.schema.enum(["normal", "restricted", "no_web"]).describe("Sensitivity"),
    run_id: tool.schema.string().optional().describe("Optional run id"),
    root_override: tool.schema.string().optional().describe("Absolute root override (debug)")
  },
  async execute(
    args: {
      query: string;
      mode: RunMode;
      sensitivity: Sensitivity;
      run_id?: string;
      root_override?: string;
    },
    context: ToolContext,
  ) {
    const flags = resolveDeepResearchFlagsV1();
    if (!flags.optionCEnabled) {
      return err("DISABLED", "Deep research Option C is disabled", {
        hint: "Enable in settings.json (deepResearch.flags.PAI_DR_OPTION_C_ENABLED=true).",
      });
    }

    const requestedMode: RunMode = args.mode || flags.modeDefault;
    const requestedSensitivity: Sensitivity = flags.noWeb ? "no_web" : args.sensitivity;

    const runId = (args.run_id ?? "").trim() || stableRunId();
    if (!runId) return err("INVALID_ARGS", "run_id resolved empty");

    const traversalError = runIdTraversalError(runId);
    if (traversalError) {
      return err("PATH_TRAVERSAL", traversalError, { run_id: runId });
    }

    let base: string | undefined;
    try {
      if (args.root_override) {
        if (!path.isAbsolute(args.root_override)) {
          return err("INVALID_ARGS", "root_override must be absolute path", {
            root_override: args.root_override,
          });
        }
        base = args.root_override;
      } else {
        base = flags.runsRoot;
      }
    } catch (e) {
      return err("PATH_NOT_WRITABLE", "failed to resolve runs root", { message: String(e) });
    }

    if (!base) {
      return err("PATH_NOT_WRITABLE", "failed to resolve runs root", {
        reason: "base path resolved empty",
      });
    }

    const baseResolved = path.resolve(base);
    const root = path.resolve(baseResolved, runId);
    if (!isPathWithin(baseResolved, root)) {
      return err("PATH_TRAVERSAL", "run_id resolves outside runs root", { run_id: runId });
    }
    const manifestPath = path.join(root, "manifest.json");
    const gatesPath = path.join(root, "gates.json");
    const scopePath = path.join(root, "operator", "scope.json");
    const ledgerPath = path.join(baseResolved, "runs-ledger.jsonl");

    try {
      const st = await fs.promises.stat(root).catch(() => null);
      if (st?.isDirectory()) {
        const existsManifest = await fs.promises.stat(manifestPath).catch(() => null);
        const existsGates = await fs.promises.stat(gatesPath).catch(() => null);
        if (!existsManifest || !existsGates) {
          return err("ALREADY_EXISTS_CONFLICT", "run root exists but manifest/gates missing", { root });
        }
        return ok({
          run_id: runId,
          root,
          created: false,
          manifest_path: manifestPath,
          gates_path: gatesPath,
          ledger: { path: ledgerPath, written: false },
          paths: {
            wave1_dir: "wave-1",
            wave2_dir: "wave-2",
            citations_dir: "citations",
            summaries_dir: "summaries",
            synthesis_dir: "synthesis",
            logs_dir: "logs",
            operator_dir: "operator",
            scope_file: SCOPE_PATH_RELATIVE,
          },
        });
      }
    } catch {
      // continue
    }

    try {
      await ensureDir(root);
      const dirs = ["wave-1", "wave-2", "citations", "summaries", "synthesis", "logs", "operator"];
      for (const d of dirs) await ensureDir(path.join(root, d));

      let ledgerWritten = false;
      let ledgerError: string | null = null;
      try {
        const entry = {
          ts: nowIso(),
          run_id: runId,
          root,
          session_id: context.sessionID || null,
          query: args.query,
          mode: requestedMode,
          sensitivity: requestedSensitivity,
        };
        await ensureDir(path.dirname(ledgerPath));
        await fs.promises.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
        ledgerWritten = true;
      } catch (e) {
        ledgerError = String(e);
      }

      const ts = nowIso();
      const scope: ScopeV1 = {
        schema_version: "scope.v1",
        run_id: runId,
        updated_at: ts,
        questions: [args.query],
        non_goals: [],
        deliverable: "Produce a deterministic synthesis grounded in run artifacts.",
        time_budget_minutes: defaultTimeBudgetMinutes(requestedMode),
        depth: requestedMode,
        citation_posture: "follow_manifest",
      };
      const scopeErr = validateScopeV1(scope);
      if (scopeErr) {
        return err("SCHEMA_VALIDATION_FAILED", scopeErr, { path: "$.scope" });
      }

      const manifest = {
        schema_version: "manifest.v1",
        run_id: runId,
        created_at: ts,
        updated_at: ts,
        revision: 1,
        query: {
          text: args.query,
          constraints: {
            scope_path: SCOPE_PATH_RELATIVE,
            option_c: {
              enabled: true,
            },
            deep_research_flags: {
              PAI_DR_OPTION_C_ENABLED: flags.optionCEnabled,
              PAI_DR_MODE_DEFAULT: flags.modeDefault,
              PAI_DR_MAX_WAVE1_AGENTS: flags.maxWave1Agents,
              PAI_DR_MAX_WAVE2_AGENTS: flags.maxWave2Agents,
              PAI_DR_MAX_SUMMARY_KB: flags.maxSummaryKb,
              PAI_DR_MAX_TOTAL_SUMMARY_KB: flags.maxTotalSummaryKb,
              PAI_DR_MAX_REVIEW_ITERATIONS: flags.maxReviewIterations,
              PAI_DR_CITATION_VALIDATION_TIER: flags.citationValidationTier,
              PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT: flags.citationsBrightDataEndpoint,
              PAI_DR_CITATIONS_APIFY_ENDPOINT: flags.citationsApifyEndpoint,
              PAI_DR_NO_WEB: flags.noWeb,
              PAI_DR_RUNS_ROOT: flags.runsRoot,
              source: flags.source,
            },
          },
          sensitivity: requestedSensitivity,
        },
        mode: requestedMode,
        status: "created",
        stage: { current: "init", started_at: ts, last_progress_at: ts, history: [] },
        limits: {
          max_wave1_agents: flags.maxWave1Agents,
          max_wave2_agents: flags.maxWave2Agents,
          max_summary_kb: flags.maxSummaryKb,
          max_total_summary_kb: flags.maxTotalSummaryKb,
          max_review_iterations: flags.maxReviewIterations,
        },
        agents: { policy: "existing-runtime-only" },
        artifacts: {
          root,
          paths: {
            wave1_dir: "wave-1",
            wave2_dir: "wave-2",
            citations_dir: "citations",
            summaries_dir: "summaries",
            synthesis_dir: "synthesis",
            logs_dir: "logs",
            gates_file: "gates.json",
            perspectives_file: "perspectives.json",
            citations_file: "citations/citations.jsonl",
            summary_pack_file: "summaries/summary-pack.json",
            pivot_file: "pivot.json",
          },
        },
        metrics: {},
        failures: [],
      };

      const gates = {
        schema_version: "gates.v1",
        run_id: runId,
        revision: 1,
        updated_at: ts,
        inputs_digest: "sha256:0",
        gates: {
          A: { id: "A", name: "Planning completeness", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
          B: { id: "B", name: "Wave output contract compliance", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
          C: { id: "C", name: "Citation validation integrity", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
          D: { id: "D", name: "Summary pack boundedness", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
          E: { id: "E", name: "Synthesis quality", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
          F: { id: "F", name: "Rollout safety", class: "hard", status: "not_run", checked_at: null, metrics: {}, artifacts: [], warnings: [], notes: "" },
        },
      };

      const vmErr = validateManifestV1(manifest);
      if (vmErr) return vmErr;
      const vgErr = validateGatesV1(gates);
      if (vgErr) return vgErr;

      await atomicWriteJson(scopePath, scope);
      await atomicWriteJson(manifestPath, manifest);
      await atomicWriteJson(gatesPath, gates);

      return ok({
        run_id: runId,
        root,
        created: true,
        manifest_path: manifestPath,
        gates_path: gatesPath,
        ledger: { path: ledgerPath, written: ledgerWritten, error: ledgerError },
        paths: {
          wave1_dir: "wave-1",
          wave2_dir: "wave-2",
          citations_dir: "citations",
          summaries_dir: "summaries",
          synthesis_dir: "synthesis",
          logs_dir: "logs",
          operator_dir: "operator",
          scope_file: SCOPE_PATH_RELATIVE,
        },
      });
    } catch (e) {
      return err("SCHEMA_WRITE_FAILED", "failed to create run artifacts", { root, message: String(e) });
    }
  },
});
