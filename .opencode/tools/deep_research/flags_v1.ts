import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { DeepResearchFlagsV1, RunMode } from "./types";
import {
  getObjectProp,
  parseAbsolutePathSetting,
  parseBool,
  parseEnum,
  parseIntSafe,
} from "./utils";

export function integrationRootFromToolFile(): string {
  // Works both in repo (.opencode/tools/...) and runtime (~/.config/opencode/tools/...).
  const toolFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(toolFile), "..", "..");
}

export function readSettingsJson(root: string): Record<string, unknown> | null {
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
  let citationsBrightDataEndpoint: string | null = null;
  let citationsApifyEndpoint: string | null = null;
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
  applySetting("PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT", (flags) => {
    const endpoint = String(flags["PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT"] ?? "").trim();
    citationsBrightDataEndpoint = endpoint || null;
  });
  applySetting("PAI_DR_CITATIONS_APIFY_ENDPOINT", (flags) => {
    const endpoint = String(flags["PAI_DR_CITATIONS_APIFY_ENDPOINT"] ?? "").trim();
    citationsApifyEndpoint = endpoint || null;
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
  applyEnv("PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT", (v) => {
    const endpoint = String(v ?? "").trim();
    citationsBrightDataEndpoint = endpoint || null;
  });
  applyEnv("PAI_DR_CITATIONS_APIFY_ENDPOINT", (v) => {
    const endpoint = String(v ?? "").trim();
    citationsApifyEndpoint = endpoint || null;
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
    citationsBrightDataEndpoint,
    citationsApifyEndpoint,
    noWeb,
    runsRoot,
    source,
  };
}
