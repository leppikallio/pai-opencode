import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../../plugins/lib/paths";

export type JsonObject = Record<string, unknown>;

export type ToolWithExecute = {
  execute: (...args: unknown[]) => unknown | Promise<unknown>;
};

export type RunMode = "quick" | "standard" | "deep";
export type Sensitivity = "normal" | "restricted" | "no_web";

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
  runsRoot: string;
  source: {
    env: string[];
    settings: string[];
  };
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256HexLowerUtf8(input: string): string {
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

function parseAbsolutePathSetting(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;
  const expanded = raw === "~"
    ? os.homedir()
    : raw.startsWith("~/")
      ? path.join(os.homedir(), raw.slice(2))
      : raw;
  if (!path.isAbsolute(expanded)) return null;
  return path.normalize(expanded);
}

function integrationRootFromToolFile(): string {
  // Works both in repo (.opencode/tools/...) and runtime (~/.config/opencode/tools/...).
  const toolFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(toolFile), "..", "..");
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

function getObjectProp(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = value[key];
  return isPlainObject(v) ? v : null;
}

export function getStringProp(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === "string" ? v : null;
}

export function errorCode(e: unknown): string | null {
  if (!isPlainObject(e)) return null;
  const code = e.code;
  return typeof code === "string" ? code : null;
}

export function getManifestArtifacts(manifest: Record<string, unknown>): Record<string, unknown> | null {
  return getObjectProp(manifest, "artifacts");
}

export function getManifestPaths(manifest: Record<string, unknown>): Record<string, unknown> {
  const artifacts = getManifestArtifacts(manifest);
  const paths = artifacts ? getObjectProp(artifacts, "paths") : null;
  return paths ?? {};
}

export function resolveDeepResearchFlagsV1(): DeepResearchFlagsV1 {
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
  let runsRoot = path.join(os.homedir(), ".config", "opencode", "research-runs");

  const settings = readSettingsJson(integrationRootFromToolFile());
  const flagsFromSettings = (() => {
    if (!settings) return null;

    const direct = getObjectProp(settings, "deepResearch");
    const pai = getObjectProp(settings, "pai");
    const nested = pai ? getObjectProp(pai, "deepResearch") : null;
    const candidate = direct ?? nested;
    if (!candidate) return null;
    return getObjectProp(candidate, "flags");
  })();

  const applySetting = (key: string, apply: (flags: Record<string, unknown>) => void) => {
    if (!flagsFromSettings) return;
    if (!(key in flagsFromSettings)) return;
    apply(flagsFromSettings);
    source.settings.push(key);
  };

  applySetting("PAI_DR_OPTION_C_ENABLED", (flags) => {
    const b = parseBool(flags["PAI_DR_OPTION_C_ENABLED"]);
    if (b !== null) optionCEnabled = b;
  });
  applySetting("PAI_DR_MODE_DEFAULT", (flags) => {
    const e = parseEnum(flags["PAI_DR_MODE_DEFAULT"], ["quick", "standard", "deep"] as const);
    if (e) modeDefault = e;
  });
  applySetting("PAI_DR_MAX_WAVE1_AGENTS", (flags) => {
    const n = parseIntSafe(flags["PAI_DR_MAX_WAVE1_AGENTS"]);
    if (n !== null) maxWave1Agents = n;
  });
  applySetting("PAI_DR_MAX_WAVE2_AGENTS", (flags) => {
    const n = parseIntSafe(flags["PAI_DR_MAX_WAVE2_AGENTS"]);
    if (n !== null) maxWave2Agents = n;
  });
  applySetting("PAI_DR_MAX_SUMMARY_KB", (flags) => {
    const n = parseIntSafe(flags["PAI_DR_MAX_SUMMARY_KB"]);
    if (n !== null) maxSummaryKb = n;
  });
  applySetting("PAI_DR_MAX_TOTAL_SUMMARY_KB", (flags) => {
    const n = parseIntSafe(flags["PAI_DR_MAX_TOTAL_SUMMARY_KB"]);
    if (n !== null) maxTotalSummaryKb = n;
  });
  applySetting("PAI_DR_MAX_REVIEW_ITERATIONS", (flags) => {
    const n = parseIntSafe(flags["PAI_DR_MAX_REVIEW_ITERATIONS"]);
    if (n !== null) maxReviewIterations = n;
  });
  applySetting("PAI_DR_CITATION_VALIDATION_TIER", (flags) => {
    const e = parseEnum(flags["PAI_DR_CITATION_VALIDATION_TIER"], ["basic", "standard", "thorough"] as const);
    if (e) citationValidationTier = e;
  });
  applySetting("PAI_DR_NO_WEB", (flags) => {
    const b = parseBool(flags["PAI_DR_NO_WEB"]);
    if (b !== null) noWeb = b;
  });
  applySetting("PAI_DR_RUNS_ROOT", (flags) => {
    const p = parseAbsolutePathSetting(flags["PAI_DR_RUNS_ROOT"]);
    if (p) runsRoot = p;
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
  applyEnv("PAI_DR_RUNS_ROOT", (v) => {
    const p = parseAbsolutePathSetting(v);
    if (p) runsRoot = p;
  });

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
    runsRoot,
    source,
  };
}

export function stableRunId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `dr_${ts}_${rnd}`;
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, filePath);
}

export async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

// RFC 7396 JSON Merge Patch
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
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

export function ok<T extends JsonObject>(data: T): string {
  return JSON.stringify({ ok: true, ...data }, null, 2);
}

export function err(code: string, message: string, details: JsonObject = {}): string {
  return JSON.stringify({ ok: false, error: { code, message, details } }, null, 2);
}

function assertEnum(value: string, allowed: string[]): boolean {
  return allowed.includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function errorWithPath(message: string, pathStr: string) {
  return err("SCHEMA_VALIDATION_FAILED", message, { path: pathStr });
}

const MANIFEST_STATUS: string[] = ["created", "running", "paused", "failed", "completed", "cancelled"];
const MANIFEST_MODE: string[] = ["quick", "standard", "deep"];
export const MANIFEST_STAGE: string[] = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];
export const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
  init: 120,
  wave1: 600,
  pivot: 120,
  wave2: 600,
  citations: 600,
  summaries: 600,
  synthesis: 600,
  review: 300,
  finalize: 120,
};
const GATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type GateId = typeof GATE_IDS[number];

export const GATE_RETRY_CAPS_V1: Record<GateId, number> = {
  A: 0,
  B: 2,
  C: 1,
  D: 1,
  E: 3,
  F: 0,
};

export function validateManifestV1(value: unknown): string | null {
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
  if (v.stage.last_progress_at !== undefined) {
    if (!isNonEmptyString(v.stage.last_progress_at)) {
      return errorWithPath("manifest.stage.last_progress_at must be non-empty string", "$.stage.last_progress_at");
    }
    const lastProgressAt = new Date(v.stage.last_progress_at);
    if (Number.isNaN(lastProgressAt.getTime())) {
      return errorWithPath("manifest.stage.last_progress_at must be valid ISO timestamp", "$.stage.last_progress_at");
    }
  }
  if (!Array.isArray(v.stage.history)) return errorWithPath("manifest.stage.history must be array", "$.stage.history");

  if (!isPlainObject(v.limits)) return errorWithPath("manifest.limits missing", "$.limits");
  const limits = v.limits as Record<string, unknown>;
  for (const key of ["max_wave1_agents", "max_wave2_agents", "max_summary_kb", "max_total_summary_kb", "max_review_iterations"]) {
    if (!isFiniteNumber(limits[key])) return errorWithPath(`manifest.limits.${key} invalid`, `$.limits.${key}`);
  }

  if (!isPlainObject(v.artifacts)) return errorWithPath("manifest.artifacts missing", "$.artifacts");
  if (!isNonEmptyString(v.artifacts.root) || !path.isAbsolute(v.artifacts.root)) {
    return errorWithPath("manifest.artifacts.root must be absolute path", "$.artifacts.root");
  }
  if (!isPlainObject(v.artifacts.paths)) return errorWithPath("manifest.artifacts.paths missing", "$.artifacts.paths");

  if (!isPlainObject(v.metrics)) return errorWithPath("manifest.metrics must be object", "$.metrics");
  if (!Array.isArray(v.failures)) return errorWithPath("manifest.failures must be array", "$.failures");

  return null;
}

export function validateGatesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("gates must be an object", "$");
  const v = value;

  if (v.schema_version !== "gates.v1") return errorWithPath("gates.schema_version must be gates.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("gates.run_id missing", "$.run_id");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("gates.revision invalid", "$.revision");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("gates.updated_at missing", "$.updated_at");
  if (!isNonEmptyString(v.inputs_digest)) return errorWithPath("gates.inputs_digest missing", "$.inputs_digest");
  if (!isPlainObject(v.gates)) return errorWithPath("gates.gates missing", "$.gates");

  for (const gateId of GATE_IDS) {
    if (!v.gates[gateId]) return errorWithPath("missing required gate", `$.gates.${gateId}`);
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

export function containsImmutableManifestPatch(patch: Record<string, unknown>): string[] {
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

export async function appendAuditJsonl(args: { runRoot: string; event: Record<string, unknown> }): Promise<void> {
  const logsDir = path.join(args.runRoot, "logs");
  const auditPath = path.join(logsDir, "audit.jsonl");
  await ensureDir(logsDir);
  await fs.promises.appendFile(auditPath, `${JSON.stringify(args.event)}\n`, "utf8");
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

export function parseJsonSafe(raw: string): { ok: true; value: unknown } | { ok: false; value: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}
