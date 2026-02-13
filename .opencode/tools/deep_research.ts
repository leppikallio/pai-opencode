import { tool, type ToolContext } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  ensureDir,
  getCurrentWorkPathForSession,
} from "../plugins/lib/paths";
import { ensureScratchpadSession } from "../plugins/lib/scratchpad";

type JsonObject = Record<string, unknown>;

type RunMode = "quick" | "standard" | "deep";
type Sensitivity = "normal" | "restricted" | "no_web";

type DeepResearchFlagsV1 = {
  optionCEnabled: boolean;
  modeDefault: RunMode;
  maxWave1Agents: number;
  maxWave2Agents: number;
  maxSummaryKb: number;
  maxTotalSummaryKb: number;
  maxReviewIterations: number;
  citationValidationTier: "basic" | "standard" | "thorough";
  noWeb: boolean;
  source: {
    env: string[];
    settings: string[];
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function sha256HexLowerUtf8(input: string): string {
  return createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex");
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

function parseIntSafe(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

function integrationRootFromToolFile(): string {
  // Works both in repo (.opencode/tools/...) and runtime (~/.config/opencode/tools/...).
  const toolFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(toolFile), "..");
}

function readSettingsJson(root: string): Record<string, unknown> | null {
  const p = path.join(root, "settings.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveDeepResearchFlagsV1(): DeepResearchFlagsV1 {
  const source: DeepResearchFlagsV1["source"] = { env: [], settings: [] };

  // Defaults (spec-feature-flags-v1)
  let optionCEnabled = false;
  let modeDefault: RunMode = "standard";
  let maxWave1Agents = 6;
  let maxWave2Agents = 6;
  let maxSummaryKb = 5;
  let maxTotalSummaryKb = 60;
  let maxReviewIterations = 4;
  let citationValidationTier: DeepResearchFlagsV1["citationValidationTier"] = "standard";
  let noWeb = false;

  // Optional: read from integration-layer settings.json (if present).
  // Shape is intentionally flexible for now:
  // - settings.deepResearch.flags.*
  // - settings.pai.deepResearch.flags.*
  const settings = readSettingsJson(integrationRootFromToolFile());
  const flagsFromSettings = (() => {
    if (!settings) return null;
    const direct = (settings as any).deepResearch;
    const pai = (settings as any).pai;
    const nested = pai && typeof pai === "object" && !Array.isArray(pai) ? (pai as any).deepResearch : undefined;
    const candidate = direct ?? nested;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const flags = (candidate as any).flags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags)) return null;
    return flags as Record<string, unknown>;
  })();

  const applySetting = (key: string, apply: () => void) => {
    if (!flagsFromSettings) return;
    if (!(key in flagsFromSettings)) return;
    apply();
    source.settings.push(key);
  };

  applySetting("PAI_DR_OPTION_C_ENABLED", () => {
    const b = parseBool(flagsFromSettings!.PAI_DR_OPTION_C_ENABLED);
    if (b !== null) optionCEnabled = b;
  });
  applySetting("PAI_DR_MODE_DEFAULT", () => {
    const e = parseEnum(flagsFromSettings!.PAI_DR_MODE_DEFAULT, ["quick", "standard", "deep"] as const);
    if (e) modeDefault = e;
  });
  applySetting("PAI_DR_MAX_WAVE1_AGENTS", () => {
    const n = parseIntSafe(flagsFromSettings!.PAI_DR_MAX_WAVE1_AGENTS);
    if (n !== null) maxWave1Agents = n;
  });
  applySetting("PAI_DR_MAX_WAVE2_AGENTS", () => {
    const n = parseIntSafe(flagsFromSettings!.PAI_DR_MAX_WAVE2_AGENTS);
    if (n !== null) maxWave2Agents = n;
  });
  applySetting("PAI_DR_MAX_SUMMARY_KB", () => {
    const n = parseIntSafe(flagsFromSettings!.PAI_DR_MAX_SUMMARY_KB);
    if (n !== null) maxSummaryKb = n;
  });
  applySetting("PAI_DR_MAX_TOTAL_SUMMARY_KB", () => {
    const n = parseIntSafe(flagsFromSettings!.PAI_DR_MAX_TOTAL_SUMMARY_KB);
    if (n !== null) maxTotalSummaryKb = n;
  });
  applySetting("PAI_DR_MAX_REVIEW_ITERATIONS", () => {
    const n = parseIntSafe(flagsFromSettings!.PAI_DR_MAX_REVIEW_ITERATIONS);
    if (n !== null) maxReviewIterations = n;
  });
  applySetting("PAI_DR_CITATION_VALIDATION_TIER", () => {
    const e = parseEnum(flagsFromSettings!.PAI_DR_CITATION_VALIDATION_TIER, ["basic", "standard", "thorough"] as const);
    if (e) citationValidationTier = e;
  });
  applySetting("PAI_DR_NO_WEB", () => {
    const b = parseBool(flagsFromSettings!.PAI_DR_NO_WEB);
    if (b !== null) noWeb = b;
  });

  // Env overrides settings.
  const applyEnv = (key: string, apply: (v: string) => void) => {
    const v = process.env[key];
    if (typeof v !== "string") return;
    apply(v);
    source.env.push(key);
  };

  applyEnv("PAI_DR_OPTION_C_ENABLED", (v) => {
    const b = parseBool(v);
    if (b !== null) optionCEnabled = b;
  });
  applyEnv("PAI_DR_MODE_DEFAULT", (v) => {
    const e = parseEnum(v, ["quick", "standard", "deep"] as const);
    if (e) modeDefault = e;
  });
  applyEnv("PAI_DR_MAX_WAVE1_AGENTS", (v) => {
    const n = parseIntSafe(v);
    if (n !== null) maxWave1Agents = n;
  });
  applyEnv("PAI_DR_MAX_WAVE2_AGENTS", (v) => {
    const n = parseIntSafe(v);
    if (n !== null) maxWave2Agents = n;
  });
  applyEnv("PAI_DR_MAX_SUMMARY_KB", (v) => {
    const n = parseIntSafe(v);
    if (n !== null) maxSummaryKb = n;
  });
  applyEnv("PAI_DR_MAX_TOTAL_SUMMARY_KB", (v) => {
    const n = parseIntSafe(v);
    if (n !== null) maxTotalSummaryKb = n;
  });
  applyEnv("PAI_DR_MAX_REVIEW_ITERATIONS", (v) => {
    const n = parseIntSafe(v);
    if (n !== null) maxReviewIterations = n;
  });
  applyEnv("PAI_DR_CITATION_VALIDATION_TIER", (v) => {
    const e = parseEnum(v, ["basic", "standard", "thorough"] as const);
    if (e) citationValidationTier = e;
  });
  applyEnv("PAI_DR_NO_WEB", (v) => {
    const b = parseBool(v);
    if (b !== null) noWeb = b;
  });

  // Basic sanity caps (avoid nonsense values).
  const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  maxWave1Agents = clampInt(maxWave1Agents, 1, 50);
  maxWave2Agents = clampInt(maxWave2Agents, 1, 50);
  maxSummaryKb = clampInt(maxSummaryKb, 1, 1000);
  maxTotalSummaryKb = clampInt(maxTotalSummaryKb, 1, 100000);
  maxReviewIterations = clampInt(maxReviewIterations, 0, 50);

  return {
    optionCEnabled,
    modeDefault,
    maxWave1Agents,
    maxWave2Agents,
    maxSummaryKb,
    maxTotalSummaryKb,
    maxReviewIterations,
    citationValidationTier,
    noWeb,
    source,
  };
}

function stableRunId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `dr_${ts}_${rnd}`;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.promises.rename(tmp, filePath);
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

// RFC 7396 JSON Merge Patch
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null) return undefined; // caller removes
  if (typeof patch !== "object" || patch === null) return patch;
  if (Array.isArray(patch)) return patch;

  const pObj = patch as Record<string, unknown>;
  const tObj = (typeof target === "object" && target !== null && !Array.isArray(target))
    ? (target as Record<string, unknown>)
    : {};

  const out: Record<string, unknown> = { ...tObj };
  for (const [k, v] of Object.entries(pObj)) {
    if (v === null) {
      delete out[k];
      continue;
    }
    const prev = out[k];
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = mergePatch(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function ok<T extends JsonObject>(data: T): string {
  return JSON.stringify({ ok: true, ...data }, null, 2);
}

function err(code: string, message: string, details: JsonObject = {}): string {
  return JSON.stringify({ ok: false, error: { code, message, details } }, null, 2);
}

function assertEnum(value: string, allowed: string[]): boolean {
  return allowed.includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function errorWithPath(message: string, pathStr: string) {
  return err("SCHEMA_VALIDATION_FAILED", message, { path: pathStr });
}

const MANIFEST_STATUS: string[] = ["created", "running", "paused", "failed", "completed", "cancelled"];
const MANIFEST_MODE: string[] = ["quick", "standard", "deep"];
const MANIFEST_STAGE: string[] = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];

// Phase 01: validate manifest + gates strongly enough to reject invalid examples.
function validateManifestV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("manifest must be an object", "$");
  const v = value;

  if (v.schema_version !== "manifest.v1") return errorWithPath("manifest.schema_version must be manifest.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("manifest.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("manifest.created_at missing", "$.created_at");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("manifest.updated_at missing", "$.updated_at");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("manifest.revision invalid", "$.revision");

  if (!isNonEmptyString(v.mode) || !assertEnum(v.mode, MANIFEST_MODE)) return errorWithPath("manifest.mode invalid", "$.mode");
  if (!isNonEmptyString(v.status) || !assertEnum(v.status, MANIFEST_STATUS)) return errorWithPath("manifest.status invalid", "$.status");

  if (!isPlainObject(v.query)) return errorWithPath("manifest.query missing", "$.query");
  if (!isNonEmptyString(v.query.text)) return errorWithPath("manifest.query.text missing", "$.query.text");
  if (v.query.constraints !== undefined && !isPlainObject(v.query.constraints)) {
    return errorWithPath("manifest.query.constraints must be object", "$.query.constraints");
  }
  if (v.query.sensitivity !== undefined) {
    if (!isNonEmptyString(v.query.sensitivity) || !assertEnum(v.query.sensitivity, ["normal", "restricted", "no_web"])) {
      return errorWithPath("manifest.query.sensitivity invalid", "$.query.sensitivity");
    }
  }

  if (!isPlainObject(v.stage)) return errorWithPath("manifest.stage missing", "$.stage");
  if (!isNonEmptyString(v.stage.current) || !assertEnum(v.stage.current, MANIFEST_STAGE)) {
    return errorWithPath("manifest.stage.current invalid", "$.stage.current");
  }
  if (!isNonEmptyString(v.stage.started_at)) return errorWithPath("manifest.stage.started_at missing", "$.stage.started_at");
  if (!Array.isArray(v.stage.history)) return errorWithPath("manifest.stage.history must be array", "$.stage.history");
  for (let i = 0; i < v.stage.history.length; i++) {
    const h = v.stage.history[i];
    if (!isPlainObject(h)) return errorWithPath("manifest.stage.history entry must be object", `$.stage.history[${i}]`);
    if (!isNonEmptyString(h.from)) return errorWithPath("stage.history.from missing", `$.stage.history[${i}].from`);
    if (!isNonEmptyString(h.to)) return errorWithPath("stage.history.to missing", `$.stage.history[${i}].to`);
    if (!isNonEmptyString(h.ts)) return errorWithPath("stage.history.ts missing", `$.stage.history[${i}].ts`);
    if (!isNonEmptyString(h.reason)) return errorWithPath("stage.history.reason missing", `$.stage.history[${i}].reason`);
    if (!isNonEmptyString(h.inputs_digest)) return errorWithPath("stage.history.inputs_digest missing", `$.stage.history[${i}].inputs_digest`);
    if (!isInteger(h.gates_revision)) return errorWithPath("stage.history.gates_revision invalid", `$.stage.history[${i}].gates_revision`);
  }

  if (!isPlainObject(v.limits)) return errorWithPath("manifest.limits missing", "$.limits");
  for (const key of ["max_wave1_agents", "max_wave2_agents", "max_summary_kb", "max_total_summary_kb", "max_review_iterations"]) {
    if (!isFiniteNumber((v.limits as any)[key])) return errorWithPath(`manifest.limits.${key} invalid`, `$.limits.${key}`);
  }

  if (!isPlainObject(v.artifacts)) return errorWithPath("manifest.artifacts missing", "$.artifacts");
  if (!isNonEmptyString(v.artifacts.root) || !path.isAbsolute(v.artifacts.root)) {
    return errorWithPath("manifest.artifacts.root must be absolute path", "$.artifacts.root");
  }
  if (!isPlainObject(v.artifacts.paths)) return errorWithPath("manifest.artifacts.paths missing", "$.artifacts.paths");
  for (const k of [
    "wave1_dir",
    "wave2_dir",
    "citations_dir",
    "summaries_dir",
    "synthesis_dir",
    "logs_dir",
    "gates_file",
    "perspectives_file",
    "citations_file",
    "summary_pack_file",
    "pivot_file",
  ]) {
    if (!isNonEmptyString((v.artifacts.paths as any)[k])) return errorWithPath(`manifest.artifacts.paths.${k} missing`, `$.artifacts.paths.${k}`);
  }

  if (!isPlainObject(v.metrics)) return errorWithPath("manifest.metrics must be object", "$.metrics");
  if (!Array.isArray(v.failures)) return errorWithPath("manifest.failures must be array", "$.failures");

  return null;
}

function validateGatesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("gates must be an object", "$");
  const v = value;

  if (v.schema_version !== "gates.v1") return errorWithPath("gates.schema_version must be gates.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("gates.run_id missing", "$.run_id");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("gates.revision invalid", "$.revision");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("gates.updated_at missing", "$.updated_at");
  if (!isNonEmptyString(v.inputs_digest)) return errorWithPath("gates.inputs_digest missing", "$.inputs_digest");
  if (!isPlainObject(v.gates)) return errorWithPath("gates.gates missing", "$.gates");

  const requiredGateIds = ["A", "B", "C", "D", "E", "F"];
  for (const gateId of requiredGateIds) {
    if (!((v.gates as any)[gateId])) return errorWithPath("missing required gate", `$.gates.${gateId}`);
  }

  for (const [gateId, gate] of Object.entries(v.gates)) {
    if (!isPlainObject(gate)) return errorWithPath("gate must be object", `$.gates.${gateId}`);
    if (gate.id !== gateId) return errorWithPath("gate.id must match key", `$.gates.${gateId}.id`);
    if (!isNonEmptyString(gate.name)) return errorWithPath("gate.name missing", `$.gates.${gateId}.name`);
    if (!isNonEmptyString(gate.class) || !assertEnum(gate.class, ["hard", "soft"])) {
      return errorWithPath("gate.class invalid", `$.gates.${gateId}.class`);
    }
    const allowedStatus = gate.class === "hard" ? ["not_run", "pass", "fail"] : ["not_run", "pass", "fail", "warn"];
    if (!isNonEmptyString(gate.status) || !assertEnum(gate.status, allowedStatus)) {
      return errorWithPath("gate.status invalid", `$.gates.${gateId}.status`);
    }
    if (gate.checked_at !== null && !isNonEmptyString(gate.checked_at)) {
      return errorWithPath("gate.checked_at must be string or null", `$.gates.${gateId}.checked_at`);
    }
    if (gate.status !== "not_run" && !isNonEmptyString(gate.checked_at)) {
      return errorWithPath("gate.checked_at required when status != not_run", `$.gates.${gateId}.checked_at`);
    }
    if (!isPlainObject(gate.metrics)) return errorWithPath("gate.metrics must be object", `$.gates.${gateId}.metrics`);
    if (!Array.isArray(gate.artifacts) || !gate.artifacts.every((x) => typeof x === "string")) {
      return errorWithPath("gate.artifacts must be string[]", `$.gates.${gateId}.artifacts`);
    }
    if (!Array.isArray(gate.warnings) || !gate.warnings.every((x) => typeof x === "string")) {
      return errorWithPath("gate.warnings must be string[]", `$.gates.${gateId}.warnings`);
    }
    if (typeof gate.notes !== "string") return errorWithPath("gate.notes must be string", `$.gates.${gateId}.notes`);
  }

  return null;
}

async function appendAuditJsonl(args: { runRoot: string; event: Record<string, unknown> }): Promise<void> {
  const logsDir = path.join(args.runRoot, "logs");
  const auditPath = path.join(logsDir, "audit.jsonl");
  await ensureDir(logsDir);
  await fs.promises.appendFile(auditPath, JSON.stringify(args.event) + "\n", "utf8");
}

function listPatchPaths(value: unknown, prefix: string): string[] {
  if (!isPlainObject(value)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const next = `${prefix}.${k}`;
    if (isPlainObject(v)) out.push(...listPatchPaths(v, next));
    else out.push(next);
  }
  return out;
}

function containsImmutableManifestPatch(patch: Record<string, unknown>): string[] {
  const paths = listPatchPaths(patch, "$");
  const bad: string[] = [];
  for (const p of paths) {
    if (
      p === "$.schema_version" ||
      p === "$.run_id" ||
      p === "$.created_at" ||
      p === "$.updated_at" ||
      p === "$.revision" ||
      p.startsWith("$.artifacts")
    ) {
      bad.push(p);
    }
  }
  return bad;
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
        hint: "Set PAI_DR_OPTION_C_ENABLED=1 to enable.",
      });
    }

    const requestedMode: RunMode = args.mode || flags.modeDefault;
    const requestedSensitivity: Sensitivity = flags.noWeb ? "no_web" : args.sensitivity;

    const runId = (args.run_id ?? "").trim() || stableRunId();
    if (!runId) return err("INVALID_ARGS", "run_id resolved empty");

    let base: string | undefined;
    try {
      if (args.root_override && path.isAbsolute(args.root_override)) {
        base = args.root_override;
      } else {
        const sid = context.sessionID ?? "";
        const work = sid ? await getCurrentWorkPathForSession(sid) : null;
        if (work) base = path.join(work, "scratch", "research-runs");
        else {
          const sp = await ensureScratchpadSession(sid);
          base = path.join(sp.dir, "research-runs");
        }
      }
    } catch (e) {
      return err("PATH_NOT_WRITABLE", "failed to resolve scratch root", { message: String(e) });
    }

    if (!base) {
      return err("PATH_NOT_WRITABLE", "failed to resolve scratch root", {
        reason: "base path resolved empty",
      });
    }

    const root = path.join(base, runId);
    const manifestPath = path.join(root, "manifest.json");
    const gatesPath = path.join(root, "gates.json");
    const ledgerPath = path.join(base, "runs-ledger.jsonl");

    // Idempotency: if run exists, do not overwrite.
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
          },
        });
      }
    } catch {
      // continue
    }

    try {
      await ensureDir(root);
      const dirs = [
        "wave-1",
        "wave-2",
        "citations",
        "summaries",
        "synthesis",
        "logs",
      ];
      for (const d of dirs) await ensureDir(path.join(root, d));

      // Append a run-ledger record at the shared runs root.
      // Best-effort: do not fail run init if ledger append fails, but report it.
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
        await fs.promises.appendFile(ledgerPath, JSON.stringify(entry) + "\n", "utf8");
        ledgerWritten = true;
      } catch (e) {
        ledgerError = String(e);
      }

      const ts = nowIso();
      const manifest = {
        schema_version: "manifest.v1",
        run_id: runId,
        created_at: ts,
        updated_at: ts,
        revision: 1,
        query: {
          text: args.query,
          constraints: {
            deep_research_flags: {
              PAI_DR_OPTION_C_ENABLED: flags.optionCEnabled,
              PAI_DR_MODE_DEFAULT: flags.modeDefault,
              PAI_DR_MAX_WAVE1_AGENTS: flags.maxWave1Agents,
              PAI_DR_MAX_WAVE2_AGENTS: flags.maxWave2Agents,
              PAI_DR_MAX_SUMMARY_KB: flags.maxSummaryKb,
              PAI_DR_MAX_TOTAL_SUMMARY_KB: flags.maxTotalSummaryKb,
              PAI_DR_MAX_REVIEW_ITERATIONS: flags.maxReviewIterations,
              PAI_DR_CITATION_VALIDATION_TIER: flags.citationValidationTier,
              PAI_DR_NO_WEB: flags.noWeb,
              source: flags.source,
            },
          },
          sensitivity: requestedSensitivity,
        },
        mode: requestedMode,
        status: "created",
        stage: { current: "init", started_at: ts, history: [] },
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
        },
      });
    } catch (e) {
      return err("SCHEMA_WRITE_FAILED", "failed to create run artifacts", { root, message: String(e) });
    }
  },
});

export const manifest_write = tool({
  description: "Atomic manifest.json writer with revision bump",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    patch: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("JSON Merge Patch (RFC 7396)"),
    expected_revision: tool.schema.number().optional().describe("Optional optimistic lock"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; patch: Record<string, unknown>; expected_revision?: number; reason: string }) {
    try {
      const current = await readJson(args.manifest_path);
      if (!current || typeof current !== "object") return err("INVALID_JSON", "manifest is not an object");
      const cur = current as Record<string, unknown>;

       const immutable = containsImmutableManifestPatch(args.patch);
       if (immutable.length > 0) {
         return err("IMMUTABLE_FIELD", "patch attempts to modify immutable manifest fields", { paths: immutable });
       }

      if (typeof args.expected_revision === "number") {
        const rev = cur.revision;
        if (typeof rev !== "number" || rev !== args.expected_revision) {
          return err("REVISION_MISMATCH", "expected_revision mismatch", { expected: args.expected_revision, got: rev });
        }
      }

       const curRev = typeof cur.revision === "number" && Number.isFinite(cur.revision) ? cur.revision : 0;

      const patched = mergePatch(cur, args.patch);
      if (!patched || typeof patched !== "object") return err("SCHEMA_VALIDATION_FAILED", "patch produced non-object");

      const next = patched as Record<string, unknown>;
      const nextRev = curRev + 1;
      next.revision = nextRev;
      next.updated_at = nowIso();

      const vErr = validateManifestV1(next);
      if (vErr) return vErr;

      await atomicWriteJson(args.manifest_path, next);

      const runRoot = path.dirname(args.manifest_path);
      const auditEvent = {
        ts: nowIso(),
        kind: "manifest_write",
        run_id: String((next as any).run_id ?? ""),
        prev_revision: curRev,
        new_revision: nextRev,
        reason: args.reason,
        patch_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.patch))}`,
      };
      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ new_revision: nextRev, updated_at: String(next.updated_at), audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ new_revision: nextRev, updated_at: String(next.updated_at), audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "manifest write failed", { message: String(e) });
    }
  },
});

export const gates_write = tool({
  description: "Atomic gates.json writer with lifecycle rules",
  args: {
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    update: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("Gate patch object"),
    inputs_digest: tool.schema.string().describe("Digest of inputs used to compute the update"),
    expected_revision: tool.schema.number().optional().describe("Optional optimistic lock"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { gates_path: string; update: Record<string, unknown>; inputs_digest: string; expected_revision?: number; reason: string }) {
    try {
      const current = await readJson(args.gates_path);
      if (!current || typeof current !== "object") return err("INVALID_JSON", "gates is not an object");
      const cur = current as Record<string, unknown>;

      const curRev = typeof cur.revision === "number" && Number.isFinite(cur.revision) ? cur.revision : 0;

      if (typeof args.expected_revision === "number") {
        const rev = cur.revision;
        if (typeof rev !== "number" || rev !== args.expected_revision) {
          return err("REVISION_MISMATCH", "expected_revision mismatch", { expected: args.expected_revision, got: rev });
        }
      }

      const gatesObj = cur.gates as Record<string, any> | undefined;
      if (!gatesObj || typeof gatesObj !== "object") return err("SCHEMA_VALIDATION_FAILED", "gates.gates missing");

      for (const [gateId, patchObj] of Object.entries(args.update)) {
        if (!gatesObj[gateId]) return err("UNKNOWN_GATE_ID", `unknown gate id: ${gateId}`);
        if (!patchObj || typeof patchObj !== "object") return err("INVALID_ARGS", `gate patch must be object: ${gateId}`);

        const allowed = new Set(["status", "checked_at", "metrics", "artifacts", "warnings", "notes"]);
        for (const k of Object.keys(patchObj as any)) {
          if (!allowed.has(k)) return err("INVALID_ARGS", `illegal gate patch key '${k}' for ${gateId}`);
        }

        const nextGate = { ...gatesObj[gateId], ...(patchObj as any) };
        // lifecycle: hard gate cannot be warn
        if (nextGate.class === "hard" && nextGate.status === "warn") {
          return err("LIFECYCLE_RULE_VIOLATION", `hard gate cannot be warn: ${gateId}`);
        }
        if (!nextGate.checked_at) {
          return err("LIFECYCLE_RULE_VIOLATION", `checked_at required on updates: ${gateId}`);
        }
        gatesObj[gateId] = nextGate;
      }

      const nextRev = (typeof cur.revision === "number" ? cur.revision : 0) + 1;
      cur.revision = nextRev;
      cur.updated_at = nowIso();
      cur.inputs_digest = args.inputs_digest;
      cur.gates = gatesObj;

      const vErr = validateGatesV1(cur);
      if (vErr) return vErr;

      await atomicWriteJson(args.gates_path, cur);

      const runRoot = path.dirname(args.gates_path);
      const auditEvent = {
        ts: nowIso(),
        kind: "gates_write",
        run_id: String((cur as any).run_id ?? ""),
        prev_revision: curRev,
        new_revision: nextRev,
        reason: args.reason,
        inputs_digest: args.inputs_digest,
      };
      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ new_revision: nextRev, updated_at: String(cur.updated_at), audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ new_revision: nextRev, updated_at: String(cur.updated_at), audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "gates_path not found");
      return err("WRITE_FAILED", "gates write failed", { message: String(e) });
    }
  },
});

export const stage_advance = tool({
  description: "Advance deep research stage deterministically (Phase 02)",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    requested_next: tool.schema.string().optional().describe("Optional target stage"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(_args: { manifest_path: string; gates_path: string; requested_next?: string; reason: string }) {
    return err("NOT_IMPLEMENTED", "stage_advance is implemented in Phase 02");
  },
});
