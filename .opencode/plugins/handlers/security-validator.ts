/**
 * PAI-OpenCode Security Validator
 *
 * Validates tool executions for security threats.
 * Equivalent to PAI's security-validator.ts hook.
 *
 * @module security-validator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileLog, fileLogError } from "../lib/file-logger";
import type { SecurityResult, PermissionInput, ToolInput } from "../adapters/types";
import { getPaiDir } from "../lib/pai-runtime";
import { ensureDir, getSecurityDir, getYearMonth } from "../lib/paths";

type UnknownRecord = Record<string, unknown>;

function summarizeArgKeys(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.slice(0, 20).join(",") + (keys.length > 20 ? ",..." : "");
}

function redactSensitiveText(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-[REDACTED]"],
    [/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_[REDACTED]"],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]"],
    [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, "xox-[REDACTED]"],
    [
      /(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g,
      "$1\n[REDACTED]\n$2",
    ],
    [
      /([?&](?:token|key|api_key|apikey|secret|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    ],
    [/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer [REDACTED]"],
    [/--password\s+\S+/gi, "--password [REDACTED]"],
    [/--token\s+\S+/gi, "--token [REDACTED]"],
    [/AWS\s*SECRET\s*ACCESS\s*KEY\s*=\s*\S+/gi, "AWS_SECRET_ACCESS_KEY<REDACTED>"],
    [/OPENAI\s*API\s*KEY\s*=\s*\S+/gi, "OPENAI_API_KEY<REDACTED>"],
  ];

  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);

  const max = 240;
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

function getCategory(toolName: string, command: string): "bash_command" | "path_access" | "other" {
  const lowerTool = toolName.toLowerCase();
  if (["read", "write", "edit", "apply_patch"].includes(lowerTool)) return "path_access";
  if (command.startsWith("read:") || command.startsWith("write:") || command.startsWith("edit:")) {
    return "path_access";
  }
  if (lowerTool === "bash") return "bash_command";
  return "other";
}

/**
 * Check if a command matches any dangerous pattern
 */
type RawRule = {
  id?: string;
  pattern: string;
  description?: string;
  severity?: string;
  suggestion?: string;
};

type CompiledRule = RawRule & { id: string; regex: RegExp };

type SecurityRules = {
  enabled: boolean;
  blockDangerous: boolean;
  requireConfirm: boolean;
  maxCommandLength?: number;
};

type SecurityConfig = {
  rules: SecurityRules;
  dangerous: CompiledRule[];
  warning: CompiledRule[];
  allowed: CompiledRule[];
  alert: CompiledRule[];
  pathRules: {
    zeroAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  };
};

let configCache: SecurityConfig | null = null;

function hashRule(pattern: string): string {
  return createHash("sha1").update(pattern).digest("hex").slice(0, 10);
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePatternsYaml(content: string): {
  dangerous: RawRule[];
  warning: RawRule[];
  allowed: RawRule[];
  alert: RawRule[];
  pathRules: {
    zeroAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  };
  rules: Partial<SecurityRules>;
} {
  // Detect upstream v2.4 schema (bash/paths). This avoids false “empty patterns”
  // when a v2.4-style USER patterns.yaml exists.
  if (/^\s*bash\s*:/m.test(content) && /^\s*paths\s*:/m.test(content)) {
    const dangerous: RawRule[] = [];
    const warning: RawRule[] = [];
    const allowed: RawRule[] = [];
    const alert: RawRule[] = [];
    const rules: Partial<SecurityRules> = {};
    const pathRules: {
      zeroAccess: string[];
      readOnly: string[];
      confirmWrite: string[];
      noDelete: string[];
    } = { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] };

    type BashList = "blocked" | "confirm" | "alert" | "";
    type PathList = "zeroAccess" | "readOnly" | "confirmWrite" | "noDelete" | "";

    let rootSection: "bash" | "paths" | "security_rules" | "" = "";
    let bashList: BashList = "";
    let pathList: PathList = "";
    let current: RawRule | null = null;

    function finishCurrent() {
      if (!current) return;
      if (!current.pattern) {
        current = null;
        return;
      }
      const asWarn: RawRule = {
        pattern: current.pattern,
        description: current.description,
      };
      if (rootSection === "bash") {
        if (bashList === "blocked") dangerous.push(asWarn);
        if (bashList === "confirm") warning.push(asWarn);
        if (bashList === "alert") alert.push(asWarn);
      }
      current = null;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.replace(/\t/g, "  ");
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;

      // Root section switches (indent 0)
      if (/^bash\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        rootSection = "bash";
        bashList = "";
        pathList = "";
        continue;
      }
      if (/^paths\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        rootSection = "paths";
        bashList = "";
        pathList = "";
        continue;
      }
      if (/^SECURITY_RULES\s*:\s*$/.test(trimmed) || /^security_rules\s*:\s*$/.test(trimmed)) {
        finishCurrent();
        rootSection = "security_rules";
        bashList = "";
        pathList = "";
        continue;
      }

      // bash lists
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

      // paths lists
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

      // SECURITY_RULES in v2.4 schema are not used; keep defaults.
      if (rootSection === "security_rules") {
        const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          if (key === "enabled") (rules as UnknownRecord).enabled = val !== "false";
        }
        continue;
      }
    }

    finishCurrent();

    return { dangerous, warning, allowed, alert, pathRules, rules };
  }

  const dangerous: RawRule[] = [];
  const warning: RawRule[] = [];
  const allowed: RawRule[] = [];
  const alert: RawRule[] = [];
  const rules: Partial<SecurityRules> = {};
  const pathRules: {
    zeroAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  } = { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] };

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

  return { dangerous, warning, allowed, alert, pathRules, rules };
}

function compileRules(raw: RawRule[]): CompiledRule[] {
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
      // Match literal substring (upstream-compatible fallback)
      try {
        compiled.push({
          ...rule,
          id: rule.id || hashRule(rule.pattern),
          regex: new RegExp(escapeRegExp(rule.pattern)),
        });
        const preview = rule.pattern.length > 120 ? `${rule.pattern.slice(0, 120)}…` : rule.pattern;
        fileLog(`Invalid regex in security patterns; using literal match: ${preview}`, "warn");
      } catch {
        // If even literal compilation fails, drop the rule.
      }
    }
  }
  return compiled;
}

function loadSecurityConfig(): SecurityConfig {
  if (configCache) return configCache;

  const paiDir = getPaiDir();
  const baseDir = path.join(paiDir, "PAISECURITYSYSTEM");
  const overridePaths = [
    // Preferred: preserved user tier (not overwritten by installer).
    path.join(paiDir, "skills", "CORE", "USER", "PAISECURITYSYSTEM", "patterns.yaml"),
    // Back-compat: legacy top-level USER dir (may not exist in runtime).
    path.join(paiDir, "USER", "PAISECURITYSYSTEM", "patterns.yaml"),
  ];
  const defaultPath = path.join(baseDir, "patterns.example.yaml");

  const overridePath = overridePaths.find((p) => fs.existsSync(p));
  const defaultContent = fs.existsSync(defaultPath) ? fs.readFileSync(defaultPath, "utf-8") : "";
  const overrideContent = overridePath ? fs.readFileSync(overridePath, "utf-8") : "";

  function parsedIsEmpty(p: ReturnType<typeof parsePatternsYaml>): boolean {
    const pr = p.pathRules;
    return (
      p.dangerous.length === 0 &&
      p.warning.length === 0 &&
      p.allowed.length === 0 &&
      p.alert.length === 0 &&
      pr.zeroAccess.length === 0 &&
      pr.readOnly.length === 0 &&
      pr.confirmWrite.length === 0 &&
      pr.noDelete.length === 0
    );
  }

  let parsed = parsePatternsYaml(overrideContent || defaultContent);

  // Critical guardrail: if an override exists but produces empty pattern sets,
  // fall back to defaults (otherwise security becomes silently disabled).
  if (overridePath && overrideContent && parsedIsEmpty(parsed) && defaultContent) {
    fileLog(
      `Security override patterns file produced zero rules; falling back to defaults: ${overridePath}`,
      "warn"
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

  const compiledPathRules = parsed.pathRules ?? {
    zeroAccess: [],
    readOnly: [],
    confirmWrite: [],
    noDelete: [],
  };

  const compiledEmpty =
    compiledDangerous.length === 0 &&
    compiledWarning.length === 0 &&
    compiledAllowed.length === 0 &&
    compiledAlert.length === 0 &&
    compiledPathRules.zeroAccess.length === 0 &&
    compiledPathRules.readOnly.length === 0 &&
    compiledPathRules.confirmWrite.length === 0 &&
    compiledPathRules.noDelete.length === 0;

  // Guardrail: if an override exists but results in empty compiled rules,
  // fall back to defaults (avoid silent security disablement).
  if (compiledEmpty && defaultContent) {
    fileLog("Security rules compiled empty; falling back to defaults", "warn");
    const fallbackParsed = parsePatternsYaml(defaultContent);
    configCache = {
      rules,
      dangerous: compileRules(fallbackParsed.dangerous),
      warning: compileRules(fallbackParsed.warning),
      allowed: compileRules(fallbackParsed.allowed),
      alert: compileRules(fallbackParsed.alert ?? []),
      pathRules:
        fallbackParsed.pathRules ?? { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
    };
    return configCache;
  }

  configCache = {
    rules,
    dangerous: compiledDangerous,
    warning: compiledWarning,
    allowed: compiledAllowed,
    alert: compiledAlert,
    pathRules: compiledPathRules,
  };

  return configCache;
}

function expandHome(p: string): string {
  if (p.startsWith("~")) {
    const home = process.env.HOME || "/Users/zuul";
    if (p === "~") return home;
    if (p.startsWith("~/")) return path.join(home, p.slice(2));
  }
  return p;
}

function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = expandHome(pattern);
  const expandedPath = path.resolve(expandHome(filePath));

  function normalize(p: string): string[] {
    // Absolute patterns (/...) and home patterns (~...) match against absolute paths.
    if (p.startsWith("/") || p.startsWith("~")) return [p];

    // For relative patterns (e.g. ".git/**", "README.md"), match anywhere.
    // Interpret as "**/<pattern>".
    return [p, `**/${p}`];
  }

  const patterns = normalize(expandedPattern);

  for (const pat of patterns) {
    // glob support: ** and *
    if (pat.includes("*")) {
      let regexPattern = pat
        .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
        .replace(/\*/g, "<<<SINGLESTAR>>>")
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/<<<DOUBLESTAR>>>/g, ".*")
        .replace(/<<<SINGLESTAR>>>/g, "[^/]*");

      try {
        const re = new RegExp(`^${regexPattern}$`);
        if (re.test(expandedPath)) return true;
      } catch {
        // ignore
      }
      continue;
    }

    const expandedPat = expandHome(pat);
    if (
      expandedPath === expandedPat ||
      expandedPath.startsWith(expandedPat.endsWith("/") ? expandedPat : expandedPat + "/")
    ) {
      return true;
    }

    // For relative non-glob patterns, also allow basename match.
    if (!expandedPat.includes("/") && path.basename(expandedPath) === expandedPat) {
      return true;
    }
  }

  return false;
}

type PathAction = "read" | "write" | "delete";

function validatePathAccess(
  filePath: string,
  action: PathAction,
  cfg: SecurityConfig
): { action: "allow" | "block" | "confirm"; reason?: string } {
  const rules = cfg.pathRules;

  for (const p of rules.zeroAccess) {
    if (matchesPathPattern(filePath, p)) {
      return { action: "block", reason: `Zero access path: ${p}` };
    }
  }

  if (action === "write" || action === "delete") {
    for (const p of rules.readOnly) {
      if (matchesPathPattern(filePath, p)) {
        return { action: "block", reason: `Read-only path: ${p}` };
      }
    }
  }

  if (action === "write") {
    for (const p of rules.confirmWrite) {
      if (matchesPathPattern(filePath, p)) {
        return { action: "confirm", reason: `Writing protected path requires confirmation: ${p}` };
      }
    }
  }

  if (action === "delete") {
    for (const p of rules.noDelete) {
      if (matchesPathPattern(filePath, p)) {
        return { action: "block", reason: `Cannot delete protected path: ${p}` };
      }
    }
  }

  return { action: "allow" };
}

function extractApplyPatchPaths(patchText: string): Array<{ action: PathAction; filePath: string }> {
  const out: Array<{ action: PathAction; filePath: string }> = [];
  const lines = patchText.split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(/^\*\*\*\s+(Add File|Update File|Delete File):\s+(.+)\s*$/);
    if (!m) continue;
    const op = m[1];
    const fp = m[2].trim();
    if (!fp) continue;
    if (op === "Delete File") out.push({ action: "delete", filePath: fp });
    else out.push({ action: "write", filePath: fp });
  }

  return out;
}

function resolveApplyPatchPaths(args: { paiDir: string; cwd: string; filePathRaw: string }): string[] {
  const raw = args.filePathRaw.trim();
  const expanded = expandHome(raw);
  if (expanded.startsWith("/")) return [path.resolve(expanded)];

  // For relative paths, OpenCode applies them relative to the session CWD.
  // Some patches may also intentionally reference runtime-relative paths.
  // Validate BOTH to avoid security bypass due to mismatched resolution.
  const candidates = [
    path.resolve(path.join(args.cwd, expanded)),
    path.resolve(path.join(args.paiDir, expanded)),
  ];
  return Array.from(new Set(candidates));
}

function matchesRule(rules: CompiledRule[], command: string): CompiledRule | null {
  for (const rule of rules) {
    if (rule.regex.test(command)) return rule;
  }
  return null;
}

async function appendSecurityLog(entry: Record<string, unknown>) {
  const dir = path.join(getSecurityDir(), getYearMonth());
  const filePath = path.join(dir, "security.jsonl");
  try {
    await ensureDir(dir);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        const rotated = filePath.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
        await fs.promises.rename(filePath, rotated);
      }
    } catch {
      // ignore
    }
    await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    fileLogError("Failed to write security log", error);
  }
}

/**
 * Extract command from tool input
 */
function extractCommand(input: PermissionInput | ToolInput): string | null {
  // Normalize tool name to lowercase for comparison
  const toolName = input.tool.toLowerCase();

  // Bash tool (handles both "bash" and "Bash")
  if (toolName === "bash" && typeof input.args?.command === "string") {
    return input.args.command;
  }

  // File tools - check for sensitive paths
  if (["write", "read", "edit", "apply_patch"].includes(toolName)) {
    // apply_patch carries file paths inside patchText; still return a non-null
    // command so validateSecurity can proceed to path checks.
    if (toolName === "apply_patch" && typeof input.args?.patchText === "string") {
      return "apply_patch";
    }

    const filePath =
      typeof input.args?.filePath === "string"
        ? input.args.filePath
        : typeof input.args?.file_path === "string"
          ? input.args.file_path
          : undefined;
    if (typeof filePath === "string") return `${toolName}:${filePath}`;
  }

  return null;
}

/**
 * Check for prompt injection patterns in content
 */
function checkPromptInjection(content: string): boolean {
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*you\s+are/i,
    /override\s+security/i,
    /disable\s+safety/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate security for a tool execution
 *
 * @param input - The tool or permission input to validate
 * @returns SecurityResult indicating what action to take
 */
export async function validateSecurity(
  input: PermissionInput | ToolInput
): Promise<SecurityResult> {
  try {
    const config = loadSecurityConfig();
    if (!config.rules.enabled) {
      return { action: "allow", reason: "Security rules disabled" };
    }

    // NOTE: loadSecurityConfig() now enforces fallback when compiled rules are empty.

    fileLog(`Security check for tool: ${input.tool}`);
    const argKeys = summarizeArgKeys(input.args);
    if (argKeys) fileLog(`Arg keys: ${argKeys}`, "debug");

    const command = extractCommand(input);

    if (!command) {
      fileLog(`No command extracted from input`, "warn");
      // No command to validate - allow by default
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "allow",
        category: "other",
        targetPreview: "",
        ruleId: "allow.no_command",
        reason: "No command to validate",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return {
        action: "allow",
        reason: "No command to validate",
      };
    }

    const redactedCommand = redactSensitiveText(command);
    const category = getCategory(input.tool, command);
    fileLog(`Extracted command: ${redactedCommand}`, "info");

    if (config.rules.maxCommandLength && command.length > config.rules.maxCommandLength) {
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "confirm",
        category,
        targetPreview: redactedCommand,
        ruleId: "len.max",
        reason: "Command length exceeds max",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return {
        action: "confirm",
        reason: "Command length exceeds configured maximum",
        message: "Command is unusually long. Please confirm.",
      };
    }

    const allowed = matchesRule(config.allowed, command);
    if (allowed) {
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "allow",
        category,
        targetPreview: redactedCommand,
        ruleId: allowed.id,
        reason: allowed.description ?? "Allowed pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return { action: "allow", reason: "Allowed pattern" };
    }

    // Check for dangerous patterns (BLOCK)
    const dangerousMatch = matchesRule(config.dangerous, command);
    if (dangerousMatch) {
      const action = config.rules.blockDangerous ? "block" : "confirm";
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action,
        category,
        targetPreview: redactedCommand,
        ruleId: dangerousMatch.id,
        reason: dangerousMatch.description ?? "Dangerous pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      fileLog(`BLOCKED: Dangerous pattern matched: ${dangerousMatch.pattern}`, "error");
      return {
        action,
        reason: `Dangerous command pattern detected: ${dangerousMatch.pattern}`,
        message:
          "This command has been blocked for security reasons. It matches a known dangerous pattern.",
      };
    }

    // Check for prompt injection in content
    if (input.args?.content && typeof input.args.content === "string") {
      if (checkPromptInjection(input.args.content)) {
        fileLog("BLOCKED: Prompt injection detected", "error");
        return {
          action: "block",
          reason: "Potential prompt injection detected in content",
          message:
            "Content appears to contain prompt injection patterns and has been blocked.",
        };
      }
    }

    // File/path tools: validate path access via path rules first.
    if (["read", "write", "edit", "apply_patch"].includes(input.tool.toLowerCase())) {
      // Special case: apply_patch carries file paths inside patchText.
      if (input.tool.toLowerCase() === "apply_patch" && typeof input.args?.patchText === "string") {
        const paiDir = getPaiDir();
        const items = extractApplyPatchPaths(input.args.patchText);

        const cwd = process.cwd();

        for (const it of items) {
          const resolvedPaths = resolveApplyPatchPaths({ paiDir, cwd, filePathRaw: it.filePath });

          let confirm: { path: string; reason?: string } | null = null;
          for (const resolvedPath of resolvedPaths) {
            const res = validatePathAccess(resolvedPath, it.action, config);
            if (res.action === "block") {
            await appendSecurityLog({
              v: "0.1",
              ts: new Date().toISOString(),
              sessionId: (input as ToolInput).sessionID ?? "",
              tool: input.tool,
              action: "block",
              category: "path_access",
              targetPreview: redactSensitiveText(resolvedPath),
              ruleId: "path.block",
              reason: res.reason ?? "Path blocked",
              sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
            });
            return {
              action: "block",
              reason: res.reason ?? "Blocked path access",
              message: "This patch targets a blocked file path.",
            };
            }
            if (res.action === "confirm" && !confirm) {
              confirm = { path: resolvedPath, reason: res.reason };
            }
          }

          if (confirm) {
            await appendSecurityLog({
              v: "0.1",
              ts: new Date().toISOString(),
              sessionId: (input as ToolInput).sessionID ?? "",
              tool: input.tool,
              action: "confirm",
              category: "path_access",
              targetPreview: redactSensitiveText(confirm.path),
              ruleId: "path.confirm",
              reason: confirm.reason ?? "Protected path write",
              sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
            });
            return {
              action: "confirm",
              reason: confirm.reason ?? "Protected path write",
              message: "This patch targets a protected file path. Please confirm.",
            };
          }
        }

        // No file paths found or all allowed.
      }

      const filePath =
        typeof input.args?.filePath === "string"
          ? (input.args.filePath as string)
          : typeof input.args?.file_path === "string"
            ? (input.args.file_path as string)
            : undefined;

      if (filePath) {
        const act: PathAction = input.tool.toLowerCase() === "read" ? "read" : "write";
        const res = validatePathAccess(filePath, act, config);
        if (res.action === "block") {
          await appendSecurityLog({
            v: "0.1",
            ts: new Date().toISOString(),
            sessionId: (input as ToolInput).sessionID ?? "",
            tool: input.tool,
            action: "block",
            category: "path_access",
            targetPreview: redactSensitiveText(filePath),
            ruleId: "path.block",
            reason: res.reason ?? "Path blocked",
            sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
          });
          return {
            action: "block",
            reason: res.reason ?? "Blocked path access",
            message: "This file path is blocked by security rules.",
          };
        }
        if (res.action === "confirm") {
          await appendSecurityLog({
            v: "0.1",
            ts: new Date().toISOString(),
            sessionId: (input as ToolInput).sessionID ?? "",
            tool: input.tool,
            action: "confirm",
            category: "path_access",
            targetPreview: redactSensitiveText(filePath),
            ruleId: "path.confirm",
            reason: res.reason ?? "Protected path write",
            sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
          });
          return {
            action: "confirm",
            reason: res.reason ?? "Protected path write",
            message: "Writing to a protected path. Please confirm.",
          };
        }
      }
    }

    // Check for warning patterns (CONFIRM)
    const warningMatch = matchesRule(config.warning, command);
    if (warningMatch) {
      const action = config.rules.requireConfirm ? "confirm" : "allow";
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action,
        category,
        targetPreview: redactedCommand,
        ruleId: warningMatch.id,
        reason: warningMatch.description ?? "Warning pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      fileLog(`CONFIRM: Warning pattern matched: ${warningMatch.pattern}`, "warn");
      return {
        action,
        reason: `Potentially dangerous command: ${warningMatch.pattern}`,
        message:
          "This command may have unintended consequences. Please confirm.",
      };
    }

    // Check for alert patterns (LOG + ALLOW)
    // NOTE: Alerts must not bypass confirm-level checks. This is intentionally
    // evaluated *after* warning patterns.
    const alertMatch = matchesRule(config.alert, command);
    if (alertMatch) {
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "allow",
        category,
        targetPreview: redactedCommand,
        ruleId: alertMatch.id,
        reason: alertMatch.description ?? "Alert pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      fileLog(`ALERT: Pattern matched (allowed): ${alertMatch.pattern}`, "warn");
      return { action: "allow", reason: "Alert pattern (logged)" };
    }

    // Check for sensitive file writes
    if (input.tool.toLowerCase() === "write") {
      const filePath =
        typeof input.args?.filePath === "string"
          ? (input.args.filePath as string)
          : typeof input.args?.file_path === "string"
            ? (input.args.file_path as string)
            : undefined;
      if (!filePath) {
        fileLog("Write tool used without file path", "warn");
        return {
          action: "allow",
          reason: "Write tool used without a file path",
        };
      }
      const sensitivePaths = [
        /\/etc\//,
        /\/var\/log\//,
        /\.ssh\//,
        /\.aws\//,
        /\.env$/,
        /credentials/i,
        /secret/i,
      ];

      for (const pattern of sensitivePaths) {
        if (pattern.test(filePath)) {
          fileLog(`CONFIRM: Sensitive file write: ${filePath}`, "warn");
          await appendSecurityLog({
            v: "0.1",
            ts: new Date().toISOString(),
            sessionId: (input as ToolInput).sessionID ?? "",
            tool: input.tool,
            action: "confirm",
            category: "path_access",
            targetPreview: redactSensitiveText(filePath),
            ruleId: "path.sensitive",
            reason: "Writing to sensitive path",
            sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
          });
          return {
            action: "confirm",
            reason: `Writing to sensitive path: ${filePath}`,
            message: "Writing to a potentially sensitive location. Please confirm.",
          };
        }
      }
    }

    // All checks passed - allow
    await appendSecurityLog({
      v: "0.1",
      ts: new Date().toISOString(),
      sessionId: (input as ToolInput).sessionID ?? "",
      tool: input.tool,
      action: "allow",
        category,
      targetPreview: redactedCommand,
      ruleId: "allow.default",
      reason: "All security checks passed",
      sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
    });
    fileLog("Security check passed", "debug");
    return {
      action: "allow",
      reason: "All security checks passed",
    };
  } catch (error) {
    fileLogError("Security validation error", error);
    // Fail-safe: require confirmation on validator errors.
    // This avoids silent fail-open while keeping a recovery path.
    return {
      action: "confirm",
      reason: "Security validator error",
      message: "Security validator encountered an error. Please confirm to proceed.",
    };
  }
}
