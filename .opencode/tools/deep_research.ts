import { tool, type ToolContext } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { ensureDir } from "../plugins/lib/paths";

type JsonObject = Record<string, unknown>;

type ToolWithExecute = {
  execute: (...args: unknown[]) => unknown | Promise<unknown>;
};

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
  runsRoot: string;
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

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    out[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
  }
  return out;
}

function sha256DigestForJson(value: unknown): string {
  const stable = JSON.stringify(canonicalizeJson(value));
  return `sha256:${sha256HexLowerUtf8(stable)}`;
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

function getObjectProp(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = value[key];
  return isPlainObject(v) ? v : null;
}

function getStringProp(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === "string" ? v : null;
}

function getNumberProp(value: Record<string, unknown>, key: string): number | null {
  const v = value[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function errorCode(e: unknown): string | null {
  if (!isPlainObject(e)) return null;
  const code = e.code;
  return typeof code === "string" ? code : null;
}

function getManifestArtifacts(manifest: Record<string, unknown>): Record<string, unknown> | null {
  return getObjectProp(manifest, "artifacts");
}

function getManifestPaths(manifest: Record<string, unknown>): Record<string, unknown> {
  const artifacts = getManifestArtifacts(manifest);
  const paths = artifacts ? getObjectProp(artifacts, "paths") : null;
  return paths ?? {};
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
  let runsRoot = path.join(os.homedir(), ".config", "opencode", "research-runs");

  // Optional: read from integration-layer settings.json (if present).
  // Shape is intentionally flexible for now:
  // - settings.deepResearch.flags.*
  // - settings.pai.deepResearch.flags.*
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
    runsRoot,
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
  await fs.promises.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, filePath);
}

async function atomicWriteText(filePath: string, value: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, value, "utf8");
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
const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
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
type GateId = typeof GATE_IDS[number];
const GAP_PRIORITY_VALUES = ["P0", "P1", "P2", "P3"] as const;
type GapPriority = typeof GAP_PRIORITY_VALUES[number];
type PivotGap = {
  gap_id: string;
  priority: GapPriority;
  text: string;
  tags: string[];
  source: "explicit" | "parsed_wave1";
  from_perspective_id?: string;
};
const GAP_PRIORITY_RANK: Record<GapPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

// Source: .opencode/Plans/DeepResearchOptionC/spec-gate-escalation-v1.md
const GATE_RETRY_CAPS_V1: Record<GateId, number> = {
  A: 0,
  B: 2,
  C: 1,
  D: 1,
  E: 3,
  F: 0,
};

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
  const limits = v.limits as Record<string, unknown>;
  for (const key of ["max_wave1_agents", "max_wave2_agents", "max_summary_kb", "max_total_summary_kb", "max_review_iterations"]) {
    if (!isFiniteNumber(limits[key])) return errorWithPath(`manifest.limits.${key} invalid`, `$.limits.${key}`);
  }

  if (!isPlainObject(v.artifacts)) return errorWithPath("manifest.artifacts missing", "$.artifacts");
  if (!isNonEmptyString(v.artifacts.root) || !path.isAbsolute(v.artifacts.root)) {
    return errorWithPath("manifest.artifacts.root must be absolute path", "$.artifacts.root");
  }
  if (!isPlainObject(v.artifacts.paths)) return errorWithPath("manifest.artifacts.paths missing", "$.artifacts.paths");
  const artifactPaths = v.artifacts.paths as Record<string, unknown>;
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
    if (!isNonEmptyString(artifactPaths[k])) return errorWithPath(`manifest.artifacts.paths.${k} missing`, `$.artifacts.paths.${k}`);
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
  const gatesObj = v.gates as Record<string, unknown>;
  for (const gateId of requiredGateIds) {
    if (!gatesObj[gateId]) return errorWithPath("missing required gate", `$.gates.${gateId}`);
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

function validatePerspectivesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("perspectives must be an object", "$");
  const v = value;

  if (v.schema_version !== "perspectives.v1") {
    return errorWithPath("perspectives.schema_version must be perspectives.v1", "$.schema_version");
  }
  if (!isNonEmptyString(v.run_id)) return errorWithPath("perspectives.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("perspectives.created_at missing", "$.created_at");
  if (!Array.isArray(v.perspectives)) return errorWithPath("perspectives.perspectives must be array", "$.perspectives");

  const allowedTracks = ["standard", "independent", "contrarian"];

  for (let i = 0; i < v.perspectives.length; i++) {
    const p = v.perspectives[i];
    if (!isPlainObject(p)) return errorWithPath("perspective must be object", `$.perspectives[${i}]`);
    if (!isNonEmptyString(p.id)) return errorWithPath("perspective.id missing", `$.perspectives[${i}].id`);
    if (!isNonEmptyString(p.title)) return errorWithPath("perspective.title missing", `$.perspectives[${i}].title`);
    if (!isNonEmptyString(p.track) || !assertEnum(p.track, allowedTracks)) {
      return errorWithPath("perspective.track invalid", `$.perspectives[${i}].track`);
    }
    if (!isNonEmptyString(p.agent_type)) {
      return errorWithPath("perspective.agent_type missing", `$.perspectives[${i}].agent_type`);
    }

    if (!isPlainObject(p.prompt_contract)) {
      return errorWithPath("perspective.prompt_contract must be object", `$.perspectives[${i}].prompt_contract`);
    }

    const c = p.prompt_contract;
    if (!isFiniteNumber(c.max_words)) {
      return errorWithPath("prompt_contract.max_words invalid", `$.perspectives[${i}].prompt_contract.max_words`);
    }
    if (!isFiniteNumber(c.max_sources)) {
      return errorWithPath("prompt_contract.max_sources invalid", `$.perspectives[${i}].prompt_contract.max_sources`);
    }
    if (!isPlainObject(c.tool_budget)) {
      return errorWithPath("prompt_contract.tool_budget must be object", `$.perspectives[${i}].prompt_contract.tool_budget`);
    }
    if (!Array.isArray(c.must_include_sections)) {
      return errorWithPath("prompt_contract.must_include_sections must be array", `$.perspectives[${i}].prompt_contract.must_include_sections`);
    }
    for (let j = 0; j < c.must_include_sections.length; j++) {
      if (!isNonEmptyString(c.must_include_sections[j])) {
        return errorWithPath(
          "prompt_contract.must_include_sections entries must be non-empty strings",
          `$.perspectives[${i}].prompt_contract.must_include_sections[${j}]`,
        );
      }
    }
  }

  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeading(markdown: string, heading: string): boolean {
  const headingRegex = new RegExp(`^\\s{0,3}#{1,6}\\s+${escapeRegex(heading)}\\s*(?:#+\\s*)?$`, "m");
  return headingRegex.test(markdown);
}

function findHeadingSection(markdown: string, heading: string): string | null {
  const headingRegex = new RegExp(`^\\s{0,3}#{1,6}\\s+${escapeRegex(heading)}\\s*(?:#+\\s*)?$`, "m");
  const startMatch = headingRegex.exec(markdown);
  if (!startMatch || startMatch.index === undefined) return null;

  const sectionStart = startMatch.index + startMatch[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeading = /^\s{0,3}#{1,6}\s+/m.exec(rest);
  const sectionEnd = nextHeading ? sectionStart + (nextHeading.index ?? 0) : markdown.length;
  return markdown.slice(sectionStart, sectionEnd);
}

function countWords(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function parseSourcesSection(sectionBody: string):
  | { ok: true; count: number }
  | { ok: false; reason: "NOT_BULLET" | "MISSING_URL"; line: string } {
  const lines = sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let count = 0;
  for (const line of lines) {
    if (!/^([-*+]\s+|\d+\.\s+)/.test(line)) {
      return { ok: false, reason: "NOT_BULLET", line };
    }
    if (!/https?:\/\//.test(line)) {
      return { ok: false, reason: "MISSING_URL", line };
    }
    count += 1;
  }

  return { ok: true, count };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeGapPriority(value: unknown): GapPriority | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return (GAP_PRIORITY_VALUES as readonly string[]).includes(v) ? (v as GapPriority) : null;
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedup = new Set<string>();
  for (const entry of value) {
    const tag = normalizeWhitespace(String(entry ?? ""));
    if (!tag) continue;
    dedup.add(tag);
  }
  return [...dedup].sort((a, b) => a.localeCompare(b));
}

function compareGapPriority(a: GapPriority, b: GapPriority): number {
  return GAP_PRIORITY_RANK[a] - GAP_PRIORITY_RANK[b];
}

function normalizeOutputPathForPivotArtifact(runRoot: string, outputPath: string): string {
  const trimmed = outputPath.trim();
  if (!trimmed) return trimmed;
  if (!path.isAbsolute(trimmed)) return trimmed;
  const rel = path.relative(runRoot, trimmed);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return trimmed;
  return rel.split(path.sep).join("/");
}

function resolveRunPath(runRoot: string, maybeAbsoluteOrRelative: string): string {
  const trimmed = maybeAbsoluteOrRelative.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.join(runRoot, trimmed);
}

function extractPivotGapsFromMarkdown(markdown: string, perspectiveId: string):
  | { ok: true; gaps: PivotGap[] }
  | { ok: false; code: string; message: string; details: JsonObject } {
  const section = findHeadingSection(markdown, "Gaps");
  if (section === null) {
    return {
      ok: false,
      code: "GAPS_SECTION_NOT_FOUND",
      message: "Gaps heading not found",
      details: { perspective_id: perspectiveId },
    };
  }

  const gaps: PivotGap[] = [];
  let index = 0;
  const lines = section.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("-")) continue;

    const match = /^-\s+\((P[0-3])\)\s+(.+)$/.exec(line);
    if (!match) {
      return {
        ok: false,
        code: "GAPS_PARSE_FAILED",
        message: "Malformed gap bullet under Gaps section",
        details: {
          perspective_id: perspectiveId,
          line,
        },
      };
    }

    index += 1;
    const priority = match[1] as GapPriority;
    const text = normalizeWhitespace(match[2] ?? "");
    const tags = [...new Set((text.match(/#[a-z0-9_-]+/g) ?? []).map((tag) => tag.slice(1)))].sort((a, b) => a.localeCompare(b));
    gaps.push({
      gap_id: `gap_${perspectiveId}_${index}`,
      priority,
      text,
      tags,
      from_perspective_id: perspectiveId,
      source: "parsed_wave1",
    });
  }

  return { ok: true, gaps };
}

function truncateMessage(value: string, max = 200): string {
  return value.length <= max ? value : value.slice(0, max);
}

function toFailureShape(value: unknown): { code: string; message: string; details: Record<string, unknown> } {
  const v = isPlainObject(value) ? value : {};
  const code = typeof v.code === "string" && v.code.trim().length > 0 ? v.code : "VALIDATION_FAILED";
  const message = typeof v.message === "string" && v.message.trim().length > 0 ? v.message : "validation failed";
  const details = isPlainObject(v.details) ? v.details : {};
  return { code, message, details };
}

function buildRetryChangeNote(failure: { code: string; details: Record<string, unknown> }): string {
  switch (failure.code) {
    case "MISSING_REQUIRED_SECTION": {
      const section = typeof failure.details.section === "string" && failure.details.section.trim().length > 0
        ? failure.details.section.trim()
        : "required section";
      return truncateMessage(`Add missing required section '${section}' and ensure Sources uses bullet URL entries.`);
    }
    case "TOO_MANY_WORDS": {
      return truncateMessage("Reduce content length to satisfy max_words while keeping required sections.");
    }
    case "TOO_MANY_SOURCES": {
      return truncateMessage("Reduce Sources entries to max_sources and keep only bullet URL items.");
    }
    case "MALFORMED_SOURCES": {
      return truncateMessage("Fix Sources so each entry is a bullet and contains an absolute URL.");
    }
    default: {
      return truncateMessage("Address validation error and regenerate output to satisfy the prompt contract.");
    }
  }
}

async function collectWaveReviewMetrics(args: {
  markdownPath: string;
  requiredSections: string[];
}): Promise<{ words: number; sources: number; missing_sections: string[] }> {
  const markdown = await fs.promises.readFile(args.markdownPath, "utf8");
  const missingSections = args.requiredSections.filter((section) => !hasHeading(markdown, section));

  let sources = 0;
  const sourceHeading = args.requiredSections.find((section) => section.toLowerCase() === "sources");
  if (sourceHeading) {
    const sourcesSection = findHeadingSection(markdown, sourceHeading);
    if (sourcesSection !== null) {
      const parsedSources = parseSourcesSection(sourcesSection);
      if (parsedSources.ok) sources = parsedSources.count;
    }
  }

  return {
    words: countWords(markdown),
    sources,
    missing_sections: missingSections,
  };
}

function buildWave1PromptMd(args: {
  queryText: string;
  perspectiveId: string;
  title: string;
  track: string;
  agentType: string;
  maxWords: number;
  maxSources: number;
  mustIncludeSections: string[];
}): string {
  return [
    "# Wave 1 Perspective Plan",
    "",
    `- Perspective ID: ${args.perspectiveId}`,
    `- Title: ${args.title}`,
    `- Track: ${args.track}`,
    `- Agent Type: ${args.agentType}`,
    "",
    "## Query",
    args.queryText,
    "",
    "## Prompt Contract",
    `- Max words: ${args.maxWords}`,
    `- Max sources: ${args.maxSources}`,
    `- Required sections: ${args.mustIncludeSections.join(", ")}`,
    "",
    "Produce markdown that satisfies the prompt contract exactly.",
  ].join("\n");
}

async function appendAuditJsonl(args: { runRoot: string; event: Record<string, unknown> }): Promise<void> {
  const logsDir = path.join(args.runRoot, "logs");
  const auditPath = path.join(logsDir, "audit.jsonl");
  await ensureDir(logsDir);
  await fs.promises.appendFile(auditPath, `${JSON.stringify(args.event)}\n`, "utf8");
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
        await fs.promises.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
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
              PAI_DR_RUNS_ROOT: flags.runsRoot,
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

async function statPath(p: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

async function copyDirContents(
  srcDir: string,
  dstDir: string,
  copiedEntries: string[],
  relativePrefix: string,
): Promise<void> {
  await ensureDir(dstDir);
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    const relPath = path.join(relativePrefix, entry.name);

    if (entry.isDirectory()) {
      await copyDirContents(srcPath, dstPath, copiedEntries, relPath);
      continue;
    }

    if (entry.isFile()) {
      await ensureDir(path.dirname(dstPath));
      await fs.promises.copyFile(srcPath, dstPath);
      copiedEntries.push(relPath);
      continue;
    }

    // Keep fixtures deterministic and simple.
    throw new Error(`unsupported fixture entry type at ${srcPath}`);
  }
}

export const dry_run_seed = tool({
  description: "Seed deterministic dry-run run root from fixture artifacts",
  args: {
    fixture_dir: tool.schema.string().describe("Absolute path to fixtures/dry-run/<case-id>"),
    run_id: tool.schema.string().describe("Deterministic run id"),
    reason: tool.schema.string().describe("Audit reason"),
    root_override: tool.schema.string().optional().describe("Absolute root override for run_init"),
  },
  async execute(
    args: {
      fixture_dir: string;
      run_id: string;
      reason: string;
      root_override?: string;
    },
    context: ToolContext,
  ) {
    try {
      const fixtureDirInput = args.fixture_dir.trim();
      const runId = args.run_id.trim();
      const reason = args.reason.trim();
      const rootOverrideInput = (args.root_override ?? "").trim();

      if (!fixtureDirInput) return err("INVALID_ARGS", "fixture_dir must be non-empty");
      if (!runId) return err("INVALID_ARGS", "run_id must be non-empty");
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const fixtureDir = path.resolve(fixtureDirInput);
      if (!path.isAbsolute(fixtureDir)) {
        return err("INVALID_ARGS", "fixture_dir must be absolute", { fixture_dir: args.fixture_dir });
      }

      const fixtureStat = await statPath(fixtureDir);
      if (!fixtureStat?.isDirectory()) {
        return err("NOT_FOUND", "fixture_dir not found or not a directory", { fixture_dir: fixtureDir });
      }

      const manifestSeedPath = path.join(fixtureDir, "manifest.json");
      const wave1SeedPath = path.join(fixtureDir, "wave-1");

      const hasManifestSeed = Boolean((await statPath(manifestSeedPath))?.isFile());
      const hasWave1Seed = Boolean((await statPath(wave1SeedPath))?.isDirectory());

      if (!hasManifestSeed && !hasWave1Seed) {
        return err("INVALID_FIXTURE", "fixture must include manifest.json or wave-1/", {
          fixture_dir: fixtureDir,
          required_any_of: ["manifest.json", "wave-1/"],
        });
      }

      const caseId = path.basename(fixtureDir);
      const rootOverride = rootOverrideInput || path.join(path.dirname(fixtureDir), ".tmp-runs");
      if (!path.isAbsolute(rootOverride)) {
        return err("INVALID_ARGS", "root_override must be absolute", { root_override: args.root_override ?? null });
      }

      const initRaw = (await (run_init as unknown as ToolWithExecute).execute(
        {
          query: `dry-run fixture seed: ${caseId}`,
          mode: "standard",
          sensitivity: "no_web",
          run_id: runId,
          root_override: rootOverride,
        },
        context,
      )) as string;

      const initParsed = parseJsonSafe(initRaw);
      if (!initParsed.ok) {
        return err("UPSTREAM_INVALID_JSON", "run_init returned non-JSON", { raw: initParsed.value });
      }
      if (!isPlainObject(initParsed.value) || initParsed.value.ok !== true) {
        return JSON.stringify(initParsed.value, null, 2);
      }
      const initValue = initParsed.value;
      if (initValue.created === false) {
        return err("ALREADY_EXISTS", "run already exists; dry-run seed requires a fresh run_id", {
          run_id: runId,
          root: initValue.root ?? null,
        });
      }

      const runRoot = String(initValue.root ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "run_init returned invalid run root", {
          root: initValue.root ?? null,
        });
      }

      const copiedRoots: string[] = [];
      const copiedEntries: string[] = [];

      for (const artifactName of ["wave-1", "wave-2", "citations"] as const) {
        const src = path.join(fixtureDir, artifactName);
        const dst = path.join(runRoot, artifactName);
        const st = await statPath(src);
        if (!st) continue;

        copiedRoots.push(artifactName);
        if (st.isDirectory()) {
          await copyDirContents(src, dst, copiedEntries, artifactName);
          continue;
        }
        if (st.isFile()) {
          await ensureDir(path.dirname(dst));
          await fs.promises.copyFile(src, dst);
          copiedEntries.push(artifactName);
          continue;
        }

        return err("INVALID_FIXTURE", "fixture contains unsupported artifact type", {
          artifact: artifactName,
          path: src,
        });
      }

      const patchRaw = (await (manifest_write as unknown as ToolWithExecute).execute(
        {
          manifest_path: String(initValue.manifest_path),
          reason: `dry_run_seed: ${reason}`,
          patch: {
            query: {
              sensitivity: "no_web",
              constraints: {
                dry_run: {
                  fixture_dir: fixtureDir,
                  case_id: caseId,
                },
              },
            },
          },
        },
        context,
      )) as string;

      const patchParsed = parseJsonSafe(patchRaw);
      if (!patchParsed.ok) {
        return err("UPSTREAM_INVALID_JSON", "manifest_write returned non-JSON", { raw: patchParsed.value });
      }
      if (!isPlainObject(patchParsed.value) || patchParsed.value.ok !== true) return JSON.stringify(patchParsed.value, null, 2);

      copiedEntries.sort();
      copiedRoots.sort();

      return ok({
        run_id: runId,
        root: runRoot,
        manifest_path: String(initValue.manifest_path),
        gates_path: String(initValue.gates_path),
        root_override: rootOverride,
        copied: {
          roots: copiedRoots,
          entries: copiedEntries,
        },
        dry_run: {
          fixture_dir: fixtureDir,
          case_id: caseId,
        },
        manifest_revision: Number((patchParsed.value as Record<string, unknown>).new_revision ?? 0),
      });
    } catch (e) {
      return err("WRITE_FAILED", "dry_run_seed failed", { message: String(e) });
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
        run_id: getStringProp(next, "run_id") ?? "",
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
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "manifest write failed", { message: String(e) });
    }
  },
});

export const retry_record = tool({
  description: "Record a bounded retry attempt for a gate",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gate_id: tool.schema.enum(["A", "B", "C", "D", "E", "F"]).describe("Gate id"),
    change_note: tool.schema.string().describe("Material change for this retry"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; gate_id: GateId; change_note: string; reason: string }) {
    try {
      const changeNote = args.change_note.trim();
      const reason = args.reason.trim();
      if (!changeNote) return err("INVALID_ARGS", "change_note must be non-empty");
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(args.manifest_path);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const metrics = isPlainObject(manifest.metrics) ? (manifest.metrics as Record<string, unknown>) : {};
      const retryCounts = isPlainObject(metrics.retry_counts) ? (metrics.retry_counts as Record<string, unknown>) : {};
      const currentRaw = retryCounts[args.gate_id];
      const current = isInteger(currentRaw) && currentRaw >= 0 ? currentRaw : 0;
      const max = GATE_RETRY_CAPS_V1[args.gate_id];

      if (current >= max) {
        return err("RETRY_EXHAUSTED", `retry cap exhausted for gate ${args.gate_id}`, {
          gate_id: args.gate_id,
          retry_count: current,
          max_retries: max,
        });
      }

      const next = current + 1;
      const retryHistory = Array.isArray(metrics.retry_history) ? metrics.retry_history : [];
      const retryEntry = {
        ts: nowIso(),
        gate_id: args.gate_id,
        attempt: next,
        change_note: changeNote,
        reason,
      };

      const patch = {
        metrics: {
          ...metrics,
          retry_counts: {
            ...retryCounts,
            [args.gate_id]: next,
          },
          retry_history: [...retryHistory, retryEntry],
        },
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `retry_record(${args.gate_id}#${next}): ${reason}`,
      })) as string;
      const writeObj = parseJsonSafe(writeRaw);

      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!isPlainObject(writeObj.value) || writeObj.value.ok !== true) return JSON.stringify(writeObj.value, null, 2);
      const writeValue = writeObj.value;

      return ok({
        gate_id: args.gate_id,
        retry_count: next,
        max_retries: max,
        attempt: next,
        audit_written: Boolean(writeValue.audit_written),
        audit_path: typeof writeValue.audit_path === "string" ? writeValue.audit_path : null,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "retry_record failed", { message: String(e) });
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

      const gatesObj = cur.gates as Record<string, Record<string, unknown>> | undefined;
      if (!gatesObj || typeof gatesObj !== "object") return err("SCHEMA_VALIDATION_FAILED", "gates.gates missing");

      for (const [gateId, patchObj] of Object.entries(args.update)) {
        if (!gatesObj[gateId]) return err("UNKNOWN_GATE_ID", `unknown gate id: ${gateId}`);
        if (!patchObj || typeof patchObj !== "object") return err("INVALID_ARGS", `gate patch must be object: ${gateId}`);

        const allowed = new Set(["status", "checked_at", "metrics", "artifacts", "warnings", "notes"]);
        for (const k of Object.keys(patchObj as Record<string, unknown>)) {
          if (!allowed.has(k)) return err("INVALID_ARGS", `illegal gate patch key '${k}' for ${gateId}`);
        }

        const nextGate = { ...gatesObj[gateId], ...(patchObj as Record<string, unknown>) };
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
        run_id: getStringProp(cur, "run_id") ?? "",
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
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "gates_path not found");
      return err("WRITE_FAILED", "gates write failed", { message: String(e) });
    }
  },
});

export const perspectives_write = tool({
  description: "Validate and atomically write perspectives.json (perspectives.v1)",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json"),
    value: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("perspectives.v1 JSON payload"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { perspectives_path: string; value: Record<string, unknown>; reason: string }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const reason = args.reason.trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const vErr = validatePerspectivesV1(args.value);
      if (vErr) return vErr;

      await atomicWriteJson(perspectivesPath, args.value);

      const runRoot = path.dirname(perspectivesPath);
      const auditEvent = {
        ts: nowIso(),
        kind: "perspectives_write",
        run_id: String(args.value.run_id ?? ""),
        reason,
        path: perspectivesPath,
        value_digest: `sha256:${sha256HexLowerUtf8(JSON.stringify(args.value))}`,
      };

      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
        return ok({ path: perspectivesPath, audit_written: true, audit_path: path.join(runRoot, "logs", "audit.jsonl") });
      } catch (e) {
        return ok({ path: perspectivesPath, audit_written: false, audit_error: String(e) });
      }
    } catch (e) {
      return err("WRITE_FAILED", "perspectives write failed", { message: String(e) });
    }
  },
});

export const wave1_plan = tool({
  description: "Build deterministic Wave 1 plan artifact from perspectives.v1",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    perspectives_path: tool.schema.string().optional().describe("Absolute path to perspectives.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; perspectives_path?: string; reason: string }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const runId = String(manifest.run_id ?? "");

      const pathsObj = getManifestPaths(manifest);
      const wave1Dir = String(pathsObj.wave1_dir ?? "wave-1");
      const perspectivesFile = String(pathsObj.perspectives_file ?? "perspectives.json");

      const perspectivesPathInput = args.perspectives_path?.trim() ?? "";
      const perspectivesPath = perspectivesPathInput || path.join(runRoot, perspectivesFile);
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path ?? null });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "perspectives_path contains invalid JSON", { perspectives_path: perspectivesPath });
        throw e;
      }

      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      if (String(perspectivesDoc.run_id ?? "") !== runId) {
        return err("INVALID_STATE", "manifest and perspectives run_id mismatch", {
          manifest_run_id: runId,
          perspectives_run_id: String(perspectivesDoc.run_id ?? ""),
        });
      }

      const maxWave1AgentsRaw = (manifest.limits as Record<string, unknown>)?.max_wave1_agents;
      const maxWave1Agents = isFiniteNumber(maxWave1AgentsRaw) ? Math.max(0, Math.floor(maxWave1AgentsRaw)) : 0;

      const rawPerspectives = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? []);
      if (rawPerspectives.length > maxWave1Agents) {
        return err("WAVE_CAP_EXCEEDED", "too many perspectives for wave1", {
          cap: maxWave1Agents,
          count: rawPerspectives.length,
        });
      }

      const sortedPerspectives = [...rawPerspectives].sort((a, b) => {
        const aId = String(a.id ?? "");
        const bId = String(b.id ?? "");
        return aId.localeCompare(bId);
      });

      const queryObj = isPlainObject(manifest.query) ? (manifest.query as Record<string, unknown>) : {};
      const queryText = String(queryObj.text ?? "");

      const digestPayload = {
        schema: "wave1_plan.inputs.v1",
        run_id: runId,
        query_text: queryText,
        max_wave1_agents: maxWave1Agents,
        wave1_dir: wave1Dir,
        perspectives: sortedPerspectives.map((perspective) => {
          const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
          return {
            id: String(perspective.id ?? ""),
            agent_type: String(perspective.agent_type ?? ""),
            max_words: Number(contract.max_words ?? 0),
            max_sources: Number(contract.max_sources ?? 0),
            must_include_sections: Array.isArray(contract.must_include_sections)
              ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
              : [],
          };
        }),
      };
      const inputsDigest = sha256DigestForJson(digestPayload);

      const entries = sortedPerspectives.map((perspective) => {
        const perspectiveId = String(perspective.id ?? "");
        const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
        const maxWords = Number(contract.max_words ?? 0);
        const maxSources = Number(contract.max_sources ?? 0);
        const mustIncludeSections = Array.isArray(contract.must_include_sections)
          ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
          : [];

        return {
          perspective_id: perspectiveId,
          agent_type: String(perspective.agent_type ?? ""),
          output_md: `${wave1Dir}/${perspectiveId}.md`,
          prompt_md: buildWave1PromptMd({
            queryText,
            perspectiveId,
            title: String(perspective.title ?? ""),
            track: String(perspective.track ?? ""),
            agentType: String(perspective.agent_type ?? ""),
            maxWords,
            maxSources,
            mustIncludeSections,
          }),
        };
      });

      const generatedAt = nowIso();
      const plan = {
        schema_version: "wave1_plan.v1",
        run_id: runId,
        generated_at: generatedAt,
        inputs_digest: inputsDigest,
        entries,
      };

      const planPath = path.join(runRoot, wave1Dir, "wave1-plan.json");
      await atomicWriteJson(planPath, plan);

      const auditEvent = {
        ts: generatedAt,
        kind: "wave1_plan",
        run_id: runId,
        reason,
        plan_path: planPath,
        planned: entries.length,
        inputs_digest: inputsDigest,
      };

      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
      } catch {
        // best effort only
      }

      return ok({
        plan_path: planPath,
        inputs_digest: inputsDigest,
        planned: entries.length,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path or perspectives_path not found");
      return err("WRITE_FAILED", "wave1 plan failed", { message: String(e) });
    }
  },
});

export const wave_output_validate = tool({
  description: "Validate Wave output markdown contract for a single perspective",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json (perspectives.v1)"),
    perspective_id: tool.schema.string().describe("Perspective id to validate against"),
    markdown_path: tool.schema.string().describe("Absolute path to markdown output"),
  },
  async execute(args: { perspectives_path: string; perspective_id: string; markdown_path: string }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const perspectiveId = args.perspective_id.trim();
      const markdownPath = args.markdown_path.trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }
      if (!perspectiveId) return err("INVALID_ARGS", "perspective_id must be non-empty");
      if (!markdownPath) return err("INVALID_ARGS", "markdown_path must be non-empty");
      if (!path.isAbsolute(markdownPath)) {
        return err("INVALID_ARGS", "markdown_path must be absolute", { markdown_path: args.markdown_path });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "perspectives_path contains invalid JSON", { perspectives_path: perspectivesPath });
        throw e;
      }

      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const perspective = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? [])
        .find((entry) => String(entry.id ?? "") === perspectiveId);

      if (!perspective) {
        return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
          perspective_id: perspectiveId,
        });
      }

      const contract = perspective.prompt_contract as Record<string, unknown>;
      const maxWords = Number(contract.max_words ?? 0);
      const maxSources = Number(contract.max_sources ?? 0);
      const requiredSections = Array.isArray(contract.must_include_sections)
        ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
        : [];

      let markdown: string;
      try {
        markdown = await fs.promises.readFile(markdownPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "markdown_path not found", { markdown_path: markdownPath });
        throw e;
      }

      const missingSections = requiredSections.filter((section) => !hasHeading(markdown, section));
      if (missingSections.length > 0) {
        return err("MISSING_REQUIRED_SECTION", `Missing section: ${missingSections[0]}`, {
          section: missingSections[0],
          missing_sections: missingSections,
        });
      }

      const words = countWords(markdown);
      if (words > maxWords) {
        return err("TOO_MANY_WORDS", "word count exceeds max_words", {
          max_words: maxWords,
          words,
        });
      }

      let sources = 0;
      const sourceHeading = requiredSections.find((section) => section.toLowerCase() === "sources");
      if (sourceHeading) {
        const sourcesSection = findHeadingSection(markdown, sourceHeading);
        if (sourcesSection === null) {
          return err("MISSING_REQUIRED_SECTION", "Missing section: Sources", {
            section: "Sources",
          });
        }

        const parsedSources = parseSourcesSection(sourcesSection);
        if (parsedSources.ok === false) {
          return err("MALFORMED_SOURCES", "sources section has malformed entries", {
            line: parsedSources.line,
            reason: parsedSources.reason,
          });
        }

        sources = parsedSources.count;
        if (sources > maxSources) {
          return err("TOO_MANY_SOURCES", "sources exceed max_sources", {
            max_sources: maxSources,
            sources,
          });
        }
      }

      return ok({
        perspective_id: perspectiveId,
        markdown_path: markdownPath,
        words,
        sources,
        missing_sections: [],
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path or markdown_path not found");
      return err("WRITE_FAILED", "wave output validation failed", { message: String(e) });
    }
  },
});

export const pivot_decide = tool({
  description: "Build deterministic pivot decision artifact from Wave 1 outputs",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    wave1_outputs: tool.schema.any().describe("Array of { perspective_id, output_md_path }"),
    wave1_validation_reports: tool.schema.any().describe("Array of validator success reports from deep_research_wave_output_validate"),
    explicit_gaps: tool.schema.any().optional().describe("Optional normalized explicit gaps"),
    reason: tool.schema.string().optional().describe("Optional audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    wave1_outputs: unknown;
    wave1_validation_reports: unknown;
    explicit_gaps?: unknown;
    reason?: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const pathsObj = getManifestPaths(manifest);
      const pivotFile = String(pathsObj.pivot_file ?? "pivot.json");
      const pivotPath = path.isAbsolute(pivotFile) ? pivotFile : path.join(runRoot, pivotFile);

      if (!Array.isArray(args.wave1_outputs) || !Array.isArray(args.wave1_validation_reports)) {
        return err("INVALID_ARGS", "wave1_outputs and wave1_validation_reports must be arrays");
      }
      if (args.wave1_outputs.length === 0) {
        return err("INVALID_ARGS", "wave1_outputs must contain at least one entry");
      }
      if (args.wave1_outputs.length !== args.wave1_validation_reports.length) {
        return err("INVALID_ARGS", "wave1_outputs and wave1_validation_reports length mismatch", {
          wave1_outputs: args.wave1_outputs.length,
          wave1_validation_reports: args.wave1_validation_reports.length,
        });
      }

      const seenPerspectiveIds = new Set<string>();
      const wave1Pairs: Array<{
        perspective_id: string;
        output_abs_path: string;
        output_md: string;
        validator_report: {
          ok: true;
          perspective_id: string;
          markdown_path: string;
          words: number;
          sources: number;
          missing_sections: string[];
        };
      }> = [];

      for (let i = 0; i < args.wave1_outputs.length; i += 1) {
        const outputRaw = args.wave1_outputs[i];
        const reportRaw = args.wave1_validation_reports[i];

        if (!isPlainObject(outputRaw)) {
          return err("INVALID_ARGS", "wave1_outputs entry must be object", { index: i });
        }
        if (!isPlainObject(reportRaw)) {
          return err("INVALID_ARGS", "wave1_validation_reports entry must be object", { index: i });
        }

        const perspectiveId = normalizeWhitespace(String(outputRaw.perspective_id ?? ""));
        const outputObj = isPlainObject(outputRaw) ? (outputRaw as Record<string, unknown>) : {};
        const outputMdPathRaw = normalizeWhitespace(String(outputObj.output_md_path ?? ""));
        if (!perspectiveId) {
          return err("INVALID_ARGS", "wave1_outputs perspective_id missing", { index: i });
        }
        if (!outputMdPathRaw) {
          return err("INVALID_ARGS", "wave1_outputs output_md_path missing", { index: i, perspective_id: perspectiveId });
        }
        if (seenPerspectiveIds.has(perspectiveId)) {
          return err("INVALID_ARGS", "wave1_outputs perspective_id must be unique", { perspective_id: perspectiveId });
        }
        seenPerspectiveIds.add(perspectiveId);

        if (reportRaw.ok !== true) {
          return err("WAVE1_NOT_VALIDATED", "wave1 validation report has ok=false", {
            index: i,
            perspective_id: perspectiveId,
          });
        }

        const reportPerspectiveId = normalizeWhitespace(String(reportRaw.perspective_id ?? ""));
        if (!reportPerspectiveId || reportPerspectiveId !== perspectiveId) {
          return err("MISMATCHED_PERSPECTIVE_ID", "output/report perspective mismatch", {
            index: i,
            output_perspective_id: perspectiveId,
            report_perspective_id: reportPerspectiveId,
          });
        }

        const missingSectionsRaw = reportRaw.missing_sections;
        if (!Array.isArray(missingSectionsRaw)) {
          return err("INVALID_ARGS", "validation report missing_sections must be array", {
            index: i,
            perspective_id: perspectiveId,
          });
        }
        const missingSections = missingSectionsRaw
          .map((value) => normalizeWhitespace(String(value ?? "")))
          .filter((value) => value.length > 0);
        if (missingSections.length > 0) {
          return err("WAVE1_CONTRACT_NOT_MET", "wave1 report contains missing sections", {
            perspective_id: perspectiveId,
            missing_sections: missingSections,
          });
        }

        const markdownPath = normalizeWhitespace(String(reportRaw.markdown_path ?? ""));
        if (!markdownPath) {
          return err("INVALID_ARGS", "validation report markdown_path missing", {
            index: i,
            perspective_id: perspectiveId,
          });
        }

        const words = Number(reportRaw.words ?? NaN);
        const sources = Number(reportRaw.sources ?? NaN);
        if (!Number.isFinite(words) || words < 0 || !Number.isFinite(sources) || sources < 0) {
          return err("INVALID_ARGS", "validation report words/sources invalid", {
            index: i,
            perspective_id: perspectiveId,
            words: reportRaw.words ?? null,
            sources: reportRaw.sources ?? null,
          });
        }

        const outputAbsPath = resolveRunPath(runRoot, outputMdPathRaw);
        const outputMd = normalizeOutputPathForPivotArtifact(runRoot, outputAbsPath);

        wave1Pairs.push({
          perspective_id: perspectiveId,
          output_abs_path: outputAbsPath,
          output_md: outputMd,
          validator_report: {
            ok: true,
            perspective_id: reportPerspectiveId,
            markdown_path: markdownPath,
            words: Math.floor(words),
            sources: Math.floor(sources),
            missing_sections: [],
          },
        });
      }

      let gaps: PivotGap[] = [];
      if (args.explicit_gaps !== undefined && args.explicit_gaps !== null) {
        if (!Array.isArray(args.explicit_gaps)) {
          return err("INVALID_ARGS", "explicit_gaps must be an array when provided");
        }

        if (args.explicit_gaps.length > 0) {
          const seenGapIds = new Set<string>();
          for (let i = 0; i < args.explicit_gaps.length; i += 1) {
            const entry = args.explicit_gaps[i];
            if (!isPlainObject(entry)) {
              return err("INVALID_ARGS", "explicit_gaps entry must be object", { index: i });
            }

            const gapId = normalizeWhitespace(String(entry.gap_id ?? ""));
            if (!gapId) return err("INVALID_ARGS", "explicit gap_id missing", { index: i });
            if (seenGapIds.has(gapId)) {
              return err("DUPLICATE_GAP_ID", "duplicate explicit gap_id", { gap_id: gapId });
            }
            seenGapIds.add(gapId);

            const priority = normalizeGapPriority(entry.priority);
            if (!priority) {
              return err("INVALID_GAP_PRIORITY", "gap priority must be one of P0|P1|P2|P3", {
                gap_id: gapId,
                priority: entry.priority ?? null,
              });
            }

            const text = normalizeWhitespace(String(entry.text ?? ""));
            if (!text) return err("INVALID_ARGS", "explicit gap text missing", { gap_id: gapId });

            const fromPerspectiveId = normalizeWhitespace(String(entry.from_perspective_id ?? ""));
            const gap: PivotGap = {
              gap_id: gapId,
              priority,
              text,
              tags: normalizeTagList(entry.tags),
              source: "explicit",
            };
            if (fromPerspectiveId) gap.from_perspective_id = fromPerspectiveId;
            gaps.push(gap);
          }
        }
      }

      if (gaps.length === 0 && (!Array.isArray(args.explicit_gaps) || args.explicit_gaps.length === 0)) {
        for (const pair of wave1Pairs) {
          let markdown: string;
          try {
            markdown = await fs.promises.readFile(pair.output_abs_path, "utf8");
          } catch (e) {
            if (errorCode(e) === "ENOENT") {
              return err("NOT_FOUND", "wave1 output markdown not found", {
                perspective_id: pair.perspective_id,
                output_md_path: pair.output_abs_path,
              });
            }
            throw e;
          }

          const extracted = extractPivotGapsFromMarkdown(markdown, pair.perspective_id);
          if ("code" in extracted) {
            return err(extracted.code, extracted.message, extracted.details);
          }
          gaps.push(...extracted.gaps);
        }
      }

      gaps = gaps.sort((a, b) => {
        const byPriority = compareGapPriority(a.priority, b.priority);
        if (byPriority !== 0) return byPriority;
        return a.gap_id.localeCompare(b.gap_id);
      });

      const p0Count = gaps.filter((gap) => gap.priority === "P0").length;
      const p1Count = gaps.filter((gap) => gap.priority === "P1").length;
      const p2Count = gaps.filter((gap) => gap.priority === "P2").length;
      const p3Count = gaps.filter((gap) => gap.priority === "P3").length;
      const totalGaps = gaps.length;

      let wave2Required = false;
      let ruleHit = "Wave2Skip.NoGaps";
      let explanation = "Wave 2 skipped because total_gaps=0 (rule Wave2Skip.NoGaps).";

      if (p0Count >= 1) {
        wave2Required = true;
        ruleHit = "Wave2Required.P0";
        explanation = `Wave 2 required because p0_count=${p0Count} (rule Wave2Required.P0).`;
      } else if (p1Count >= 2) {
        wave2Required = true;
        ruleHit = "Wave2Required.P1";
        explanation = `Wave 2 required because p1_count=${p1Count} (rule Wave2Required.P1).`;
      } else if (totalGaps >= 4 && (p1Count + p2Count) >= 3) {
        wave2Required = true;
        ruleHit = "Wave2Required.Volume";
        explanation = `Wave 2 required because total_gaps=${totalGaps} and p1_count+p2_count=${p1Count + p2Count} (rule Wave2Required.Volume).`;
      } else {
        wave2Required = false;
        ruleHit = "Wave2Skip.NoGaps";
        explanation = `Wave 2 skipped because total_gaps=${totalGaps} (rule Wave2Skip.NoGaps).`;
      }

      let wave2GapIds: string[] = [];
      if (wave2Required) {
        wave2GapIds = gaps
          .filter((gap) => gap.priority === "P0" || gap.priority === "P1")
          .map((gap) => gap.gap_id);
        if (wave2GapIds.length === 0) {
          wave2GapIds = gaps.slice(0, 3).map((gap) => gap.gap_id);
        }
      }

      const sortedWave1 = [...wave1Pairs].sort((a, b) => a.perspective_id.localeCompare(b.perspective_id));
      const wave1Outputs = sortedWave1.map((entry) => ({
        perspective_id: entry.perspective_id,
        output_md: entry.output_md,
        validator_report: entry.validator_report,
      }));

      const normalizedGapsForDigest = gaps.map((gap) => {
        const out: Record<string, unknown> = {
          gap_id: gap.gap_id,
          priority: gap.priority,
          text: gap.text,
          tags: gap.tags,
          source: gap.source,
        };
        if (gap.from_perspective_id) out.from_perspective_id = gap.from_perspective_id;
        return out;
      });

      const inputsDigest = sha256DigestForJson({
        wave1_validation_reports: wave1Outputs.map((entry) => entry.validator_report),
        gaps: normalizedGapsForDigest,
      });

      const generatedAt = nowIso();
      const pivotDecision = {
        schema_version: "pivot_decision.v1",
        run_id: runId,
        generated_at: generatedAt,
        inputs_digest: inputsDigest,
        wave1: {
          outputs: wave1Outputs,
        },
        gaps: normalizedGapsForDigest,
        decision: {
          wave2_required: wave2Required,
          rule_hit: ruleHit,
          metrics: {
            p0_count: p0Count,
            p1_count: p1Count,
            p2_count: p2Count,
            p3_count: p3Count,
            total_gaps: totalGaps,
          },
          explanation,
          wave2_gap_ids: wave2GapIds,
        },
      };

      await atomicWriteJson(pivotPath, pivotDecision);

      const reason = normalizeWhitespace(String(args.reason ?? ""));
      let auditWritten = false;
      if (reason) {
        try {
          await appendAuditJsonl({
            runRoot,
            event: {
              ts: generatedAt,
              kind: "pivot_decide",
              run_id: runId,
              reason,
              pivot_path: pivotPath,
              wave2_required: wave2Required,
              rule_hit: ruleHit,
              inputs_digest: inputsDigest,
            },
          });
          auditWritten = true;
        } catch {
          auditWritten = false;
        }
      }

      return ok({
        pivot_path: pivotPath,
        wave2_required: wave2Required,
        rule_hit: ruleHit,
        inputs_digest: inputsDigest,
        total_gaps: totalGaps,
        audit_written: auditWritten,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact not found");
      return err("WRITE_FAILED", "pivot_decide failed", { message: String(e) });
    }
  },
});

export const wave_review = tool({
  description: "Deterministic offline aggregation for wave output reviewer enforcement",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json (perspectives.v1)"),
    outputs_dir: tool.schema.string().describe("Absolute directory containing <perspective_id>.md outputs"),
    perspective_ids: tool.schema.any().optional().describe("Optional subset of perspective ids to validate"),
    max_failures: tool.schema.number().optional().describe("Retry/report cap (1..500), defaults to 25"),
    report_path: tool.schema.string().optional().describe("Optional absolute path to write JSON report"),
  },
  async execute(args: {
    perspectives_path: string;
    outputs_dir: string;
    perspective_ids?: unknown;
    max_failures?: number;
    report_path?: string;
  }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const outputsDir = args.outputs_dir.trim();
      const reportPath = (args.report_path ?? "").trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }

      if (!outputsDir) return err("INVALID_ARGS", "outputs_dir must be non-empty");
      if (!path.isAbsolute(outputsDir)) {
        return err("INVALID_ARGS", "outputs_dir must be absolute", { outputs_dir: args.outputs_dir });
      }

      if (reportPath && !path.isAbsolute(reportPath)) {
        return err("INVALID_ARGS", "report_path must be absolute", { report_path: args.report_path });
      }

      const maxFailuresRaw = args.max_failures ?? 25;
      if (!isInteger(maxFailuresRaw) || maxFailuresRaw < 1 || maxFailuresRaw > 500) {
        return err("INVALID_ARGS", "max_failures must be an integer in range 1..500", {
          max_failures: args.max_failures ?? null,
        });
      }
      const maxFailures = maxFailuresRaw;

      const outputsDirStat = await statPath(outputsDir);
      if (!outputsDirStat || !outputsDirStat.isDirectory()) {
        return err("NOT_FOUND", "outputs_dir not found or not a directory", { outputs_dir: outputsDir });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "perspectives_path contains invalid JSON", { perspectives_path: perspectivesPath });
        throw e;
      }

      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const perspectives = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? []);
      const perspectiveMap = new Map<string, Record<string, unknown>>();
      for (const perspective of perspectives) {
        perspectiveMap.set(String(perspective.id ?? ""), perspective);
      }

      let selectedPerspectiveIds: string[];
      if (args.perspective_ids !== undefined) {
        if (!Array.isArray(args.perspective_ids)) {
          return err("INVALID_ARGS", "perspective_ids must be an array when provided", {
            perspective_ids: args.perspective_ids,
          });
        }

        const cleanedIds = args.perspective_ids.map((value) => String(value ?? "").trim());
        if (cleanedIds.some((value) => value.length === 0)) {
          return err("INVALID_ARGS", "perspective_ids must contain non-empty strings", {
            perspective_ids: args.perspective_ids,
          });
        }

        const uniqueSortedIds = Array.from(new Set(cleanedIds)).sort((a, b) => a.localeCompare(b));
        for (const perspectiveId of uniqueSortedIds) {
          if (!perspectiveMap.has(perspectiveId)) {
            return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
              perspective_id: perspectiveId,
            });
          }
        }
        selectedPerspectiveIds = uniqueSortedIds;
      } else {
        selectedPerspectiveIds = Array.from(perspectiveMap.keys()).sort((a, b) => a.localeCompare(b));
      }

      const results: Array<{
        perspective_id: string;
        markdown_path: string;
        pass: boolean;
        metrics: { words: number; sources: number; missing_sections: string[] };
        failure: { code: string; message: string; details: Record<string, unknown> } | null;
      }> = [];

      const failedResults: Array<{
        perspective_id: string;
        failure: { code: string; message: string; details: Record<string, unknown> };
      }> = [];

      for (const perspectiveId of selectedPerspectiveIds) {
        const perspective = perspectiveMap.get(perspectiveId);
        if (!perspective) {
          return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
            perspective_id: perspectiveId,
          });
        }
        const markdownPath = path.join(outputsDir, `${perspectiveId}.md`);
        const markdownStat = await statPath(markdownPath);
        if (!markdownStat || !markdownStat.isFile()) {
          return err("OUTPUT_NOT_FOUND", "expected markdown output missing", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
          });
        }

        const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
        const requiredSections = Array.isArray(contract.must_include_sections)
          ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
          : [];

        const metrics = await collectWaveReviewMetrics({
          markdownPath,
          requiredSections,
        });

        const validationRaw = (await (wave_output_validate as unknown as ToolWithExecute).execute({
          perspectives_path: perspectivesPath,
          perspective_id: perspectiveId,
          markdown_path: markdownPath,
        })) as string;
        const validationParsed = parseJsonSafe(validationRaw);

        if (!validationParsed.ok) {
          return err("WRITE_FAILED", "wave_output_validate returned non-JSON", {
            perspective_id: perspectiveId,
            raw: validationParsed.value,
          });
        }

        const validationObj = validationParsed.value as Record<string, unknown>;
        if (validationObj.ok === true) {
          results.push({
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
            pass: true,
            metrics,
            failure: null,
          });
          continue;
        }

        const failure = toFailureShape(validationObj.error);
        if (failure.code === "NOT_FOUND") {
          return err("OUTPUT_NOT_FOUND", "expected markdown output missing", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
          });
        }

        if (failure.code === "PERSPECTIVE_NOT_FOUND") {
          return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
            perspective_id: perspectiveId,
          });
        }

        results.push({
          perspective_id: perspectiveId,
          markdown_path: markdownPath,
          pass: false,
          metrics,
          failure,
        });
        failedResults.push({
          perspective_id: perspectiveId,
          failure,
        });
      }

      const retryDirectives = failedResults.slice(0, maxFailures).map(({ perspective_id, failure }) => ({
        perspective_id,
        action: "retry",
        change_note: buildRetryChangeNote(failure),
        blocking_error_code: failure.code,
      }));

      const failuresSample = failedResults.slice(0, maxFailures).map((entry) => entry.perspective_id);
      const failedCount = failedResults.length;
      const validatedCount = selectedPerspectiveIds.length;
      const reportNotes = failedCount === 0
        ? "All perspectives passed wave output contract validation."
        : `${failedCount}/${validatedCount} perspectives failed contract validation; retry directives emitted.`;

      const payload = {
        ok: true,
        pass: failedCount === 0,
        perspectives_path: perspectivesPath,
        outputs_dir: outputsDir,
        validated: validatedCount,
        failed: failedCount,
        results,
        retry_directives: retryDirectives,
        report: {
          failures_sample: failuresSample,
          failures_omitted: Math.max(0, failedCount - failuresSample.length),
          notes: truncateMessage(reportNotes),
        },
        report_path: reportPath || null,
      };

      if (reportPath) {
        try {
          await atomicWriteJson(reportPath, payload);
        } catch (e) {
          return err("WRITE_FAILED", "failed to write report_path", {
            report_path: reportPath,
            message: String(e),
          });
        }
      }

      return JSON.stringify(payload, null, 2);
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path or outputs_dir not found");
      return err("WRITE_FAILED", "wave review failed", { message: String(e) });
    }
  },
});

export const citations_extract_urls = tool({
  description: "Extract candidate citation URLs from wave markdown",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    include_wave2: tool.schema.boolean().optional().describe("Whether to include wave-2 artifacts (default true)"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute output path for extracted-urls.txt"),
    found_by_path: tool.schema.string().optional().describe("Absolute output path for found-by.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    include_wave2?: boolean;
    extracted_urls_path?: string;
    found_by_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const pathsObj = getManifestPaths(manifest);

      const wave1DirName = String(pathsObj.wave1_dir ?? "wave-1");
      const wave2DirName = String(pathsObj.wave2_dir ?? "wave-2");
      const defaultExtractedPath = path.join(runRoot, "citations", "extracted-urls.txt");
      const defaultFoundByPath = path.join(runRoot, "citations", "found-by.json");

      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || defaultExtractedPath;
      const foundByPath = (args.found_by_path ?? "").trim() || defaultFoundByPath;
      if (!path.isAbsolute(extractedUrlsPath)) {
        return err("INVALID_ARGS", "extracted_urls_path must be absolute", { extracted_urls_path: args.extracted_urls_path ?? null });
      }
      if (!path.isAbsolute(foundByPath)) {
        return err("INVALID_ARGS", "found_by_path must be absolute", { found_by_path: args.found_by_path ?? null });
      }

      const includeWave2 = args.include_wave2 ?? true;
      const wave1Dir = path.join(runRoot, wave1DirName);
      const wave2Dir = path.join(runRoot, wave2DirName);

      const wave1Stat = await statPath(wave1Dir);
      if (!wave1Stat?.isDirectory()) {
        return err("NOT_FOUND", "wave dir missing", { wave_dir: wave1DirName, path: wave1Dir });
      }

      const scanTargets: Array<{ wave: "wave-1" | "wave-2"; dir: string }> = [{ wave: "wave-1", dir: wave1Dir }];
      if (includeWave2) {
        const wave2Stat = await statPath(wave2Dir);
        if (wave2Stat?.isDirectory()) scanTargets.push({ wave: "wave-2", dir: wave2Dir });
      }

      const scannedFiles: Array<{ wave: "wave-1" | "wave-2"; abs: string }> = [];
      for (const target of scanTargets) {
        const files = await listMarkdownFilesRecursive(target.dir);
        for (const file of files) scannedFiles.push({ wave: target.wave, abs: file });
      }
      scannedFiles.sort((a, b) => a.abs.localeCompare(b.abs));

      const extractedAll: string[] = [];
      const foundByItems: Array<{
        url_original: string;
        wave: "wave-1" | "wave-2";
        perspective_id: string;
        source_line: string;
        ordinal: number;
      }> = [];

      for (const file of scannedFiles) {
        const markdown = await fs.promises.readFile(file.abs, "utf8");
        const section = findHeadingSection(markdown, "Sources");
        if (section === null) continue;

        const perspectiveId = path.basename(file.abs, path.extname(file.abs));
        const lines = section.split(/\r?\n/);
        let ordinal = 0;
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const urls = extractHttpUrlsFromLine(line);
          for (const url of urls) {
            ordinal += 1;
            extractedAll.push(url);
            foundByItems.push({
              url_original: url,
              wave: file.wave,
              perspective_id: perspectiveId,
              source_line: line,
              ordinal,
            });
          }
        }
      }

      const uniqueUrls = Array.from(new Set(extractedAll)).sort((a, b) => a.localeCompare(b));

      const boundedByUrl = new Map<string, typeof foundByItems>();
      for (const item of foundByItems) {
        const list = boundedByUrl.get(item.url_original) ?? [];
        if (list.length < 20) list.push(item);
        boundedByUrl.set(item.url_original, list);
      }

      const foundBySorted = Array.from(boundedByUrl.entries())
        .flatMap(([, items]) => items)
        .sort((a, b) => {
          const byUrl = a.url_original.localeCompare(b.url_original);
          if (byUrl !== 0) return byUrl;
          const byWave = a.wave.localeCompare(b.wave);
          if (byWave !== 0) return byWave;
          const byPerspective = a.perspective_id.localeCompare(b.perspective_id);
          if (byPerspective !== 0) return byPerspective;
          return a.ordinal - b.ordinal;
        });

      const extractedText = uniqueUrls.length > 0 ? `${uniqueUrls.join("\n")}\n` : "";
      const foundByDoc = {
        schema_version: "found_by.v1",
        run_id: runId,
        items: foundBySorted,
      };

      const inputsDigest = sha256DigestForJson({
        schema: "citations_extract_urls.inputs.v1",
        run_id: runId,
        include_wave2: includeWave2,
        run_root: runRoot,
        wave1_dir: wave1DirName,
        wave2_dir: wave2DirName,
        scanned_files: scannedFiles.map((entry) => toPosixPath(path.relative(runRoot, entry.abs))),
      });

      try {
        await atomicWriteText(extractedUrlsPath, extractedText);
        await atomicWriteJson(foundByPath, foundByDoc);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write output artifacts", {
          extracted_urls_path: extractedUrlsPath,
          found_by_path: foundByPath,
          message: String(e),
        });
      }

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_extract_urls",
            run_id: runId,
            reason,
            extracted_urls_path: extractedUrlsPath,
            found_by_path: foundByPath,
            total_found: extractedAll.length,
            unique_found: uniqueUrls.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        extracted_urls_path: extractedUrlsPath,
        found_by_path: foundByPath,
        total_found: extractedAll.length,
        unique_found: uniqueUrls.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact missing");
      return err("WRITE_FAILED", "citations_extract_urls failed", { message: String(e) });
    }
  },
});

export const citations_normalize = tool({
  description: "Normalize extracted URLs and compute deterministic cids",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute path to extracted-urls.txt"),
    normalized_urls_path: tool.schema.string().optional().describe("Absolute output path for normalized-urls.txt"),
    url_map_path: tool.schema.string().optional().describe("Absolute output path for url-map.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    extracted_urls_path?: string;
    normalized_urls_path?: string;
    url_map_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || path.join(runRoot, "citations", "extracted-urls.txt");
      const normalizedUrlsPath = (args.normalized_urls_path ?? "").trim() || path.join(runRoot, "citations", "normalized-urls.txt");
      const urlMapPath = (args.url_map_path ?? "").trim() || path.join(runRoot, "citations", "url-map.json");

      for (const [name, p] of [
        ["extracted_urls_path", extractedUrlsPath],
        ["normalized_urls_path", normalizedUrlsPath],
        ["url_map_path", urlMapPath],
      ] as const) {
        if (!path.isAbsolute(p)) return err("INVALID_ARGS", `${name} must be absolute`, { [name]: p });
      }

      let extractedRaw: string;
      try {
        extractedRaw = await fs.promises.readFile(extractedUrlsPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "extracted urls missing", { extracted_urls_path: extractedUrlsPath });
        throw e;
      }

      const extractedUrls = extractedRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const uniqueOriginalUrls = Array.from(new Set(extractedUrls)).sort((a, b) => a.localeCompare(b));
      const urlMapItems: Array<{ url_original: string; normalized_url: string; cid: string }> = [];

      for (const urlOriginal of uniqueOriginalUrls) {
        const normalized = normalizeCitationUrl(urlOriginal);
        if ("normalized_url" in normalized) {
          urlMapItems.push({
            url_original: urlOriginal,
            normalized_url: normalized.normalized_url,
            cid: citationCid(normalized.normalized_url),
          });
          continue;
        }

        return err("SCHEMA_VALIDATION_FAILED", normalized.message, {
          url_original: urlOriginal,
          ...normalized.details,
        });
      }

      urlMapItems.sort((a, b) => {
        const byNormalized = a.normalized_url.localeCompare(b.normalized_url);
        if (byNormalized !== 0) return byNormalized;
        return a.url_original.localeCompare(b.url_original);
      });

      const normalizedUrls = Array.from(new Set(urlMapItems.map((item) => item.normalized_url))).sort((a, b) => a.localeCompare(b));
      const normalizedText = normalizedUrls.length > 0 ? `${normalizedUrls.join("\n")}\n` : "";
      const urlMapDoc = {
        schema_version: "url_map.v1",
        run_id: runId,
        items: urlMapItems,
      };

      const inputsDigest = sha256DigestForJson({
        schema: "citations_normalize.inputs.v1",
        run_id: runId,
        extracted_urls: uniqueOriginalUrls,
      });

      try {
        await atomicWriteText(normalizedUrlsPath, normalizedText);
        await atomicWriteJson(urlMapPath, urlMapDoc);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write output artifacts", {
          normalized_urls_path: normalizedUrlsPath,
          url_map_path: urlMapPath,
          message: String(e),
        });
      }

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_normalize",
            run_id: runId,
            reason,
            normalized_urls_path: normalizedUrlsPath,
            url_map_path: urlMapPath,
            unique_normalized: normalizedUrls.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        normalized_urls_path: normalizedUrlsPath,
        url_map_path: urlMapPath,
        unique_normalized: normalizedUrls.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required artifact missing");
      return err("WRITE_FAILED", "citations_normalize failed", { message: String(e) });
    }
  },
});

export const citations_validate = tool({
  description: "Validate normalized URLs into citations.jsonl records",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    url_map_path: tool.schema.string().optional().describe("Absolute path to url-map.json"),
    citations_path: tool.schema.string().optional().describe("Absolute output path for citations.jsonl"),
    offline_fixtures_path: tool.schema.string().optional().describe("Absolute JSON fixtures path for offline mode"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    url_map_path?: string;
    citations_path?: string;
    offline_fixtures_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const noWebRaw = process.env.PAI_DR_NO_WEB;
      const noWebParsed = noWebRaw === undefined ? false : parseBool(noWebRaw);
      if (noWebRaw !== undefined && noWebParsed === null) {
        return err("INVALID_ARGS", "PAI_DR_NO_WEB must be boolean-like (0/1/true/false)", {
          PAI_DR_NO_WEB: noWebRaw,
        });
      }
      const mode: "offline" | "online" = noWebParsed === true ? "offline" : "online";

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const checkedAt = isNonEmptyString(manifest.updated_at) ? String(manifest.updated_at) : nowIso();

      const urlMapPath = (args.url_map_path ?? "").trim() || path.join(runRoot, "citations", "url-map.json");
      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const offlineFixturesPath = (args.offline_fixtures_path ?? "").trim();

      if (!path.isAbsolute(urlMapPath)) return err("INVALID_ARGS", "url_map_path must be absolute", { url_map_path: args.url_map_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (offlineFixturesPath && !path.isAbsolute(offlineFixturesPath)) {
        return err("INVALID_ARGS", "offline_fixtures_path must be absolute", { offline_fixtures_path: args.offline_fixtures_path });
      }
      if (mode === "offline" && !offlineFixturesPath) {
        return err("INVALID_ARGS", "offline_fixtures_path required in OFFLINE mode", {
          mode,
          PAI_DR_NO_WEB: noWebRaw ?? null,
        });
      }

      let urlMapRaw: unknown;
      try {
        urlMapRaw = await readJson(urlMapPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { url_map_path: urlMapPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "url-map unreadable JSON", { url_map_path: urlMapPath });
        throw e;
      }

      const urlMapValidation = validateUrlMapV1(urlMapRaw, runId);
      if (!("items" in urlMapValidation)) {
        return err("SCHEMA_VALIDATION_FAILED", urlMapValidation.message, urlMapValidation.details);
      }

      const urlMapItemsSorted = [...urlMapValidation.items].sort((a, b) => {
        const byNormalized = a.normalized_url.localeCompare(b.normalized_url);
        if (byNormalized !== 0) return byNormalized;
        return a.url_original.localeCompare(b.url_original);
      });

      const urlMapItemsByNormalized = new Map<string, UrlMapItemV1>();
      const normalizedToOriginals = new Map<string, string[]>();
      for (const item of urlMapItemsSorted) {
        if (!urlMapItemsByNormalized.has(item.normalized_url)) {
          urlMapItemsByNormalized.set(item.normalized_url, item);
        }
        const originals = normalizedToOriginals.get(item.normalized_url) ?? [];
        originals.push(item.url_original);
        normalizedToOriginals.set(item.normalized_url, originals);
      }
      const urlMapItems = Array.from(urlMapItemsByNormalized.values()).sort((a, b) => a.normalized_url.localeCompare(b.normalized_url));

      let fixtureLookup: OfflineFixtureLookup = emptyOfflineFixtureLookup();
      if (mode === "offline") {
        let fixtureRaw: unknown;
        try {
          fixtureRaw = await readJson(offlineFixturesPath);
        } catch (e) {
          if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "offline_fixtures_path missing", { offline_fixtures_path: offlineFixturesPath });
          if (e instanceof SyntaxError) return err("INVALID_JSON", "offline fixtures unreadable JSON", { offline_fixtures_path: offlineFixturesPath });
          throw e;
        }

        const fixtureResult = buildOfflineFixtureLookup(fixtureRaw);
        if ("lookup" in fixtureResult) {
          fixtureLookup = fixtureResult.lookup;
        } else {
          return err("SCHEMA_VALIDATION_FAILED", fixtureResult.message, fixtureResult.details);
        }
      }

      const foundByPath = path.join(runRoot, "citations", "found-by.json");
      const foundByLookup = await readFoundByLookup(foundByPath);

      const records: Array<Record<string, unknown>> = [];
      for (const item of urlMapItems) {
        const fixture = mode === "offline" ? findFixtureForUrlMapItem(fixtureLookup, item) : null;

        let status: CitationStatus;
        let notes: string;
        let urlValue = fixture?.url?.trim() || item.normalized_url;
        let httpStatus: number | undefined;
        let title: string | undefined;
        let publisher: string | undefined;
        let evidenceSnippet: string | undefined;

        if (mode === "offline") {
          if (!fixture) {
            status = "invalid";
            notes = "offline fixture not found for normalized_url";
          } else {
            status = isCitationStatus(fixture.status) ? fixture.status : "invalid";
            notes = fixture.notes?.trim() || (status === "valid" ? "ok" : `offline fixture status=${status}`);
            if (typeof fixture.http_status === "number" && Number.isFinite(fixture.http_status)) {
              httpStatus = Math.trunc(fixture.http_status);
            }
            if (isNonEmptyString(fixture.title)) title = fixture.title;
            if (isNonEmptyString(fixture.publisher)) publisher = fixture.publisher;
            if (isNonEmptyString(fixture.evidence_snippet)) evidenceSnippet = fixture.evidence_snippet;
          }
        } else {
          const onlineStub = classifyOnlineStub(item.normalized_url);
          status = onlineStub.status;
          notes = onlineStub.notes;
          urlValue = onlineStub.url;
          // Placeholder ladder contract (no network in this implementation):
          // 1) direct fetch, 2) bright-data progressive scrape, 3) apify/rag-web-browser.
        }

        const redactedOriginal = redactSensitiveUrl(item.url_original);
        const redactedUrl = redactSensitiveUrl(urlValue);
        if (redactedOriginal.hadUserinfo || redactedUrl.hadUserinfo) {
          status = "invalid";
          notes = appendNote(notes, "userinfo stripped; marked invalid per redaction policy");
        }

        const originalsForNormalized = normalizedToOriginals.get(item.normalized_url) ?? [item.url_original];
        const foundBy = originalsForNormalized
          .flatMap((urlOriginal) => foundByLookup.get(urlOriginal) ?? []);
        const record: Record<string, unknown> = {
          schema_version: "citation.v1",
          normalized_url: item.normalized_url,
          cid: item.cid,
          url: redactedUrl.value,
          url_original: redactedOriginal.value,
          status,
          checked_at: checkedAt,
          found_by: foundBy,
          notes,
        };
        if (httpStatus !== undefined) record.http_status = httpStatus;
        if (title) record.title = title;
        if (publisher) record.publisher = publisher;
        if (evidenceSnippet) record.evidence_snippet = evidenceSnippet;
        records.push(record);
      }

      records.sort((a, b) => {
        const an = String(a.normalized_url ?? "");
        const bn = String(b.normalized_url ?? "");
        const byNormalized = an.localeCompare(bn);
        if (byNormalized !== 0) return byNormalized;
        return String(a.url_original ?? "").localeCompare(String(b.url_original ?? ""));
      });

      const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
      const payload = jsonl.length > 0 ? `${jsonl}\n` : "";

      try {
        await atomicWriteText(citationsPath, payload);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write citations.jsonl", {
          citations_path: citationsPath,
          message: String(e),
        });
      }

      const inputsDigest = sha256DigestForJson({
        schema: "citations_validate.inputs.v1",
        run_id: runId,
        mode,
        url_map: urlMapItems,
        fixture_digest: mode === "offline" ? fixtureLookup.fixtureDigest : null,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_validate",
            run_id: runId,
            reason,
            mode,
            citations_path: citationsPath,
            validated: records.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        run_id: runId,
        citations_path: citationsPath,
        mode,
        validated: records.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "citations_validate failed", { message: String(e) });
    }
  },
});

export const gate_c_compute = tool({
  description: "Compute deterministic Gate C metrics from citation artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    extracted_urls_path: tool.schema.string().optional().describe("Absolute path to extracted-urls.txt"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    citations_path?: string;
    extracted_urls_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const extractedUrlsPath = (args.extracted_urls_path ?? "").trim() || path.join(runRoot, "citations", "extracted-urls.txt");
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(extractedUrlsPath)) {
        return err("INVALID_ARGS", "extracted_urls_path must be absolute", { extracted_urls_path: args.extracted_urls_path ?? null });
      }

      let extractedRaw: string;
      try {
        extractedRaw = await fs.promises.readFile(extractedUrlsPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { extracted_urls_path: extractedUrlsPath });
        throw e;
      }

      const extractedOriginal = extractedRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const normalizedExtractedSet = new Set<string>();
      for (const urlOriginal of extractedOriginal) {
        const normalized = normalizeCitationUrl(urlOriginal);
        if ("normalized_url" in normalized) {
          normalizedExtractedSet.add(normalized.normalized_url);
        } else {
          return err("SCHEMA_VALIDATION_FAILED", "failed to normalize extracted URL", {
            url_original: urlOriginal,
            ...normalized.details,
          });
        }
      }
      const normalizedExtracted = Array.from(normalizedExtractedSet).sort((a, b) => a.localeCompare(b));

      let citationRecords: Array<Record<string, unknown>>;
      try {
        citationRecords = await readJsonlObjects(citationsPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing", { citations_path: citationsPath });
        if (e instanceof SyntaxError) return err("INVALID_JSONL", "citations.jsonl malformed", { citations_path: citationsPath, message: String(e) });
        throw e;
      }

      const statusByNormalized = new Map<string, string>();
      for (const record of citationRecords) {
        const normalizedUrl = String(record.normalized_url ?? "").trim();
        const status = String(record.status ?? "").trim();
        if (!normalizedUrl) return err("SCHEMA_VALIDATION_FAILED", "citation record missing normalized_url", { record });
        if (!status) return err("SCHEMA_VALIDATION_FAILED", "citation record missing status", { normalized_url: normalizedUrl });
        if (statusByNormalized.has(normalizedUrl)) {
          return err("SCHEMA_VALIDATION_FAILED", "duplicate normalized_url in citations.jsonl", {
            normalized_url: normalizedUrl,
          });
        }
        statusByNormalized.set(normalizedUrl, status);
      }

      const denominator = normalizedExtracted.length;
      let validatedCount = 0;
      let invalidCount = 0;
      let uncategorizedCount = 0;

      for (const normalizedUrl of normalizedExtracted) {
        const status = statusByNormalized.get(normalizedUrl);
        if (status === "valid" || status === "paywalled") {
          validatedCount += 1;
        } else if (status === "invalid" || status === "blocked" || status === "mismatch") {
          invalidCount += 1;
        } else {
          uncategorizedCount += 1;
        }
      }

      const rate = (num: number, den: number) => (den <= 0 ? 0 : Number((num / den).toFixed(6)));
      const metrics = {
        validated_url_rate: rate(validatedCount, denominator),
        invalid_url_rate: rate(invalidCount, denominator),
        uncategorized_url_rate: rate(uncategorizedCount, denominator),
      };

      const warnings: string[] = [];
      if (denominator <= 0) warnings.push("NO_URLS_EXTRACTED");

      const pass = denominator > 0
        && metrics.validated_url_rate >= 0.9
        && metrics.invalid_url_rate <= 0.1
        && metrics.uncategorized_url_rate === 0;
      const status: "pass" | "fail" = pass ? "pass" : "fail";

      const notes = denominator <= 0
        ? "Gate C failed: NO_URLS_EXTRACTED"
        : `Gate C ${status}: ${validatedCount}/${denominator} validated, ${invalidCount} invalid, ${uncategorizedCount} uncategorized.`;

      const checkedAt = nowIso();
      const update = {
        C: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, citationsPath)),
            toPosixPath(path.relative(runRoot, extractedUrlsPath)),
          ],
          warnings,
          notes,
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_c_compute.inputs.v1",
        extracted_set: normalizedExtracted,
        citations_set: Array.from(statusByNormalized.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([normalized_url, s]) => ({ normalized_url, status: s })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_c_compute",
            run_id: String(manifest.run_id ?? ""),
            reason,
            status,
            metrics,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "C",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "gate_c_compute failed", { message: String(e) });
    }
  },
});

export const citations_render_md = tool({
  description: "Render deterministic validated-citations markdown report",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    output_md_path: tool.schema.string().optional().describe("Absolute output markdown path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    citations_path?: string;
    output_md_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      const citationsPath = (args.citations_path ?? "").trim() || path.join(runRoot, "citations", "citations.jsonl");
      const outputMdPath = (args.output_md_path ?? "").trim() || path.join(runRoot, "citations", "validated-citations.md");
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(outputMdPath)) return err("INVALID_ARGS", "output_md_path must be absolute", { output_md_path: args.output_md_path ?? null });

      let records: Array<Record<string, unknown>>;
      try {
        records = await readJsonlObjects(citationsPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "citations.jsonl missing", { citations_path: citationsPath });
        if (e instanceof SyntaxError) return err("INVALID_JSONL", "citations.jsonl malformed", { citations_path: citationsPath, message: String(e) });
        throw e;
      }

      records.sort((a, b) => {
        const an = String(a.normalized_url ?? "");
        const bn = String(b.normalized_url ?? "");
        const byNormalized = an.localeCompare(bn);
        if (byNormalized !== 0) return byNormalized;
        return String(a.cid ?? "").localeCompare(String(b.cid ?? ""));
      });

      const lines: string[] = [
        "# Validated Citations",
        "",
        `Run ID: ${runId}`,
        `Rendered: ${records.length}`,
        "",
      ];

      for (const record of records) {
        const cid = String(record.cid ?? "").trim();
        const url = String(record.url ?? "").trim();
        const status = String(record.status ?? "").trim();

        lines.push(`## ${cid || "(missing-cid)"}`);
        lines.push(`- URL: ${url || "(missing-url)"}`);
        lines.push(`- Status: ${status || "(missing-status)"}`);

        const title = String(record.title ?? "").trim();
        const publisher = String(record.publisher ?? "").trim();
        if (title) lines.push(`- Title: ${title}`);
        if (publisher) lines.push(`- Publisher: ${publisher}`);
        lines.push("");
      }

      const markdown = `${lines.join("\n")}\n`;
      try {
        await atomicWriteText(outputMdPath, markdown);
      } catch (e) {
        return err("WRITE_FAILED", "cannot write validated-citations.md", {
          output_md_path: outputMdPath,
          message: String(e),
        });
      }

      const inputsDigest = sha256DigestForJson({
        schema: "citations_render_md.inputs.v1",
        run_id: runId,
        records: records.map((record) => ({
          normalized_url: String(record.normalized_url ?? ""),
          cid: String(record.cid ?? ""),
          url: String(record.url ?? ""),
          status: String(record.status ?? ""),
          title: String(record.title ?? ""),
          publisher: String(record.publisher ?? ""),
        })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "citations_render_md",
            run_id: runId,
            reason,
            output_md_path: outputMdPath,
            rendered: records.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        output_md_path: outputMdPath,
        rendered: records.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      return err("WRITE_FAILED", "citations_render_md failed", { message: String(e) });
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
  async execute(args: { manifest_path: string; gates_path: string; requested_next?: string; reason: string }) {
    try {
      const manifestRaw = await readJson(args.manifest_path);
      const gatesRaw = await readJson(args.gates_path);

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const gatesDoc = gatesRaw as Record<string, unknown>;

      const stageObj = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const from = String(stageObj.current ?? "");
      const allowedStages = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"] as const;
      if (!from || !allowedStages.includes(from as (typeof allowedStages)[number])) {
        return err("INVALID_STATE", "stage not recognized", { stage: from });
      }

      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const paths = getManifestPaths(manifest);
      const wave1Dir = String(paths.wave1_dir ?? "wave-1");
      const wave2Dir = String(paths.wave2_dir ?? "wave-2");
      const citationsDir = String(paths.citations_dir ?? "citations");
      const _summariesDir = String(paths.summaries_dir ?? "summaries");
      const synthesisDir = String(paths.synthesis_dir ?? "synthesis");
      const perspectivesFile = String(paths.perspectives_file ?? "perspectives.json");
      const pivotFile = String(paths.pivot_file ?? "pivot.json");
      const summaryPackFile = String(paths.summary_pack_file ?? "summaries/summary-pack.json");

      const gates = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
      const gatesRevision = Number(gatesDoc.revision ?? 0);

      const evaluated: Array<{ kind: string; name: string; ok: boolean; details: Record<string, unknown> }> = [];

      const evalArtifact = async (name: string, absPath: string) => {
        const okv = await exists(absPath);
        evaluated.push({ kind: "artifact", name, ok: okv, details: { path: absPath } });
        return okv;
      };

      const evalGatePass = (gateId: string) => {
        const gate = isPlainObject(gates[gateId]) ? (gates[gateId] as Record<string, unknown>) : null;
        const status = gate ? gate.status : undefined;
        const okv = status === "pass";
        evaluated.push({ kind: "gate", name: `Gate ${gateId}`, ok: okv, details: { gate: gateId, status: status ?? null } });
        return okv;
      };

      const evalDirHasFiles = async (name: string, absDir: string) => {
        let okv = false;
        let count = 0;
        try {
          const entries = await fs.promises.readdir(absDir);
          const filtered = entries.filter((x) => !x.startsWith("."));
          count = filtered.length;
          okv = count > 0;
        } catch {
          okv = false;
        }
        evaluated.push({ kind: "artifact", name, ok: okv, details: { path: absDir, count } });
        return okv;
      };

      const parsePivotRunWave2 = async (): Promise<{ ok: boolean; run_wave2: boolean; error?: string }> => {
          const p = path.join(runRoot, pivotFile);
          if (!(await exists(p))) {
            return { ok: false, run_wave2: false, error: "pivot.json missing" };
          }
          try {
            const raw = await fs.promises.readFile(p, "utf8");
            const v = JSON.parse(raw);
            if (!v || typeof v !== "object") return { ok: false, run_wave2: false, error: "pivot not object" };
            const vObj = isPlainObject(v) ? (v as Record<string, unknown>) : null;
            const decisionObj = vObj && isPlainObject(vObj.decision) ? (vObj.decision as Record<string, unknown>) : null;
            const decisionFlag = decisionObj ? decisionObj.wave2_required : undefined;
            const legacyFlag = vObj ? vObj.run_wave2 : undefined;
            const flag = typeof decisionFlag === "boolean" ? decisionFlag : legacyFlag;
            if (typeof flag !== "boolean") return { ok: false, run_wave2: false, error: "pivot.run_wave2 missing" };
            return { ok: true, run_wave2: flag };
          } catch (e) {
            return { ok: false, run_wave2: false, error: String(e) };
          }
        };

      const allowedNextFor = (stage: string): string[] => {
        switch (stage) {
          case "init":
            return ["wave1"];
          case "wave1":
            return ["pivot"];
          case "pivot":
            return ["wave2", "citations"];
          case "wave2":
            return ["citations"];
          case "citations":
            return ["summaries"];
          case "summaries":
            return ["synthesis"];
          case "synthesis":
            return ["review"];
          case "review":
            return ["synthesis", "finalize"];
          case "finalize":
            return [];
          default:
            return [];
        }
      };

      if (from === "finalize") {
        return err("INVALID_STATE", "already finalized", { stage: from });
      }

      const allowedNext = allowedNextFor(from);
      const requested = (args.requested_next ?? "").trim();
      const toCandidate = requested || "";

      let to: string;

      if (requested) {
        if (!allowedStages.includes(requested as (typeof allowedStages)[number])) {
          return err("REQUESTED_NEXT_NOT_ALLOWED", "requested_next is not a stage", { requested_next: requested });
        }
        if (!allowedNext.includes(requested)) {
          return err("REQUESTED_NEXT_NOT_ALLOWED", "requested_next not allowed from current stage", {
            from,
            requested_next: requested,
            allowed_next: allowedNext,
          });
        }
        to = requested;
      } else {
        if (from === "pivot") {
          const pivot = await parsePivotRunWave2();
          evaluated.push({
            kind: "artifact",
            name: pivotFile,
            ok: pivot.ok,
            details: { path: path.join(runRoot, pivotFile), run_wave2: pivot.run_wave2, error: pivot.error ?? null },
          });
          if (!pivot.ok) {
            return err("MISSING_ARTIFACT", "pivot decision incomplete", { file: pivotFile });
          }
          to = pivot.run_wave2 ? "wave2" : "citations";
        } else if (allowedNext.length === 1) {
          to = allowedNext[0];
        } else {
          // review has multiple outcomes; require requested_next until Phase 05 defines reviewer artifacts.
          return err("INVALID_STATE", "ambiguous transition; requested_next required", { from, allowed_next: allowedNext });
        }
      }

      evaluated.push({ kind: "transition", name: `${from} -> ${to}`, ok: true, details: {} });

      // Preconditions per spec-stage-machine-v1
      type StageAdvanceBlock = { code: string; message: string; details: Record<string, unknown> };
      let block: StageAdvanceBlock | null = null;

      const blockIfFailed = (
        okv: boolean,
        code: string,
        message: string,
        details: Record<string, unknown>,
      ): StageAdvanceBlock | null => {
        if (okv) return null;
        return { code, message, details };
      };

      if (from === "init" && to === "wave1") {
        block ??= blockIfFailed(await evalArtifact(perspectivesFile, path.join(runRoot, perspectivesFile)), "MISSING_ARTIFACT", "perspectives.json missing", { file: perspectivesFile });
      }

      if (from === "wave1" && to === "pivot") {
        block ??= blockIfFailed(await evalDirHasFiles(wave1Dir, path.join(runRoot, wave1Dir)), "MISSING_ARTIFACT", "wave1 artifacts missing", { dir: wave1Dir });
        block ??= blockIfFailed(evalGatePass("B"), "GATE_BLOCKED", "Gate B not pass", { gate: "B" });
      }

      if (from === "pivot") {
        // pivot file existence already evaluated above.
        if (to === "wave2") {
          // require wave2 dir to eventually contain files; we only check existence now.
          await evalArtifact(wave2Dir, path.join(runRoot, wave2Dir));
        }
      }

      if (from === "wave2" && to === "citations") {
        block ??= blockIfFailed(await evalDirHasFiles(wave2Dir, path.join(runRoot, wave2Dir)), "MISSING_ARTIFACT", "wave2 artifacts missing", { dir: wave2Dir });
      }

      if (from === "citations" && to === "summaries") {
        block ??= blockIfFailed(evalGatePass("C"), "GATE_BLOCKED", "Gate C not pass", { gate: "C" });
        // Also require citations dir exists.
        await evalArtifact(citationsDir, path.join(runRoot, citationsDir));
      }

      if (from === "summaries" && to === "synthesis") {
        block ??= blockIfFailed(evalGatePass("D"), "GATE_BLOCKED", "Gate D not pass", { gate: "D" });
        block ??= blockIfFailed(await evalArtifact(summaryPackFile, path.join(runRoot, summaryPackFile)), "MISSING_ARTIFACT", "summary-pack.json missing", { file: summaryPackFile });
      }

      if (from === "synthesis" && to === "review") {
        const finalSynthesis = path.join(runRoot, synthesisDir, "final-synthesis.md");
        block ??= blockIfFailed(await evalArtifact(`${synthesisDir}/final-synthesis.md`, finalSynthesis), "MISSING_ARTIFACT", "final-synthesis.md missing", { file: `${synthesisDir}/final-synthesis.md` });
      }

      if (from === "review" && to === "finalize") {
        block ??= blockIfFailed(evalGatePass("E"), "GATE_BLOCKED", "Gate E not pass", { gate: "E" });
      }

      // Deterministic digest of evaluated outcomes + key doc revisions.
      const digestInput = {
        schema: "stage_advance.decision.v1",
        from,
        to,
        requested_next: requested || null,
        manifest_revision: Number(manifest.revision ?? 0),
        gates_revision: gatesRevision,
        gates_status: {
          A: (isPlainObject(gates.A) ? (gates.A as Record<string, unknown>).status : null) ?? null,
          B: (isPlainObject(gates.B) ? (gates.B as Record<string, unknown>).status : null) ?? null,
          C: (isPlainObject(gates.C) ? (gates.C as Record<string, unknown>).status : null) ?? null,
          D: (isPlainObject(gates.D) ? (gates.D as Record<string, unknown>).status : null) ?? null,
          E: (isPlainObject(gates.E) ? (gates.E as Record<string, unknown>).status : null) ?? null,
          F: (isPlainObject(gates.F) ? (gates.F as Record<string, unknown>).status : null) ?? null,
        },
        evaluated,
      };
      const inputs_digest = `sha256:${sha256HexLowerUtf8(JSON.stringify(digestInput))}`;

      const allowed = block === null;
      const decision = {
        allowed,
        evaluated,
        inputs_digest,
      };

      if (block) {
        return err(block.code, block.message, { ...block.details, from, to: toCandidate || to, decision });
      }

      const ts = nowIso();
      const stage = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const history = Array.isArray(stage.history) ? stage.history : [];
      const historyEntry = {
        from,
        to,
        ts,
        reason: args.reason,
        inputs_digest,
        gates_revision: gatesRevision,
      };

      const nextStatus = to === "finalize" ? "completed" : "running";
      const patch = {
        status: nextStatus,
        stage: {
          current: to,
          started_at: ts,
          history: [...history, historyEntry],
        },
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `stage_advance: ${args.reason}`,
      })) as string;

      const writeObj = parseJsonSafe(writeRaw);
      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to persist manifest stage transition", {
          from,
          to,
          write_error: writeObj.value,
        });
      }

      return ok({ from, to, decision });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path or gates_path not found");
      return err("WRITE_FAILED", "stage_advance failed", { message: String(e) });
    }
  },
});

export const watchdog_check = tool({
  description: "Check stage timeout and fail run deterministically",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    stage: tool.schema.string().optional().describe("Optional stage override; defaults to manifest.stage.current"),
    now_iso: tool.schema.string().optional().describe("Optional current time override for deterministic tests"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; stage?: string; now_iso?: string; reason: string }) {
    try {
      const reason = args.reason.trim();
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(args.manifest_path);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const stageObj2 = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const currentStage = String(stageObj2.current ?? "");
      const stageArg = (args.stage ?? "").trim();
      const stage = stageArg || currentStage;

      if (!stage || !MANIFEST_STAGE.includes(stage)) {
        return err("INVALID_ARGS", "stage is invalid", { stage });
      }

      if (stageArg && stageArg !== currentStage) {
        return err("STAGE_MISMATCH", "stage override must match manifest.stage.current", {
          requested_stage: stageArg,
          current_stage: currentStage,
        });
      }

      const timeout_s = STAGE_TIMEOUT_SECONDS_V1[stage];
      if (!isInteger(timeout_s) || timeout_s <= 0) {
        return err("INVALID_STATE", "no timeout configured for stage", { stage });
      }

      const now = args.now_iso ? new Date(args.now_iso) : new Date();
      if (Number.isNaN(now.getTime())) {
        return err("INVALID_ARGS", "now_iso must be a valid ISO timestamp", { now_iso: args.now_iso ?? null });
      }

      const stageObj3 = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const startedAtRaw = String(stageObj3.started_at ?? "");
      const startedAt = new Date(startedAtRaw);
      if (!startedAtRaw || Number.isNaN(startedAt.getTime())) {
        return err("INVALID_STATE", "manifest.stage.started_at invalid", { started_at: startedAtRaw });
      }

      const elapsed_s = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

      if (elapsed_s <= timeout_s) {
        return ok({ timed_out: false, stage, elapsed_s, timeout_s });
      }

      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const logsDir = String(getManifestPaths(manifest).logs_dir ?? "logs");
      const checkpointPath = path.join(runRoot, logsDir, "timeout-checkpoint.md");
      const failureTs = now.toISOString();

      const checkpointContent = `${[
        "# Timeout Checkpoint",
        "",
        `- stage: ${stage}`,
        `- elapsed_seconds: ${elapsed_s}`,
        `- timeout_seconds: ${timeout_s}`,
        "- last_known_subtask: unavailable (placeholder)",
        "- next_steps:",
        "  1. Inspect logs/audit.jsonl for recent events.",
        "  2. Decide whether to restart this stage or abort run.",
      ].join("\n")}\n`;

      await ensureDir(path.dirname(checkpointPath));
      await fs.promises.writeFile(checkpointPath, checkpointContent, "utf8");

      const existingFailures = Array.isArray(manifest.failures) ? manifest.failures : [];
      const patch = {
        status: "failed",
        failures: [
          ...existingFailures,
          {
            kind: "timeout",
            stage,
            message: `timeout after ${elapsed_s}s`,
            retryable: false,
            ts: failureTs,
          },
        ],
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `watchdog_check: ${reason}`,
      })) as string;

      const writeObj = parseJsonSafe(writeRaw);
      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!isPlainObject(writeObj.value) || writeObj.value.ok !== true) return JSON.stringify(writeObj.value, null, 2);

      return ok({
        timed_out: true,
        stage,
        elapsed_s,
        timeout_s,
        checkpoint_path: checkpointPath,
        manifest_revision: Number((writeObj.value as Record<string, unknown>).new_revision ?? 0),
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "watchdog_check failed", { message: String(e) });
    }
  },
});

type CitationStatus = "valid" | "paywalled" | "blocked" | "mismatch" | "invalid";

type UrlMapItemV1 = {
  url_original: string;
  normalized_url: string;
  cid: string;
};

type OfflineFixtureEntry = {
  normalized_url?: string;
  url_original?: string;
  cid?: string;
  status?: string;
  url?: string;
  http_status?: number;
  title?: string;
  publisher?: string;
  evidence_snippet?: string;
  notes?: string;
};

type OfflineFixtureLookup = {
  byNormalized: Map<string, OfflineFixtureEntry>;
  byOriginal: Map<string, OfflineFixtureEntry>;
  byCid: Map<string, OfflineFixtureEntry>;
  fixtureDigest: string;
};

function isCitationStatus(value: unknown): value is CitationStatus {
  return value === "valid" || value === "paywalled" || value === "blocked" || value === "mismatch" || value === "invalid";
}

function appendNote(current: string, next: string): string {
  const base = current.trim();
  const tail = next.trim();
  if (!base) return tail;
  if (!tail) return base;
  return `${base}; ${tail}`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function listMarkdownFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFilesRecursive(abs);
      out.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(abs);
  }
  return out;
}

function extractHttpUrlsFromLine(line: string): string[] {
  const matches = line.match(/https?:\/\/[^\s<>()\[\]"'`]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.;:!?]+$/g, "").trim();
    if (!cleaned) continue;
    try {
      const parsed = new URL(cleaned);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") continue;
      const value = parsed.toString();
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    } catch {
      // ignore non-URL tokens
    }
  }
  return out;
}

function normalizeCitationUrl(urlOriginal: string):
  | { ok: true; normalized_url: string }
  | { ok: false; message: string; details: Record<string, unknown> } {
  try {
    const parsed = new URL(urlOriginal);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return {
        ok: false,
        message: "only http/https URLs are allowed",
        details: { protocol: parsed.protocol },
      };
    }

    const host = parsed.hostname.toLowerCase();
    let port = parsed.port;
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }

    let pathname = parsed.pathname || "/";
    if (pathname !== "/" && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    const filteredPairs = [...parsed.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        if (lower.startsWith("utm_")) return false;
        if (lower === "gclid" || lower === "fbclid") return false;
        return true;
      })
      .sort((a, b) => {
        const byKey = a[0].localeCompare(b[0]);
        if (byKey !== 0) return byKey;
        return a[1].localeCompare(b[1]);
      });

    const query = filteredPairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const authority = port ? `${host}:${port}` : host;
    const normalizedUrl = `${protocol}//${authority}${pathname}${query ? `?${query}` : ""}`;
    return { ok: true, normalized_url: normalizedUrl };
  } catch (e) {
    return {
      ok: false,
      message: "invalid absolute URL",
      details: { error: String(e) },
    };
  }
}

function citationCid(normalizedUrl: string): string {
  return `cid_${sha256HexLowerUtf8(normalizedUrl)}`;
}

function validateUrlMapV1(
  value: unknown,
  expectedRunId: string,
):
  | { ok: true; items: UrlMapItemV1[] }
  | { ok: false; message: string; details: Record<string, unknown> } {
  if (!isPlainObject(value)) return { ok: false, message: "url-map must be object", details: {} };
  if (value.schema_version !== "url_map.v1") {
    return { ok: false, message: "url-map schema_version must be url_map.v1", details: { schema_version: value.schema_version ?? null } };
  }
  if (String(value.run_id ?? "") !== expectedRunId) {
    return {
      ok: false,
      message: "url-map run_id mismatch",
      details: { expected_run_id: expectedRunId, got: String(value.run_id ?? "") },
    };
  }

  const itemsRaw = (value as Record<string, unknown>).items;
  if (!Array.isArray(itemsRaw)) return { ok: false, message: "url-map items must be array", details: {} };

  const items: UrlMapItemV1[] = [];
  for (let i = 0; i < itemsRaw.length; i += 1) {
    const raw = itemsRaw[i];
    if (!isPlainObject(raw)) return { ok: false, message: "url-map item must be object", details: { index: i } };
    const urlOriginal = String(raw.url_original ?? "").trim();
    const normalizedUrl = String(raw.normalized_url ?? "").trim();
    const cid = String(raw.cid ?? "").trim();
    if (!urlOriginal || !normalizedUrl || !cid) {
      return {
        ok: false,
        message: "url-map item missing required fields",
        details: { index: i, url_original: urlOriginal, normalized_url: normalizedUrl, cid },
      };
    }
    items.push({ url_original: urlOriginal, normalized_url: normalizedUrl, cid });
  }
  return { ok: true, items };
}

function emptyOfflineFixtureLookup(): OfflineFixtureLookup {
  return {
    byNormalized: new Map(),
    byOriginal: new Map(),
    byCid: new Map(),
    fixtureDigest: sha256DigestForJson({ schema: "citations_validate.offline_fixtures.v1", items: [] }),
  };
}

function buildOfflineFixtureLookup(
  value: unknown,
):
  | { ok: true; lookup: OfflineFixtureLookup }
  | { ok: false; message: string; details: Record<string, unknown> } {
  let itemsRaw: unknown[] = [];
  if (Array.isArray(value)) {
    itemsRaw = value;
  } else if (isPlainObject(value) && Array.isArray((value as Record<string, unknown>).items)) {
    itemsRaw = ((value as Record<string, unknown>).items as unknown[]);
  } else if (isPlainObject(value)) {
    itemsRaw = Object.entries(value).map(([normalized, entry]) => {
      if (isPlainObject(entry)) return { normalized_url: normalized, ...entry };
      return { normalized_url: normalized, status: String(entry ?? "") };
    });
  } else {
    return { ok: false, message: "offline fixtures must be array/object", details: {} };
  }

  const byNormalized = new Map<string, OfflineFixtureEntry>();
  const byOriginal = new Map<string, OfflineFixtureEntry>();
  const byCid = new Map<string, OfflineFixtureEntry>();
  const normalizedForDigest: OfflineFixtureEntry[] = [];

  for (let i = 0; i < itemsRaw.length; i += 1) {
    const raw = itemsRaw[i];
    if (!isPlainObject(raw)) {
      return { ok: false, message: "offline fixture entry must be object", details: { index: i } };
    }
    const item: OfflineFixtureEntry = {
      normalized_url: isNonEmptyString(raw.normalized_url) ? raw.normalized_url.trim() : undefined,
      url_original: isNonEmptyString(raw.url_original) ? raw.url_original.trim() : undefined,
      cid: isNonEmptyString(raw.cid) ? raw.cid.trim() : undefined,
      status: isNonEmptyString(raw.status) ? raw.status.trim() : undefined,
      url: isNonEmptyString(raw.url) ? raw.url.trim() : undefined,
      http_status: isFiniteNumber(raw.http_status) ? Math.trunc(raw.http_status) : undefined,
      title: isNonEmptyString(raw.title) ? raw.title.trim() : undefined,
      publisher: isNonEmptyString(raw.publisher) ? raw.publisher.trim() : undefined,
      evidence_snippet: isNonEmptyString(raw.evidence_snippet) ? raw.evidence_snippet.trim() : undefined,
      notes: isNonEmptyString(raw.notes) ? raw.notes.trim() : undefined,
    };

    if (item.normalized_url) byNormalized.set(item.normalized_url, item);
    if (item.url_original) byOriginal.set(item.url_original, item);
    if (item.cid) byCid.set(item.cid, item);
    normalizedForDigest.push(item);
  }

  return {
    ok: true,
    lookup: {
      byNormalized,
      byOriginal,
      byCid,
      fixtureDigest: sha256DigestForJson({
        schema: "citations_validate.offline_fixtures.v1",
        items: normalizedForDigest,
      }),
    },
  };
}

function findFixtureForUrlMapItem(lookup: OfflineFixtureLookup, item: UrlMapItemV1): OfflineFixtureEntry | null {
  return lookup.byNormalized.get(item.normalized_url)
    ?? lookup.byOriginal.get(item.url_original)
    ?? lookup.byCid.get(item.cid)
    ?? null;
}

const SENSITIVE_QUERY_KEYS = ["token", "key", "api_key", "access_token", "auth", "session", "password"];

function redactSensitiveUrl(input: string): { value: string; hadUserinfo: boolean } {
  try {
    const parsed = new URL(input);
    const hadUserinfo = Boolean(parsed.username || parsed.password);
    parsed.username = "";
    parsed.password = "";

    const keys = Array.from(new Set([...parsed.searchParams.keys()]));
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.some((needle) => lower.includes(needle))) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return { value: parsed.toString(), hadUserinfo };
  } catch {
    return { value: input, hadUserinfo: false };
  }
}

function isPrivateOrLocalHost(hostnameInput: string): boolean {
  const hostname = hostnameInput.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (hostname === "localhost" || hostname === "::1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (hostname.startsWith("fe8") || hostname.startsWith("fe9") || hostname.startsWith("fea") || hostname.startsWith("feb")) return true;
  return false;
}

function classifyOnlineStub(urlValue: string): { status: CitationStatus; notes: string; url: string } {
  const redacted = redactSensitiveUrl(urlValue);
  try {
    const parsed = new URL(redacted.value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return { status: "invalid", notes: "online stub: disallowed protocol", url: redacted.value };
    }
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return { status: "invalid", notes: "online stub: private/local target blocked by SSRF policy", url: redacted.value };
    }
    if (redacted.hadUserinfo) {
      return { status: "invalid", notes: "online stub: userinfo stripped and marked invalid", url: redacted.value };
    }
    return {
      status: "blocked",
      notes: "online stub: ladder placeholder [direct_fetch -> bright_data -> apify]",
      url: redacted.value,
    };
  } catch {
    return { status: "invalid", notes: "online stub: malformed URL", url: redacted.value };
  }
}

async function readJsonlObjects(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new SyntaxError(`invalid JSONL at line ${i + 1}: ${String(e)}`);
    }
    if (!isPlainObject(parsed)) {
      throw new SyntaxError(`invalid JSONL object at line ${i + 1}`);
    }
    out.push(parsed);
  }
  return out;
}

async function readFoundByLookup(foundByPath: string): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  let raw: unknown;
  try {
    raw = await readJson(foundByPath);
  } catch {
    return out;
  }

  if (!isPlainObject(raw) || !Array.isArray((raw as Record<string, unknown>).items)) return out;
  for (const item of (raw as Record<string, unknown>).items as unknown[]) {
    if (!isPlainObject(item)) continue;
    const urlOriginal = String(item.url_original ?? "").trim();
    if (!urlOriginal) continue;

    const waveRaw = String(item.wave ?? "").trim();
    const wave = waveRaw === "wave-2" ? 2 : 1;
    const perspectiveId = String(item.perspective_id ?? "").trim();
    const entry: Record<string, unknown> = {
      wave,
      perspective_id: perspectiveId || "unknown",
      agent_type: "unknown",
      artifact_path: perspectiveId ? `${waveRaw || `wave-${wave}`}/${perspectiveId}.md` : `${waveRaw || `wave-${wave}`}/unknown.md`,
    };
    const list = out.get(urlOriginal) ?? [];
    list.push(entry);
    out.set(urlOriginal, list);
  }

  for (const [key, value] of out.entries()) {
    value.sort((a, b) => {
      const byWave = Number(a.wave ?? 0) - Number(b.wave ?? 0);
      if (byWave !== 0) return byWave;
      const byPerspective = String(a.perspective_id ?? "").localeCompare(String(b.perspective_id ?? ""));
      if (byPerspective !== 0) return byPerspective;
      return String(a.artifact_path ?? "").localeCompare(String(b.artifact_path ?? ""));
    });
    out.set(key, value);
  }

  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

function parseJsonSafe(raw: string): { ok: true; value: unknown } | { ok: false; value: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}

function resolveRunRootFromManifest(manifestPath: string, manifest: Record<string, unknown>): string {
  const artifacts = getObjectProp(manifest, "artifacts");
  const root = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "").trim();
  if (root && path.isAbsolute(root)) return root;
  return path.dirname(manifestPath);
}

function resolveArtifactPath(argsPath: string | undefined, runRoot: string, manifestRel: string | undefined, fallbackRel: string): string {
  const provided = (argsPath ?? "").trim();
  if (provided) return provided;
  const rel = (manifestRel ?? "").trim() || fallbackRel;
  return path.join(runRoot, rel);
}

function extractCitationMentions(markdown: string): string[] {
  const out = new Set<string>();
  const regex = /\[@([A-Za-z0-9_:-]+)\]/g;
  let match: RegExpExecArray | null = regex.exec(markdown);
  while (match !== null) {
    const cid = (match[1] ?? "").trim();
    if (cid) out.add(cid);
    match = regex.exec(markdown);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function hasRawHttpUrl(markdown: string): boolean {
  return /https?:\/\//i.test(markdown);
}

function formatRate(value: number): number {
  return Number(value.toFixed(6));
}

async function readValidatedCids(citationsPath: string): Promise<Set<string>> {
  const records = await readJsonlObjects(citationsPath);
  const out = new Set<string>();
  for (const record of records) {
    const cid = String(record.cid ?? "").trim();
    const status = String(record.status ?? "").trim();
    if (!cid) continue;
    if (status === "valid" || status === "paywalled") out.add(cid);
  }
  return out;
}

function requiredSynthesisHeadingsV1(): string[] {
  return ["Summary", "Key Findings", "Evidence", "Caveats"];
}

function countUncitedNumericClaims(markdown: string): number {
  const lines = markdown.split(/\r?\n/);
  const numericRegex = /\b\d+(?:\.\d+)?%?\b/;
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (!numericRegex.test(line)) continue;
    if (/\[@[A-Za-z0-9_:-]+\]/.test(line)) continue;
    const nextLine = (lines[i + 1] ?? "").trim();
    if (!/\[@[A-Za-z0-9_:-]+\]/.test(nextLine)) count += 1;
  }
  return count;
}

export const summary_pack_build = tool({
  description: "Build bounded summary-pack and summary markdown artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    perspectives_path: tool.schema.string().optional().describe("Absolute path to perspectives.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Build mode"),
    fixture_summaries_dir: tool.schema.string().optional().describe("Absolute fixture summaries directory for mode=fixture"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute output summary-pack path"),
    summaries_dir: tool.schema.string().optional().describe("Absolute output summaries directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    perspectives_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_summaries_dir?: string;
    summary_pack_path?: string;
    summaries_dir?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      const mode = args.mode ?? "fixture";

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const perspectivesPath = resolveArtifactPath(
        args.perspectives_path,
        runRoot,
        typeof artifactPaths.perspectives_file === "string" ? artifactPaths.perspectives_file : undefined,
        "perspectives.json",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const summariesDir = resolveArtifactPath(
        args.summaries_dir,
        runRoot,
        typeof artifactPaths.summaries_dir === "string" ? artifactPaths.summaries_dir : undefined,
        "summaries",
      );
      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const fixtureSummariesDir = (args.fixture_summaries_dir ?? "").trim();

      if (!path.isAbsolute(perspectivesPath)) return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(summariesDir)) return err("INVALID_ARGS", "summaries_dir must be absolute", { summaries_dir: args.summaries_dir ?? null });
      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (!fixtureSummariesDir || !path.isAbsolute(fixtureSummariesDir)) {
        return err("INVALID_ARGS", "fixture_summaries_dir must be absolute in fixture mode", {
          fixture_summaries_dir: args.fixture_summaries_dir ?? null,
        });
      }

      const relSummariesDir = toPosixPath(path.relative(runRoot, summariesDir));
      const relSummaryPackPath = toPosixPath(path.relative(runRoot, summaryPackPath));
      if (relSummariesDir.startsWith("..") || path.isAbsolute(relSummariesDir)) {
        return err("INVALID_ARGS", "summaries_dir must be under run root", { summaries_dir: summariesDir, run_root: runRoot });
      }
      if (relSummaryPackPath.startsWith("..") || path.isAbsolute(relSummaryPackPath)) {
        return err("INVALID_ARGS", "summary_pack_path must be under run root", { summary_pack_path: summaryPackPath, run_root: runRoot });
      }

      const perspectivesRaw = await readJson(perspectivesPath);
      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const perspectivesList = Array.isArray(perspectivesDoc.perspectives)
        ? (perspectivesDoc.perspectives as Array<Record<string, unknown>>)
        : [];
      const perspectives = perspectivesList
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          source_artifact: String((item as Record<string, unknown>).source_artifact ?? "").trim(),
        }))
        .filter((item) => item.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id));

      if (perspectives.length === 0) return err("SCHEMA_VALIDATION_FAILED", "perspectives list is empty", { path: "$.perspectives" });

      const validatedCids = await readValidatedCids(citationsPath);

      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxSummaryKb = getNumberProp(limitsObj, "max_summary_kb") ?? Number(limitsObj.max_summary_kb ?? 0);
      const maxTotalSummaryKb = getNumberProp(limitsObj, "max_total_summary_kb") ?? Number(limitsObj.max_total_summary_kb ?? 0);
      if (!Number.isFinite(maxSummaryKb) || maxSummaryKb <= 0) {
        return err("INVALID_STATE", "manifest.limits.max_summary_kb invalid", { value: limitsObj.max_summary_kb ?? null });
      }
      if (!Number.isFinite(maxTotalSummaryKb) || maxTotalSummaryKb <= 0) {
        return err("INVALID_STATE", "manifest.limits.max_total_summary_kb invalid", { value: limitsObj.max_total_summary_kb ?? null });
      }

      const prepared: Array<{
        perspective_id: string;
        markdown: string;
        summary_path: string;
        summary_rel: string;
        cids: string[];
      }> = [];

      let totalKb = 0;
      for (const perspective of perspectives) {
        const fixtureFile = path.join(fixtureSummariesDir, `${perspective.id}.md`);
        let markdown: string;
        try {
          markdown = await fs.promises.readFile(fixtureFile, "utf8");
        } catch (e) {
          if (errorCode(e) === "ENOENT") {
            return err("NOT_FOUND", "fixture summary missing", { perspective_id: perspective.id, fixture_file: fixtureFile });
          }
          throw e;
        }

        if (hasRawHttpUrl(markdown)) {
          return err("RAW_URL_NOT_ALLOWED", "raw URL detected in summary fixture", {
            perspective_id: perspective.id,
            fixture_file: fixtureFile,
          });
        }

        const cids = extractCitationMentions(markdown);
        for (const cid of cids) {
          if (!validatedCids.has(cid)) {
            return err("UNKNOWN_CID", "summary references cid not present in validated pool", {
              perspective_id: perspective.id,
              cid,
            });
          }
        }

        const kb = Buffer.byteLength(markdown, "utf8") / 1024;
        if (kb > maxSummaryKb) {
          return err("SIZE_CAP_EXCEEDED", "summary exceeds max_summary_kb", {
            perspective_id: perspective.id,
            summary_kb: formatRate(kb),
            max_summary_kb: maxSummaryKb,
          });
        }

        const summaryPath = path.join(summariesDir, `${perspective.id}.md`);
        const summaryRel = toPosixPath(path.relative(runRoot, summaryPath));
        prepared.push({
          perspective_id: perspective.id,
          markdown,
          summary_path: summaryPath,
          summary_rel: summaryRel,
          cids,
        });
        totalKb += kb;
      }

      if (totalKb > maxTotalSummaryKb) {
        return err("SIZE_CAP_EXCEEDED", "total summaries exceed max_total_summary_kb", {
          total_summary_kb: formatRate(totalKb),
          max_total_summary_kb: maxTotalSummaryKb,
        });
      }

      await ensureDir(summariesDir);
      for (const item of prepared) {
        await atomicWriteText(item.summary_path, item.markdown);
      }

      const summaryPack = {
        schema_version: "summary_pack.v1",
        run_id: runId,
        generated_at: nowIso(),
        limits: {
          max_summary_kb: maxSummaryKb,
          max_total_summary_kb: maxTotalSummaryKb,
        },
        summaries: prepared.map((item) => ({
          perspective_id: item.perspective_id,
          source_artifact: `wave-1/${item.perspective_id}.md`,
          summary_md: item.summary_rel,
          key_claims: [
            {
              claim: `Bounded synthesis summary for ${item.perspective_id}`,
              citation_cids: item.cids,
              confidence: 80,
            },
          ],
        })),
        total_estimated_tokens: Math.max(1, Math.round((totalKb * 1024) / 4)),
      };

      await atomicWriteJson(summaryPackPath, summaryPack);

      const inputsDigest = sha256DigestForJson({
        schema: "summary_pack_build.inputs.v1",
        run_id: runId,
        manifest_revision: Number(manifest.revision ?? 0),
        perspectives: prepared.map((item) => item.perspective_id),
        validated_cids: [...validatedCids].sort((a, b) => a.localeCompare(b)),
        fixtures: prepared.map((item) => ({
          perspective_id: item.perspective_id,
          hash: sha256HexLowerUtf8(item.markdown),
        })),
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "summary_pack_build",
            run_id: runId,
            reason,
            summary_count: prepared.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        summary_pack_path: summaryPackPath,
        summaries_dir: summariesDir,
        summary_count: prepared.length,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "summary_pack_build failed", { message: String(e) });
    }
  },
});

export const gate_d_evaluate = tool({
  description: "Compute deterministic Gate D metrics from summary artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute path to summary-pack.json"),
    summaries_dir: tool.schema.string().optional().describe("Absolute summaries directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    summary_pack_path?: string;
    summaries_dir?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const summariesDir = resolveArtifactPath(
        args.summaries_dir,
        runRoot,
        typeof artifactPaths.summaries_dir === "string" ? artifactPaths.summaries_dir : undefined,
        "summaries",
      );
      const perspectivesPath = resolveArtifactPath(
        undefined,
        runRoot,
        typeof artifactPaths.perspectives_file === "string" ? artifactPaths.perspectives_file : undefined,
        "perspectives.json",
      );

      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (!path.isAbsolute(summariesDir)) return err("INVALID_ARGS", "summaries_dir must be absolute", { summaries_dir: args.summaries_dir ?? null });

      const summaryPackRaw = await readJson(summaryPackPath);
      if (!isPlainObject(summaryPackRaw) || summaryPackRaw.schema_version !== "summary_pack.v1") {
        return err("SCHEMA_VALIDATION_FAILED", "summary-pack schema_version must be summary_pack.v1", {
          summary_pack_path: summaryPackPath,
        });
      }
      const summaryPackDoc = summaryPackRaw as Record<string, unknown>;
      const entriesRaw = Array.isArray(summaryPackDoc.summaries) ? (summaryPackDoc.summaries as unknown[]) : [];

      let expectedCount = entriesRaw.length;
      try {
        const perspectivesRaw = await readJson(perspectivesPath);
        const pErr = validatePerspectivesV1(perspectivesRaw);
        if (!pErr) {
          const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
          expectedCount = Array.isArray(perspectivesDoc.perspectives) ? perspectivesDoc.perspectives.length : 0;
        }
      } catch {
        // fallback to summary entries length
      }

      const missingSummaries: string[] = [];
      let totalKb = 0;
      let maxKb = 0;
      let existingCount = 0;

      for (const entryRaw of entriesRaw) {
        if (!isPlainObject(entryRaw)) continue;
        const entryObj = entryRaw as Record<string, unknown>;
        const perspectiveId = String(entryObj.perspective_id ?? "").trim() || "unknown";
        const summaryMd = String(entryObj.summary_md ?? "").trim();
        if (!summaryMd) {
          missingSummaries.push(`${perspectiveId}:<missing summary_md>`);
          continue;
        }

        const summaryPath = path.isAbsolute(summaryMd) ? summaryMd : path.join(runRoot, summaryMd);
        try {
          const content = await fs.promises.readFile(summaryPath, "utf8");
          const kb = Buffer.byteLength(content, "utf8") / 1024;
          totalKb += kb;
          if (kb > maxKb) maxKb = kb;
          existingCount += 1;
        } catch (e) {
          if (errorCode(e) === "ENOENT") {
            missingSummaries.push(toPosixPath(path.relative(runRoot, summaryPath)));
            continue;
          }
          throw e;
        }
      }

      const ratio = expectedCount > 0 ? existingCount / expectedCount : 0;
      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxSummaryKbLimit = getNumberProp(limitsObj, "max_summary_kb") ?? Number(limitsObj.max_summary_kb ?? 0);
      const maxTotalSummaryKbLimit = getNumberProp(limitsObj, "max_total_summary_kb") ?? Number(limitsObj.max_total_summary_kb ?? 0);

      const metrics = {
        summary_count_ratio: formatRate(ratio),
        max_summary_kb: formatRate(maxKb),
        total_summary_pack_kb: formatRate(totalKb),
        summary_count: existingCount,
        expected_count: expectedCount,
      };

      const warnings: string[] = [];
      if (missingSummaries.length > 0) warnings.push(`MISSING_SUMMARIES:${missingSummaries.length}`);

      const pass =
        ratio >= 0.9
        && maxKb <= maxSummaryKbLimit
        && totalKb <= maxTotalSummaryKbLimit
        && missingSummaries.length === 0;

      const status: "pass" | "fail" = pass ? "pass" : "fail";
      const checkedAt = nowIso();
      const update = {
        D: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, summaryPackPath)),
            toPosixPath(path.relative(runRoot, summariesDir)),
          ],
          warnings,
          notes: pass
            ? "Gate D passed with bounded summaries"
            : "Gate D failed: boundedness or completeness threshold not met",
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_d_evaluate.inputs.v1",
        run_id: runId,
        summary_pack_path: toPosixPath(path.relative(runRoot, summaryPackPath)),
        entries: entriesRaw,
        metrics,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_d_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            missing_summaries: missingSummaries,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "D",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_d_evaluate failed", { message: String(e) });
    }
  },
});

export const synthesis_write = tool({
  description: "Write bounded synthesis draft from summary-pack and citations",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    summary_pack_path: tool.schema.string().optional().describe("Absolute path to summary-pack.json"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Write mode"),
    fixture_draft_path: tool.schema.string().optional().describe("Absolute fixture markdown path for mode=fixture"),
    output_path: tool.schema.string().optional().describe("Absolute synthesis output path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    summary_pack_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_draft_path?: string;
    output_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      const mode = args.mode ?? "fixture";

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const summaryPackPath = resolveArtifactPath(
        args.summary_pack_path,
        runRoot,
        typeof artifactPaths.summary_pack_file === "string" ? artifactPaths.summary_pack_file : undefined,
        "summaries/summary-pack.json",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const outputPath = resolveArtifactPath(
        args.output_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/draft-synthesis.md` : undefined,
        "synthesis/draft-synthesis.md",
      );
      const fixtureDraftPath = (args.fixture_draft_path ?? "").trim();

      if (!path.isAbsolute(summaryPackPath)) return err("INVALID_ARGS", "summary_pack_path must be absolute", { summary_pack_path: args.summary_pack_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });
      if (!path.isAbsolute(outputPath)) return err("INVALID_ARGS", "output_path must be absolute", { output_path: args.output_path ?? null });
      if (!fixtureDraftPath || !path.isAbsolute(fixtureDraftPath)) {
        return err("INVALID_ARGS", "fixture_draft_path must be absolute in fixture mode", {
          fixture_draft_path: args.fixture_draft_path ?? null,
        });
      }

      await readJson(summaryPackPath);
      const validatedCids = await readValidatedCids(citationsPath);

      const markdown = await fs.promises.readFile(fixtureDraftPath, "utf8");
      const requiredHeadings = requiredSynthesisHeadingsV1();
      for (const heading of requiredHeadings) {
        if (!hasHeading(markdown, heading)) {
          return err("SCHEMA_VALIDATION_FAILED", "missing required synthesis heading", {
            heading,
          });
        }
      }

      const cited = extractCitationMentions(markdown);
      if (cited.length === 0) return err("SCHEMA_VALIDATION_FAILED", "draft must include citation syntax [@cid]");
      for (const cid of cited) {
        if (!validatedCids.has(cid)) {
          return err("UNKNOWN_CID", "draft references cid not present in validated pool", { cid });
        }
      }

      await atomicWriteText(outputPath, markdown);

      const inputsDigest = sha256DigestForJson({
        schema: "synthesis_write.inputs.v1",
        run_id: runId,
        summary_pack_path: toPosixPath(path.relative(runRoot, summaryPackPath)),
        fixture_draft_hash: sha256HexLowerUtf8(markdown),
        cited,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "synthesis_write",
            run_id: runId,
            reason,
            output_path: toPosixPath(path.relative(runRoot, outputPath)),
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        output_path: outputPath,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "synthesis_write failed", { message: String(e) });
    }
  },
});

export const gate_e_evaluate = tool({
  description: "Compute deterministic Gate E metrics from final synthesis",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    synthesis_path: tool.schema.string().optional().describe("Absolute path to final-synthesis.md"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    synthesis_path?: string;
    citations_path?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const synthesisPath = resolveArtifactPath(
        args.synthesis_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/final-synthesis.md` : undefined,
        "synthesis/final-synthesis.md",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );

      if (!path.isAbsolute(synthesisPath)) return err("INVALID_ARGS", "synthesis_path must be absolute", { synthesis_path: args.synthesis_path ?? null });
      if (!path.isAbsolute(citationsPath)) return err("INVALID_ARGS", "citations_path must be absolute", { citations_path: args.citations_path ?? null });

      const markdown = await fs.promises.readFile(synthesisPath, "utf8");
      const validatedCids = await readValidatedCids(citationsPath);
      const requiredHeadings = requiredSynthesisHeadingsV1();
      const headingsPresent = requiredHeadings.filter((heading) => hasHeading(markdown, heading)).length;
      const reportSectionsPresent = requiredHeadings.length > 0
        ? formatRate(headingsPresent / requiredHeadings.length)
        : 0;

      const allMentions = [...markdown.matchAll(/\[@([A-Za-z0-9_:-]+)\]/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
      const usedValidCidSet = new Set<string>();
      for (const cid of allMentions) {
        if (validatedCids.has(cid)) usedValidCidSet.add(cid);
      }

      const validatedCidsCount = validatedCids.size;
      const usedCidsCount = usedValidCidSet.size;
      const totalCidMentions = allMentions.length;

      const citationUtilizationRate = validatedCidsCount > 0
        ? formatRate(usedCidsCount / validatedCidsCount)
        : 0;
      const duplicateCitationRate = totalCidMentions > 0
        ? formatRate(1 - (usedCidsCount / totalCidMentions))
        : 0;

      const uncitedNumericClaims = countUncitedNumericClaims(markdown);

      const metrics = {
        uncited_numeric_claims: uncitedNumericClaims,
        report_sections_present: reportSectionsPresent,
        citation_utilization_rate: citationUtilizationRate,
        duplicate_citation_rate: duplicateCitationRate,
      };

      const warnings: string[] = [];
      if (citationUtilizationRate < 0.6) warnings.push("LOW_CITATION_UTILIZATION");
      if (duplicateCitationRate > 0.2) warnings.push("HIGH_DUPLICATE_CITATION_RATE");

      const passHard = uncitedNumericClaims === 0 && reportSectionsPresent === 1;
      const status: "pass" | "fail" = passHard ? "pass" : "fail";
      const checkedAt = nowIso();
      const update = {
        E: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: [
            toPosixPath(path.relative(runRoot, synthesisPath)),
            toPosixPath(path.relative(runRoot, citationsPath)),
          ],
          warnings,
          notes: passHard
            ? "Gate E hard metrics satisfied"
            : "Gate E hard metric failure",
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_e_evaluate.inputs.v1",
        run_id: runId,
        markdown_hash: sha256HexLowerUtf8(markdown),
        validated_cids_count: validatedCidsCount,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_e_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            warnings,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        gate_id: "E",
        status,
        metrics,
        warnings,
        update,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_e_evaluate failed", { message: String(e) });
    }
  },
});

export const review_factory_run = tool({
  description: "Run deterministic fixture-based reviewer aggregation",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    draft_path: tool.schema.string().optional().describe("Absolute path to synthesis draft markdown"),
    citations_path: tool.schema.string().optional().describe("Absolute path to citations.jsonl"),
    mode: tool.schema.enum(["fixture", "generate"]).optional().describe("Reviewer mode"),
    fixture_bundle_dir: tool.schema.string().optional().describe("Absolute fixture directory containing review-bundle.json"),
    review_dir: tool.schema.string().optional().describe("Absolute review output directory"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    draft_path?: string;
    citations_path?: string;
    mode?: "fixture" | "generate";
    fixture_bundle_dir?: string;
    review_dir?: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      const mode = args.mode ?? "fixture";

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const artifactPaths = getManifestPaths(manifest);

      const draftPath = resolveArtifactPath(
        args.draft_path,
        runRoot,
        typeof artifactPaths.synthesis_dir === "string" ? `${artifactPaths.synthesis_dir}/draft-synthesis.md` : undefined,
        "synthesis/draft-synthesis.md",
      );
      const citationsPath = resolveArtifactPath(
        args.citations_path,
        runRoot,
        typeof artifactPaths.citations_file === "string" ? artifactPaths.citations_file : undefined,
        "citations/citations.jsonl",
      );
      const reviewDir = resolveArtifactPath(args.review_dir, runRoot, undefined, "review");
      const fixtureBundleDir = (args.fixture_bundle_dir ?? "").trim();
      if (!fixtureBundleDir || !path.isAbsolute(fixtureBundleDir)) {
        return err("INVALID_ARGS", "fixture_bundle_dir must be absolute in fixture mode", {
          fixture_bundle_dir: args.fixture_bundle_dir ?? null,
        });
      }

      await fs.promises.readFile(draftPath, "utf8");
      await fs.promises.readFile(citationsPath, "utf8");

      const fixtureBundlePath = path.join(fixtureBundleDir, "review-bundle.json");
      const fixtureBundleRaw = await readJson(fixtureBundlePath);
      if (!isPlainObject(fixtureBundleRaw)) {
        return err("SCHEMA_VALIDATION_FAILED", "fixture review bundle must be object", {
          fixture_bundle_path: fixtureBundlePath,
        });
      }

      const fixtureDoc = fixtureBundleRaw as Record<string, unknown>;
      const decision = String(fixtureDoc.decision ?? "").trim();
      if (decision !== "PASS" && decision !== "CHANGES_REQUIRED") {
        return err("SCHEMA_VALIDATION_FAILED", "review bundle decision invalid", { decision });
      }

      const findings = Array.isArray(fixtureDoc.findings)
        ? (fixtureDoc.findings as unknown[]).slice(0, 100)
        : [];
      const directives = Array.isArray(fixtureDoc.directives)
        ? (fixtureDoc.directives as unknown[]).slice(0, 100)
        : [];

      const reviewBundle = {
        schema_version: "review_bundle.v1",
        run_id: runId,
        decision,
        findings,
        directives,
      };

      await ensureDir(reviewDir);
      const reviewBundlePath = path.join(reviewDir, "review-bundle.json");
      await atomicWriteJson(reviewBundlePath, reviewBundle);
      await atomicWriteJson(path.join(reviewDir, "revision-directives.json"), {
        schema_version: "revision_directives.v1",
        run_id: runId,
        directives,
      });

      const inputsDigest = sha256DigestForJson({
        schema: "review_factory_run.inputs.v1",
        run_id: runId,
        decision,
        findings_count: findings.length,
        directives_count: directives.length,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "review_factory_run",
            run_id: runId,
            reason,
            decision,
            findings_count: findings.length,
            directives_count: directives.length,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        review_bundle_path: reviewBundlePath,
        decision,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "review_factory_run failed", { message: String(e) });
    }
  },
});

export const revision_control = tool({
  description: "Apply deterministic bounded review revision-control policy",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    review_bundle_path: tool.schema.string().describe("Absolute path to review-bundle.json"),
    current_iteration: tool.schema.number().describe("1-indexed current review iteration"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    gates_path: string;
    review_bundle_path: string;
    current_iteration: number;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const gatesPath = args.gates_path.trim();
      const reviewBundlePath = args.review_bundle_path.trim();
      const reason = args.reason.trim();
      const currentIteration = Math.trunc(args.current_iteration);

      if (!manifestPath || !path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!gatesPath || !path.isAbsolute(gatesPath)) return err("INVALID_ARGS", "gates_path must be absolute", { gates_path: args.gates_path });
      if (!reviewBundlePath || !path.isAbsolute(reviewBundlePath)) {
        return err("INVALID_ARGS", "review_bundle_path must be absolute", { review_bundle_path: args.review_bundle_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (!Number.isInteger(currentIteration) || currentIteration <= 0) {
        return err("INVALID_ARGS", "current_iteration must be positive integer", { current_iteration: args.current_iteration });
      }

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);

      const gatesRaw = await readJson(gatesPath);
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;
      const gatesDoc = gatesRaw as Record<string, unknown>;
      const gatesObj = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
      const gateE = isPlainObject(gatesObj.E) ? (gatesObj.E as Record<string, unknown>) : {};
      const gateEStatus = String(gateE.status ?? "").trim();

      const reviewRaw = await readJson(reviewBundlePath);
      if (!isPlainObject(reviewRaw)) return err("SCHEMA_VALIDATION_FAILED", "review bundle must be object");
      const reviewDoc = reviewRaw as Record<string, unknown>;
      const decision = String(reviewDoc.decision ?? "").trim();
      if (decision !== "PASS" && decision !== "CHANGES_REQUIRED") {
        return err("SCHEMA_VALIDATION_FAILED", "review bundle decision invalid", { decision });
      }

      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxReviewIterations = getNumberProp(limitsObj, "max_review_iterations") ?? Number(limitsObj.max_review_iterations ?? 0);
      if (!Number.isFinite(maxReviewIterations) || maxReviewIterations < 0) {
        return err("INVALID_STATE", "manifest.limits.max_review_iterations invalid", {
          value: limitsObj.max_review_iterations ?? null,
        });
      }

      let action: "advance" | "revise" | "escalate";
      let nextStage: "finalize" | "synthesis" | "review";
      let notes: string;

      if (decision === "PASS" && gateEStatus === "pass") {
        action = "advance";
        nextStage = "finalize";
        notes = "Review passed and Gate E hard metrics passed";
      } else if (currentIteration >= maxReviewIterations) {
        action = "escalate";
        nextStage = "review";
        notes = `Max review iterations reached (${currentIteration}/${maxReviewIterations})`;
      } else {
        action = "revise";
        nextStage = "synthesis";
        notes = decision === "CHANGES_REQUIRED"
          ? "Reviewer requested changes within iteration budget"
          : "Gate E not pass; revise synthesis within iteration budget";
      }

      const inputsDigest = sha256DigestForJson({
        schema: "revision_control.inputs.v1",
        run_id: runId,
        decision,
        gate_e_status: gateEStatus,
        current_iteration: currentIteration,
        max_review_iterations: maxReviewIterations,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "revision_control",
            run_id: runId,
            reason,
            action,
            next_stage: nextStage,
            decision,
            gate_e_status: gateEStatus,
            current_iteration: currentIteration,
            max_review_iterations: maxReviewIterations,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        action,
        next_stage: nextStage,
        notes,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "revision_control failed", { message: String(e) });
    }
  },
});

export const deep_research_summary_pack_build = summary_pack_build;
export const deep_research_gate_d_evaluate = gate_d_evaluate;
export const deep_research_synthesis_write = synthesis_write;
export const deep_research_gate_e_evaluate = gate_e_evaluate;
export const deep_research_review_factory_run = review_factory_run;
export const deep_research_revision_control = revision_control;
