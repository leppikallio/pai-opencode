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

      const initRaw = (await (run_init as any).execute(
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
      if (!initParsed.value?.ok) {
        return JSON.stringify(initParsed.value, null, 2);
      }
      if (initParsed.value.created === false) {
        return err("ALREADY_EXISTS", "run already exists; dry-run seed requires a fresh run_id", {
          run_id: runId,
          root: initParsed.value.root ?? null,
        });
      }

      const runRoot = String(initParsed.value.root ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "run_init returned invalid run root", {
          root: initParsed.value.root ?? null,
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

      const patchRaw = (await (manifest_write as any).execute(
        {
          manifest_path: String(initParsed.value.manifest_path),
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
      if (!patchParsed.value?.ok) {
        return JSON.stringify(patchParsed.value, null, 2);
      }

      copiedEntries.sort();
      copiedRoots.sort();

      return ok({
        run_id: runId,
        root: runRoot,
        manifest_path: String(initParsed.value.manifest_path),
        gates_path: String(initParsed.value.gates_path),
        root_override: rootOverride,
        copied: {
          roots: copiedRoots,
          entries: copiedEntries,
        },
        dry_run: {
          fixture_dir: fixtureDir,
          case_id: caseId,
        },
        manifest_revision: Number(patchParsed.value.new_revision ?? 0),
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

      const writeRaw = (await (manifest_write as any).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `retry_record(${args.gate_id}#${next}): ${reason}`,
      })) as string;
      const writeObj = parseJsonSafe(writeRaw);

      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!writeObj.value?.ok) {
        return JSON.stringify(writeObj.value, null, 2);
      }

      return ok({
        gate_id: args.gate_id,
        retry_count: next,
        max_retries: max,
        attempt: next,
        audit_written: Boolean(writeObj.value.audit_written),
        audit_path: typeof writeObj.value.audit_path === "string" ? writeObj.value.audit_path : null,
      });
    } catch (e) {
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
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
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runRoot = String((manifest.artifacts as any)?.root ?? path.dirname(manifestPath));
      const runId = String(manifest.run_id ?? "");

      const wave1Dir = String((manifest.artifacts as any)?.paths?.wave1_dir ?? "wave-1");
      const perspectivesFile = String((manifest.artifacts as any)?.paths?.perspectives_file ?? "perspectives.json");

      const perspectivesPathInput = args.perspectives_path?.trim() ?? "";
      const perspectivesPath = perspectivesPathInput || path.join(runRoot, perspectivesFile);
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path ?? null });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
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

      const queryText = String((manifest.query as any)?.text ?? "");

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
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path or perspectives_path not found");
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
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
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
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "markdown_path not found", { markdown_path: markdownPath });
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
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "perspectives_path or markdown_path not found");
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
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = String((manifest.artifacts as any)?.root ?? path.dirname(manifestPath));
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const pivotFile = String((manifest.artifacts as any)?.paths?.pivot_file ?? "pivot.json");
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
        const outputMdPathRaw = normalizeWhitespace(String((outputRaw as any).output_md_path ?? ""));
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
            if ((e as any)?.code === "ENOENT") {
              return err("NOT_FOUND", "wave1 output markdown not found", {
                perspective_id: pair.perspective_id,
                output_md_path: pair.output_abs_path,
              });
            }
            throw e;
          }

          const extracted = extractPivotGapsFromMarkdown(markdown, pair.perspective_id);
          if (!extracted.ok) {
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
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "required artifact not found");
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
        if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
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
        const perspective = perspectiveMap.get(perspectiveId)!;
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

        const validationRaw = (await (wave_output_validate as any).execute({
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
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "perspectives_path or outputs_dir not found");
      return err("WRITE_FAILED", "wave review failed", { message: String(e) });
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

      const from = String((manifest.stage as any)?.current ?? "");
      const allowedStages = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"] as const;
      if (!from || !allowedStages.includes(from as any)) {
        return err("INVALID_STATE", "stage not recognized", { stage: from });
      }

      const runRoot = String((manifest.artifacts as any)?.root ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const paths = (manifest.artifacts as any)?.paths ?? {};
      const wave1Dir = String(paths.wave1_dir ?? "wave-1");
      const wave2Dir = String(paths.wave2_dir ?? "wave-2");
      const citationsDir = String(paths.citations_dir ?? "citations");
      const summariesDir = String(paths.summaries_dir ?? "summaries");
      const synthesisDir = String(paths.synthesis_dir ?? "synthesis");
      const perspectivesFile = String(paths.perspectives_file ?? "perspectives.json");
      const pivotFile = String(paths.pivot_file ?? "pivot.json");
      const summaryPackFile = String(paths.summary_pack_file ?? "summaries/summary-pack.json");

      const gates = (gatesDoc.gates as any) || {};
      const gatesRevision = Number(gatesDoc.revision ?? 0);

      const evaluated: Array<{ kind: string; name: string; ok: boolean; details: Record<string, unknown> }> = [];

      const evalArtifact = async (name: string, absPath: string) => {
        const okv = await exists(absPath);
        evaluated.push({ kind: "artifact", name, ok: okv, details: { path: absPath } });
        return okv;
      };

      const evalGatePass = (gateId: string) => {
        const gate = gates[gateId];
        const status = gate?.status;
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
            const decisionFlag = (v as any)?.decision?.wave2_required;
            const legacyFlag = (v as any).run_wave2;
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
        if (!allowedStages.includes(requested as any)) {
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
          A: gates.A?.status ?? null,
          B: gates.B?.status ?? null,
          C: gates.C?.status ?? null,
          D: gates.D?.status ?? null,
          E: gates.E?.status ?? null,
          F: gates.F?.status ?? null,
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
      const stage = (manifest.stage as any) || {};
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

      const writeRaw = (await (manifest_write as any).execute({
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
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path or gates_path not found");
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
      const currentStage = String((manifest.stage as any)?.current ?? "");
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

      const startedAtRaw = String((manifest.stage as any)?.started_at ?? "");
      const startedAt = new Date(startedAtRaw);
      if (!startedAtRaw || Number.isNaN(startedAt.getTime())) {
        return err("INVALID_STATE", "manifest.stage.started_at invalid", { started_at: startedAtRaw });
      }

      const elapsed_s = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

      if (elapsed_s <= timeout_s) {
        return ok({ timed_out: false, stage, elapsed_s, timeout_s });
      }

      const runRoot = String((manifest.artifacts as any)?.root ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const logsDir = String((manifest.artifacts as any)?.paths?.logs_dir ?? "logs");
      const checkpointPath = path.join(runRoot, logsDir, "timeout-checkpoint.md");
      const failureTs = now.toISOString();

      const checkpointContent = [
        "# Timeout Checkpoint",
        "",
        `- stage: ${stage}`,
        `- elapsed_seconds: ${elapsed_s}`,
        `- timeout_seconds: ${timeout_s}`,
        "- last_known_subtask: unavailable (placeholder)",
        "- next_steps:",
        "  1. Inspect logs/audit.jsonl for recent events.",
        "  2. Decide whether to restart this stage or abort run.",
      ].join("\n") + "\n";

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

      const writeRaw = (await (manifest_write as any).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `watchdog_check: ${reason}`,
      })) as string;

      const writeObj = parseJsonSafe(writeRaw);
      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!writeObj.value?.ok) {
        return JSON.stringify(writeObj.value, null, 2);
      }

      return ok({
        timed_out: true,
        stage,
        elapsed_s,
        timeout_s,
        checkpoint_path: checkpointPath,
        manifest_revision: Number(writeObj.value.new_revision ?? 0),
      });
    } catch (e) {
      if ((e as any)?.code === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "watchdog_check failed", { message: String(e) });
    }
  },
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

function parseJsonSafe(raw: string): { ok: true; value: any } | { ok: false; value: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}
