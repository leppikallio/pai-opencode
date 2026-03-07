import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { fileLog } from "../lib/file-logger";
import { getPaiDir } from "../lib/pai-runtime";
import {
  compileProjectRules,
  projectHasRules,
  type CompiledProjectRules,
  type PathRules,
  type RawProjectRules,
} from "./project-rules";

type UnknownRecord = Record<string, unknown>;

export type RawRule = {
  id?: string;
  pattern: string;
  description?: string;
  severity?: string;
  suggestion?: string;
};

export type CompiledRule = RawRule & { id: string; regex: RegExp };

export type SecurityRules = {
  enabled: boolean;
  blockDangerous: boolean;
  requireConfirm: boolean;
  maxCommandLength?: number;
};

export type SecurityConfig = {
  rules: SecurityRules;
  dangerous: CompiledRule[];
  warning: CompiledRule[];
  allowed: CompiledRule[];
  alert: CompiledRule[];
  projects: CompiledProjectRules<CompiledRule>[];
  pathRules: PathRules;
};

type ParsedPatterns = {
  dangerous: RawRule[];
  warning: RawRule[];
  allowed: RawRule[];
  alert: RawRule[];
  projects: RawProjectRules<RawRule>[];
  pathRules: PathRules;
  rules: Partial<SecurityRules>;
};

type SecurityConfigCache = {
  key: string;
  config: SecurityConfig;
};

export type SecurityPolicyLoader = {
  loadSecurityConfig(): SecurityConfig;
  resetCache(): void;
};

function hashRule(pattern: string): string {
  return createHash("sha1").update(pattern).digest("hex").slice(0, 10);
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function createEmptyPathRules(): PathRules {
  return { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] };
}

function parsePatternsYaml(content: string): ParsedPatterns {
  if (/^\s*bash\s*:/m.test(content) && /^\s*paths\s*:/m.test(content)) {
    const dangerous: RawRule[] = [];
    const warning: RawRule[] = [];
    const allowed: RawRule[] = [];
    const alert: RawRule[] = [];
    const projects: RawProjectRules<RawRule>[] = [];
    const rules: Partial<SecurityRules> = {};
    const pathRules = createEmptyPathRules();

    type BashList = "blocked" | "confirm" | "alert" | "";
    type PathList = "zeroAccess" | "readOnly" | "confirmWrite" | "noDelete" | "";

    let rootSection: "bash" | "paths" | "security_rules" | "projects" | "" = "";
    let bashList: BashList = "";
    let pathList: PathList = "";
    let current: RawRule | null = null;

    let currentProject: RawProjectRules<RawRule> | null = null;
    let projectSection: "cwd" | "bash" | "paths" | "" = "";
    let projectBashList: BashList = "";
    let projectPathList: PathList = "";
    let currentProjectRule: RawRule | null = null;

    function finishCurrent(): void {
      if (!current) return;
      if (!current.pattern) {
        current = null;
        return;
      }

      const asRule: RawRule = {
        pattern: current.pattern,
        description: current.description,
      };

      if (rootSection === "bash") {
        if (bashList === "blocked") dangerous.push(asRule);
        if (bashList === "confirm") warning.push(asRule);
        if (bashList === "alert") alert.push(asRule);
      }

      current = null;
    }

    function finishProjectRule(): void {
      if (!currentProjectRule || !currentProject) return;
      if (!currentProjectRule.pattern) {
        currentProjectRule = null;
        return;
      }

      const asRule: RawRule = {
        pattern: currentProjectRule.pattern,
        description: currentProjectRule.description,
      };

      if (projectBashList === "blocked") currentProject.dangerous.push(asRule);
      if (projectBashList === "confirm") currentProject.warning.push(asRule);
      if (projectBashList === "alert") currentProject.alert.push(asRule);
      currentProjectRule = null;
    }

    function finishCurrentProject(): void {
      finishProjectRule();
      currentProject = null;
      projectSection = "";
      projectBashList = "";
      projectPathList = "";
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.replace(/\t/g, "  ");
      const trimmed = line.trim();
      const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
      if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;

      if (indent === 0 && /^bash\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        finishCurrentProject();
        rootSection = "bash";
        bashList = "";
        pathList = "";
        continue;
      }
      if (indent === 0 && /^paths\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        finishCurrentProject();
        rootSection = "paths";
        bashList = "";
        pathList = "";
        continue;
      }
      if (
        indent === 0 &&
        (/^SECURITY_RULES\s*:\s*$/.test(trimmed) || /^security_rules\s*:\s*$/.test(trimmed))
      ) {
        finishCurrent();
        finishCurrentProject();
        rootSection = "security_rules";
        bashList = "";
        pathList = "";
        continue;
      }
      if (indent === 0 && /^projects\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        finishCurrentProject();
        rootSection = "projects";
        bashList = "";
        pathList = "";
        continue;
      }

      if (rootSection === "bash") {
        if (/^blocked\s*:\s*$/.test(trimmed)) {
          finishCurrent();
          bashList = "blocked";
          continue;
        }
        if (/^confirm\s*:\s*$/.test(trimmed)) {
          finishCurrent();
          bashList = "confirm";
          continue;
        }
        if (/^alert\s*:\s*$/.test(trimmed)) {
          finishCurrent();
          bashList = "alert";
          continue;
        }

        if (trimmed.startsWith("-")) {
          finishCurrent();
          current = { pattern: "" };
          const inline = trimmed.replace(/^[-\s]+/, "");
          const match = inline.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
          if (match) {
            const key = match[1];
            const val = stripQuotes(match[2]);
            if (key === "pattern") current.pattern = val;
            if (key === "reason") current.description = val;
            if (key === "description") current.description = val;
          }
          continue;
        }

        if (current) {
          const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
          if (match) {
            const key = match[1];
            const val = stripQuotes(match[2]);
            if (key === "pattern") current.pattern = val;
            if (key === "reason") current.description = val;
            if (key === "description") current.description = val;
          }
        }

        continue;
      }

      if (rootSection === "projects") {
        if (trimmed === "{}") {
          finishCurrentProject();
          continue;
        }

        const projectMatch = indent === 2 ? trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*$/) : null;
        if (projectMatch) {
          finishCurrentProject();
          currentProject = {
            id: projectMatch[1],
            cwd: [],
            dangerous: [],
            warning: [],
            allowed: [],
            alert: [],
            pathRules: createEmptyPathRules(),
          };
          projects.push(currentProject);
          continue;
        }

        if (!currentProject) {
          continue;
        }

        if (indent === 4 && /^cwd\s*:\s*$/.test(trimmed)) {
          finishProjectRule();
          projectSection = "cwd";
          projectBashList = "";
          projectPathList = "";
          continue;
        }
        if (indent === 4 && /^bash\s*:\s*$/.test(trimmed)) {
          finishProjectRule();
          projectSection = "bash";
          projectBashList = "";
          projectPathList = "";
          continue;
        }
        if (indent === 4 && /^paths\s*:\s*$/.test(trimmed)) {
          finishProjectRule();
          projectSection = "paths";
          projectBashList = "";
          projectPathList = "";
          continue;
        }

        if (projectSection === "cwd") {
          if (trimmed.startsWith("-")) {
            const selector = stripQuotes(trimmed.replace(/^[-\s]+/, ""));
            if (selector) {
              currentProject.cwd.push(selector);
            }
          }
          continue;
        }

        if (projectSection === "bash") {
          if (/^blocked\s*:\s*$/.test(trimmed)) {
            finishProjectRule();
            projectBashList = "blocked";
            continue;
          }
          if (/^confirm\s*:\s*$/.test(trimmed)) {
            finishProjectRule();
            projectBashList = "confirm";
            continue;
          }
          if (/^alert\s*:\s*$/.test(trimmed)) {
            finishProjectRule();
            projectBashList = "alert";
            continue;
          }

          if (trimmed.startsWith("-")) {
            finishProjectRule();
            currentProjectRule = { pattern: "" };
            const inline = trimmed.replace(/^[-\s]+/, "");
            const match = inline.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
            if (match) {
              const key = match[1];
              const val = stripQuotes(match[2]);
              if (key === "pattern") currentProjectRule.pattern = val;
              if (key === "reason") currentProjectRule.description = val;
              if (key === "description") currentProjectRule.description = val;
            }
            continue;
          }

          if (currentProjectRule) {
            const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
            if (match) {
              const key = match[1];
              const val = stripQuotes(match[2]);
              if (key === "pattern") currentProjectRule.pattern = val;
              if (key === "reason") currentProjectRule.description = val;
              if (key === "description") currentProjectRule.description = val;
            }
          }

          continue;
        }

        if (projectSection === "paths") {
          if (/^zeroAccess\s*:\s*$/.test(trimmed)) {
            projectPathList = "zeroAccess";
            continue;
          }
          if (/^readOnly\s*:\s*$/.test(trimmed)) {
            projectPathList = "readOnly";
            continue;
          }
          if (/^confirmWrite\s*:\s*$/.test(trimmed)) {
            projectPathList = "confirmWrite";
            continue;
          }
          if (/^noDelete\s*:\s*$/.test(trimmed)) {
            projectPathList = "noDelete";
            continue;
          }

          if (trimmed.startsWith("-")) {
            const item = stripQuotes(trimmed.replace(/^[-\s]+/, ""));
            if (!item) continue;
            if (projectPathList === "zeroAccess") currentProject.pathRules.zeroAccess.push(item);
            if (projectPathList === "readOnly") currentProject.pathRules.readOnly.push(item);
            if (projectPathList === "confirmWrite") currentProject.pathRules.confirmWrite.push(item);
            if (projectPathList === "noDelete") currentProject.pathRules.noDelete.push(item);
          }

          continue;
        }

        continue;
      }

      if (rootSection === "paths") {
        if (/^zeroAccess\s*:\s*$/.test(trimmed)) {
          pathList = "zeroAccess";
          continue;
        }
        if (/^readOnly\s*:\s*$/.test(trimmed)) {
          pathList = "readOnly";
          continue;
        }
        if (/^confirmWrite\s*:\s*$/.test(trimmed)) {
          pathList = "confirmWrite";
          continue;
        }
        if (/^noDelete\s*:\s*$/.test(trimmed)) {
          pathList = "noDelete";
          continue;
        }

        if (trimmed.startsWith("-")) {
          const item = stripQuotes(trimmed.replace(/^[-\s]+/, ""));
          if (!item) continue;
          if (pathList === "zeroAccess") pathRules.zeroAccess.push(item);
          if (pathList === "readOnly") pathRules.readOnly.push(item);
          if (pathList === "confirmWrite") pathRules.confirmWrite.push(item);
          if (pathList === "noDelete") pathRules.noDelete.push(item);
        }

        continue;
      }

      if (rootSection === "security_rules") {
        const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          if (key === "enabled") {
            (rules as UnknownRecord).enabled = val !== "false";
          }
        }
      }
    }

    finishCurrent();
    finishCurrentProject();

    return { dangerous, warning, allowed, alert, projects, pathRules, rules };
  }

  const dangerous: RawRule[] = [];
  const warning: RawRule[] = [];
  const allowed: RawRule[] = [];
  const alert: RawRule[] = [];
  const projects: RawProjectRules<RawRule>[] = [];
  const rules: Partial<SecurityRules> = {};
  const pathRules = createEmptyPathRules();

  let section = "";
  let current: RawRule | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^([A-Z_]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      current = null;
      continue;
    }

    if (["DANGEROUS_PATTERNS", "WARNING_PATTERNS", "ALLOWED_PATTERNS"].includes(section)) {
      if (trimmed.startsWith("-")) {
        current = { pattern: "" };
        const inline = trimmed.replace(/^[-\s]+/, "");
        const match = inline.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          (current as UnknownRecord)[key] = val;
        }
        if (section === "DANGEROUS_PATTERNS") dangerous.push(current);
        if (section === "WARNING_PATTERNS") warning.push(current);
        if (section === "ALLOWED_PATTERNS") allowed.push(current);
        continue;
      }
      if (current) {
        const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          (current as UnknownRecord)[key] = val;
        }
      }
      continue;
    }

    if (section === "SECURITY_RULES") {
      const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
      if (!match) continue;

      const key = match[1];
      const val = stripQuotes(match[2]);
      if (val === "true" || val === "false") {
        (rules as UnknownRecord)[key] = val === "true";
      } else if (/^\d+$/.test(val)) {
        (rules as UnknownRecord)[key] = Number(val);
      } else {
        (rules as UnknownRecord)[key] = val;
      }
    }
  }

  return { dangerous, warning, allowed, alert, projects, pathRules, rules };
}

export function compileRules(raw: RawRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  for (const rule of raw) {
    if (!rule.pattern) continue;
    try {
      compiled.push({
        ...rule,
        id: rule.id || hashRule(rule.pattern),
        regex: new RegExp(rule.pattern),
      });
    } catch {
      try {
        compiled.push({
          ...rule,
          id: rule.id || hashRule(rule.pattern),
          regex: new RegExp(escapeRegExp(rule.pattern)),
        });
        const preview = rule.pattern.length > 120 ? `${rule.pattern.slice(0, 120)}…` : rule.pattern;
        fileLog(`Invalid regex in security patterns; using literal match: ${preview}`, "warn");
      } catch {
        // Drop rule if even literal pattern fails.
      }
    }
  }

  return compiled;
}

function parsedIsEmpty(parsed: ParsedPatterns): boolean {
  const hasProjectRules = parsed.projects.some((project) => projectHasRules(project));
  const hasRulesOverride = Object.values(parsed.rules as UnknownRecord).some(
    (value) => value !== undefined,
  );

  return (
    parsed.dangerous.length === 0 &&
    parsed.warning.length === 0 &&
    parsed.allowed.length === 0 &&
    parsed.alert.length === 0 &&
    parsed.pathRules.zeroAccess.length === 0 &&
    parsed.pathRules.readOnly.length === 0 &&
    parsed.pathRules.confirmWrite.length === 0 &&
    parsed.pathRules.noDelete.length === 0 &&
    !hasProjectRules &&
    !hasRulesOverride
  );
}

function makePathStatKey(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

function buildCacheKey(paiDir: string, defaultPath: string, overridePath?: string): string {
  const keys = [
    `paiDir:${paiDir}`,
    makePathStatKey(defaultPath),
    overridePath ? makePathStatKey(overridePath) : "override:missing",
  ];
  return keys.join("|");
}

export function createSecurityPolicyLoader(options?: {
  paiDir?: string;
  resolvePaiDir?: () => string;
}): SecurityPolicyLoader {
  let cache: SecurityConfigCache | null = null;

  const resolvePaiDir =
    options?.resolvePaiDir ??
    (() => {
      if (options?.paiDir) {
        return options.paiDir;
      }

      return getPaiDir();
    });

  function loadSecurityConfig(): SecurityConfig {
    const paiDir = resolvePaiDir();
    const baseDir = path.join(paiDir, "PAISECURITYSYSTEM");
    const overridePaths = [
      path.join(paiDir, "skills", "PAI", "USER", "PAISECURITYSYSTEM", "patterns.yaml"),
      path.join(paiDir, "USER", "PAISECURITYSYSTEM", "patterns.yaml"),
    ];
    const defaultPath = path.join(baseDir, "patterns.example.yaml");
    const overridePath = overridePaths.find((candidatePath) => fs.existsSync(candidatePath));
    const cacheKey = buildCacheKey(paiDir, defaultPath, overridePath);

    if (cache && cache.key === cacheKey) {
      return cache.config;
    }

    const defaultContent = fs.existsSync(defaultPath) ? fs.readFileSync(defaultPath, "utf-8") : "";
    const overrideContent = overridePath ? fs.readFileSync(overridePath, "utf-8") : "";

    let parsed = parsePatternsYaml(overrideContent || defaultContent);

    if (overridePath && overrideContent && parsedIsEmpty(parsed) && defaultContent) {
      fileLog(
        `Security override patterns file produced zero rules; falling back to defaults: ${overridePath}`,
        "warn",
      );
      parsed = parsePatternsYaml(defaultContent);
    }

    const rawMax = (parsed.rules as UnknownRecord).max_command_length;
    const maxCommandLength =
      typeof parsed.rules.maxCommandLength === "number"
        ? parsed.rules.maxCommandLength
        : typeof rawMax === "number"
          ? rawMax
          : undefined;

    const rules: SecurityRules = {
      enabled: parsed.rules.enabled !== false,
      blockDangerous:
        parsed.rules.blockDangerous ?? (parsed.rules as UnknownRecord).block_dangerous !== false,
      requireConfirm:
        parsed.rules.requireConfirm ??
        (parsed.rules as UnknownRecord).require_confirmation_for_warnings !== false,
      maxCommandLength,
    };

    const compiledDangerous = compileRules(parsed.dangerous);
    const compiledWarning = compileRules(parsed.warning);
    const compiledAllowed = compileRules(parsed.allowed);
    const compiledAlert = compileRules(parsed.alert ?? []);
    const compiledPathRules = parsed.pathRules ?? createEmptyPathRules();
    const compiledProjects = compileProjectRules(parsed.projects ?? [], compileRules);

    const compiledEmpty =
      compiledDangerous.length === 0 &&
      compiledWarning.length === 0 &&
      compiledAllowed.length === 0 &&
      compiledAlert.length === 0 &&
      compiledPathRules.zeroAccess.length === 0 &&
      compiledPathRules.readOnly.length === 0 &&
      compiledPathRules.confirmWrite.length === 0 &&
      compiledPathRules.noDelete.length === 0 &&
      compiledProjects.length === 0;

    if (compiledEmpty && defaultContent) {
      fileLog("Security rules compiled empty; falling back to defaults", "warn");
      const fallbackParsed = parsePatternsYaml(defaultContent);
      const config: SecurityConfig = {
        rules,
        dangerous: compileRules(fallbackParsed.dangerous),
        warning: compileRules(fallbackParsed.warning),
        allowed: compileRules(fallbackParsed.allowed),
        alert: compileRules(fallbackParsed.alert ?? []),
        projects: compileProjectRules(fallbackParsed.projects ?? [], compileRules),
        pathRules: fallbackParsed.pathRules ?? createEmptyPathRules(),
      };
      cache = { key: cacheKey, config };
      return config;
    }

    const config: SecurityConfig = {
      rules,
      dangerous: compiledDangerous,
      warning: compiledWarning,
      allowed: compiledAllowed,
      alert: compiledAlert,
      projects: compiledProjects,
      pathRules: compiledPathRules,
    };

    cache = { key: cacheKey, config };
    return config;
  }

  function resetCache(): void {
    cache = null;
  }

  return {
    loadSecurityConfig,
    resetCache,
  };
}

const defaultSecurityPolicyLoader = createSecurityPolicyLoader();

export function loadSecurityConfig(): SecurityConfig {
  return defaultSecurityPolicyLoader.loadSecurityConfig();
}

export function resetSecurityPolicyCache(): void {
  defaultSecurityPolicyLoader.resetCache();
}
