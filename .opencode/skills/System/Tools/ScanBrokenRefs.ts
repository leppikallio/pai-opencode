#!/usr/bin/env bun
/**
 * ScanBrokenRefs.ts
 *
 * Scan markdown files for local file path references that do not exist.
 *
 * Design goals:
 * - High signal, low noise (ignore shell commands and placeholders)
 * - Only validate references that should exist inside ~/.config/opencode
 */

import fs from "node:fs";
import path from "node:path";

type Format = "text" | "json";

type Finding = {
  source: string;
  raw: string;
  resolved: string;
};

function usage(exitCode = 0): never {
  const msg = `Usage: bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts [options]

Options:
  --root <dir>          Root PAI dir (default: PAI_DIR or ~/.config/opencode)
  --scope <dir>         Directory to scan (default: <root>/skills)
  --format <text|json>  Output format (default: text)
  --verbose             Print root/scope and extra context
  --limit <n>           Max findings to print (default: 200)
  --allow-standalone    Allow running outside IntegrityCheck
  --help                Show this help

Notes:
  - Only checks references that look like file paths.
  - Ignores placeholders (YYYY/MM/DD, <slug>, etc) and shell commands.
  - By default, this tool refuses to run unless it is invoked from the
    IntegrityCheck workflow (env: PAI_INTEGRITYCHECK=1).
`;
  // eslint-disable-next-line no-console
  console.log(msg);
  process.exit(exitCode);
}

function homedir(): string {
  return process.env.HOME || "/Users/zuul";
}

function defaultRoot(): string {
  const env = process.env.PAI_DIR;
  if (env && env.trim()) return env.trim();
  return path.join(homedir(), ".config", "opencode");
}

function looksLikePlaceholder(s: string): boolean {
  return (
    /<[^>]+>/.test(s) ||
    /\bYYYY\b|\bMM\b|\bDD\b|\bHH\b|\bNN\b/i.test(s) ||
    /\$\{|\{slug\}|\{date\}|\{\w+\}/i.test(s) ||
    /[{}]/.test(s) ||
    /\$[A-Z0-9_]+/i.test(s) ||
    /\[.*\]/.test(s) ||
    /\*/.test(s)
  );
}

function looksLikeCommand(s: string): boolean {
  // Inline code that contains spaces is usually a command, not a path.
  if (/\s/.test(s)) return true;
  // Common command separators.
  if (s.includes("&&") || s.includes("|") || s.includes(";")) return true;
  return false;
}

function isLikelyPathToken(s: string): boolean {
  if (!s) return false;
  if (s.includes("\n") || s.includes("\r")) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return false;
  if (looksLikePlaceholder(s)) return false;
  if (looksLikeCommand(s)) return false;
  if (s.includes("...")) return false;

  // Only validate file-like refs.
  const hasSlash = s.includes("/");
  const hasExt = /\.(help\.md|jsonl|json|yaml|yml|md|ts|js|txt|sh)$/i.test(s);
  if (!hasSlash || !hasExt) return false;

  // Do not validate optional customizations.
  if (s.includes("SKILLCUSTOMIZATIONS/")) return false;
  if (s.includes("skills/PAI/WORK/")) return false;
  if (s.includes("skills/CORE/WORK/")) return false;

  return true;
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

function isTrueEnv(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function resolveRef(rootDir: string, sourceFile: string, raw: string): string | null {
  let r = raw.trim();
  if (!isLikelyPathToken(r)) return null;

  // Trim common markdown punctuation wrappers.
  r = r.replace(/^[(*_\[]+/, "");
  r = r.replace(/[)\]*_.,;:]+$/, "");

  // Strip anchors.
  r = r.split("#")[0];
  r = r.replace(/^file:\/\//, "");
  r = expandTilde(r);

  // Absolute.
  if (r.startsWith("/")) return r;

  // Runtime-root explicit.
  if (r.startsWith("~/.config/opencode/")) {
    return path.join(homedir(), r.slice(2));
  }

  // Runtime-root shorthands.
  for (const prefix of [
    "skills/",
    "plugins/",
    "docs/",
    "pai-tools/",
    "PAISECURITYSYSTEM/",
    "config/",
    "security/",
    "MEMORY/",
    "History/",
  ]) {
    if (r.startsWith(prefix)) return path.join(rootDir, r);
  }

  // Skill-relative shorthands.
  if (r.startsWith("Workflows/") || r.startsWith("Tools/") || r.startsWith("Templates/")) {
    return path.join(path.dirname(sourceFile), r);
  }

  // Relative path.
  if (r.startsWith("./") || r.startsWith("../")) {
    return path.resolve(path.join(path.dirname(sourceFile), r));
  }

  // Unknown relative: resolve relative to source file.
  return path.resolve(path.join(path.dirname(sourceFile), r));
}

function iterMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];

  while (stack.length) {
    const d = stack.pop();
    if (!d) continue;

    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }

      for (const ent of ents) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          // Ignore vendored dependencies and build artifacts.
          if (ent.name === "node_modules") continue;
          if (ent.name === ".git") continue;
          if (ent.name === "dist" || ent.name === "build") continue;

          // Ignore skill build sources (generated into SKILL.md).
          if (ent.name === "Components") continue;

        // Do not scan private tiers.
        if (full.includes(path.join("skills", "PAI", "USER"))) continue;
        if (full.includes(path.join("skills", "PAI", "WORK"))) continue;
        if (full.includes(path.join("skills", "CORE", "USER"))) continue;
        if (full.includes(path.join("skills", "CORE", "WORK"))) continue;

        stack.push(full);
        } else if (ent.isFile() && ent.name.endsWith(".md")) {
          out.push(full);
        }
      }
  }

  return out;
}

function extractInlineCodeTokens(text: string): string[] {
  // Inline backticks only; never multi-line.
  const tokens: string[] = [];
  const re = /`([^`\n\r]+)`/g;
  for (const m of text.matchAll(re)) tokens.push(m[1]);
  return tokens;
}

function extractMarkdownLinkTargets(text: string): string[] {
  const targets: string[] = [];
  const re = /\]\(([^)\n\r]+)\)/g;
  for (const m of text.matchAll(re)) targets.push(m[1]);
  return targets;
}

function extractPathCandidates(text: string): string[] {
  // Find path-like strings even when not in backticks/links.
  // Keep this conservative: only look for runtime-root-ish prefixes and file extensions.
  const candidates: string[] = [];

  // IMPORTANT:
  // - Require a boundary before the token to avoid matching inside '.config/opencode'
  //   (e.g. '$HOME/.config/opencode/...' contains 'config/opencode/...').
  // - Order extensions with longer ones first so '.json' is not matched as '.js'.
  const re =
    /(^|[\s`"(])(<?(?:~\/\.config\/opencode\/|\/Users\/[^\s]+\/\.config\/opencode\/|skills\/|plugins\/|docs\/|pai-tools\/|PAISECURITYSYSTEM\/|config\/|security\/|MEMORY\/|History\/)[^\s`"')\]]+\.(?:help\.md|jsonl|json|yaml|yml|md|ts|txt|sh|js)(?:#[^\s`"')\]]+)?\>?)/gim;

  for (const m of text.matchAll(re)) candidates.push(m[2]);
  return candidates;
}

function stripFencedCodeBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  let inFence = false;
  let fenceToken: "```" | "~~~" | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (!inFence) {
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inFence = true;
        fenceToken = trimmed.startsWith("~~~") ? "~~~" : "```";
        continue;
      }
      out.push(line);
      continue;
    }

    // In fence: wait for closing fence.
    if (fenceToken && trimmed.startsWith(fenceToken)) {
      inFence = false;
      fenceToken = null;
      continue;
    }
  }

  return out.join("\n");
}

function main() {
  const argv = process.argv.slice(2);

  let rootDir = defaultRoot();
  let scopeDir = "";
  let format: Format = "text";
  let verbose = false;
  let limit = 200;
  let allowStandalone = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);

    if (a === "--root") {
      const v = argv[++i];
      if (!v) usage(2);
      rootDir = v;
      continue;
    }

    if (a === "--scope") {
      const v = argv[++i];
      if (!v) usage(2);
      scopeDir = v;
      continue;
    }

    if (a === "--format") {
      const v = argv[++i];
      if (v !== "text" && v !== "json") usage(2);
      format = v;
      continue;
    }

    if (a === "--verbose") {
      verbose = true;
      continue;
    }

    if (a === "--limit") {
      const v = argv[++i];
      const n = v ? Number(v) : NaN;
      if (!Number.isFinite(n) || n <= 0) usage(2);
      limit = n;
      continue;
    }

    if (a === "--allow-standalone") {
      allowStandalone = true;
      continue;
    }

    usage(2);
  }

  const isIntegrityCheck = isTrueEnv(process.env.PAI_INTEGRITYCHECK);
  if (!isIntegrityCheck && !allowStandalone) {
    // eslint-disable-next-line no-console
    console.error(
      "ScanBrokenRefs: refusing to run outside IntegrityCheck. " +
        "Set PAI_INTEGRITYCHECK=1 (workflow) or pass --allow-standalone."
    );
    process.exit(2);
  }

  rootDir = expandTilde(rootDir);

  if (!scopeDir) scopeDir = path.join(rootDir, "skills");
  scopeDir = expandTilde(scopeDir);

  if (!fs.existsSync(scopeDir)) {
    // eslint-disable-next-line no-console
    console.error(`ScanBrokenRefs: scope does not exist: ${scopeDir}`);
    process.exit(2);
  }

  const files = iterMarkdownFiles(scopeDir);
  const findings: Finding[] = [];

  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf-8");
    } catch {
      continue;
    }

    const includeFences =
      f.includes(`${path.sep}Workflows${path.sep}`) ||
      f.includes(`${path.sep}Agents${path.sep}`) ||
      f.endsWith(`${path.sep}SKILL.md`);

    // Reduce noise in general docs, but keep fences for workflows (commands are executable instructions).
    const searchable = includeFences ? text : stripFencedCodeBlocks(text);

    const tokens = [
      ...extractInlineCodeTokens(searchable),
      ...extractMarkdownLinkTargets(searchable),
      ...extractPathCandidates(searchable),
    ];

    const seen = new Set<string>();
    for (const raw of tokens) {
      const resolved = resolveRef(rootDir, f, raw);
      if (!resolved) continue;

      // Only validate refs that should exist within runtime root.
      if (!resolved.startsWith(rootDir)) continue;

      const key = `${f}::${resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!fs.existsSync(resolved)) {
        findings.push({ source: f, raw, resolved });
      }
    }
  }

  if (format === "json") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ rootDir, scopeDir, count: findings.length, findings }, null, 2));
    return;
  }

  // text
  // eslint-disable-next-line no-console
  console.log(`ScanBrokenRefs: ${findings.length} missing reference(s)`);
  if (verbose) {
    // eslint-disable-next-line no-console
    console.log(`root:  ${rootDir}`);
    // eslint-disable-next-line no-console
    console.log(`scope: ${scopeDir}`);
  }

  const toPrint = findings.slice(0, limit);
  for (const f of toPrint) {
    // eslint-disable-next-line no-console
    console.log(`- ${f.resolved} (from ${f.source})`);
  }

  if (findings.length > toPrint.length) {
    // eslint-disable-next-line no-console
    console.log(`... and ${findings.length - toPrint.length} more`);
  }
}

main();
