#!/usr/bin/env bun
/*
 * ImportSkill.ts
 *
 * Copy a skill directory into a destination skills root with minimal canonicalization.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";

type CanonicalizeMode = "none" | "minimal" | "strict";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
]);

type Args = {
  source?: string;
  dest?: string;
  name?: string;
  force: boolean;
  dryRun: boolean;
  validate: boolean;
  canonicalize: CanonicalizeMode;
};

function printHelp(): void {
  // Keep in sync with ImportSkill.help.md
  process.stdout.write(`\
ImportSkill - import a skill directory

Usage:
  bun ImportSkill.ts --source <dir> --dest <skills-root> [options]

Options:
  --name <skill-name>           Override destination skill name (canonicalized to kebab-case)
  --canonicalize <mode>         none | minimal | strict (default: minimal)
  --no-validate                 Skip automatic post-import checks
  --force                       Overwrite destination if it exists
  --dry-run                     Print actions without changing files
  --help                        Show help

Minimal canonicalization includes:
  - rewrite \${PAI_DIR}/$PAI_DIR -> ~/.config/opencode
  - rename CLAUDE.md -> REFERENCE.md and update links
  - convert SkillSearch(...) phrasing in SKILL.md description to skill_find guidance

Post-import checks (enabled by default):
  - SKILL.md frontmatter parseability + name/description constraints
  - no SkillSearch( usage in SKILL.md
`);
}

function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function isKebabSkillName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

function toKebabSkillName(input: string): string {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[\s_./]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
}

function toSingleLine(input: string): string {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    force: false,
    dryRun: false,
    validate: true,
    canonicalize: "minimal",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }

    if (a === "--force") {
      args.force = true;
      continue;
    }

    if (a === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (a === "--no-validate") {
      args.validate = false;
      continue;
    }

    if (a === "--source") {
      args.source = argv[++i];
      continue;
    }

    if (a === "--dest") {
      args.dest = argv[++i];
      continue;
    }

    if (a === "--name") {
      args.name = argv[++i];
      continue;
    }

    if (a === "--canonicalize") {
      const mode = argv[++i] as CanonicalizeMode | undefined;
      if (!mode || !["none", "minimal", "strict"].includes(mode)) {
        die(`Invalid --canonicalize mode: ${mode ?? "(missing)"}`);
      }
      args.canonicalize = mode;
      continue;
    }

    die(`Unknown argument: ${a}`);
  }

  return args;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    process.stdout.write(`[dry-run] mkdir -p ${p}\n`);
    return;
  }
  await fs.mkdir(p, { recursive: true });
}

async function removeDir(p: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    process.stdout.write(`[dry-run] rm -rf ${p}\n`);
    return;
  }
  await fs.rm(p, { recursive: true, force: true });
}

async function copyDirRecursive(source: string, dest: string, dryRun: boolean): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await ensureDir(dest, dryRun);

  for (const entry of entries) {
    if (entry.name === ".git") continue;

    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath, dryRun);
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Preserve symlinks as symlinks.
      const linkTarget = await fs.readlink(srcPath);
      if (dryRun) {
        process.stdout.write(`[dry-run] ln -s ${linkTarget} ${dstPath}\n`);
      } else {
        await fs.symlink(linkTarget, dstPath);
      }
      continue;
    }

    if (dryRun) {
      process.stdout.write(`[dry-run] cp ${srcPath} ${dstPath}\n`);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) out.push(abs);
    }
  }

  await walk(root);
  return out;
}

function shouldProcessTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function rewriteImportedContent(
  input: string,
  opts: {
    legacySkillNames: string[];
    canonicalSkillName: string;
  },
): { output: string; changed: boolean } {
  let output = input;

  // Expand import-time environment placeholders to explicit runtime path.
  output = output.replace(/\$\{PAI_DIR\}/g, "~/.config/opencode");
  output = output.replace(/\$PAI_DIR\b/g, "~/.config/opencode");

  // Normalize legacy Claude reference docs to OpenCode reference naming.
  output = output.replace(/\bCLAUDE\.md\b/g, "REFERENCE.md");

  // Normalize obvious self-references from legacy skill dir name to canonical destination name.
  for (const legacy of opts.legacySkillNames) {
    if (!legacy || legacy === opts.canonicalSkillName) continue;
    const esc = legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reRuntime = new RegExp(`(~\\/\\.config\\/opencode\\/skills\\/)${esc}(\\/)`, "g");
    const reAbsRuntime = new RegExp(`(\\/Users\\/[^/]+\\/\\.config\\/opencode\\/skills\\/)${esc}(\\/)`, "g");
    const reRepo = new RegExp(`(\\.opencode\\/skills\\/)${esc}(\\/)`, "g");
    const reGeneric = new RegExp(`(skills\\/)${esc}(\\/)`, "g");

    output = output.replace(reRuntime, `$1${opts.canonicalSkillName}$2`);
    output = output.replace(reAbsRuntime, `$1${opts.canonicalSkillName}$2`);
    output = output.replace(reRepo, `$1${opts.canonicalSkillName}$2`);
    output = output.replace(reGeneric, `$1${opts.canonicalSkillName}$2`);
  }

  return { output, changed: output !== input };
}

async function canonicalizeImportedReferences(
  skillDir: string,
  mode: CanonicalizeMode,
  dryRun: boolean,
  names: {
    sourceDirName: string;
    rawSkillName: string;
    canonicalSkillName: string;
  },
): Promise<void> {
  if (mode === "none") return;

  const files = await listFilesRecursive(skillDir);

  // 1) Rename CLAUDE.md -> REFERENCE.md first so links can resolve.
  for (const filePath of files) {
    if (path.basename(filePath) !== "CLAUDE.md") continue;
    const nextPath = path.join(path.dirname(filePath), "REFERENCE.md");

    if (await pathExists(nextPath)) {
      process.stdout.write(`[warn] Cannot rename ${filePath} -> ${nextPath} (target exists); keeping existing file\n`);
      continue;
    }

    if (dryRun) {
      process.stdout.write(`[dry-run] mv ${filePath} ${nextPath}\n`);
    } else {
      await fs.rename(filePath, nextPath);
    }
  }

  // 2) Rewrite path placeholders and reference links in text files.
  // Re-scan in case renames changed the file set.
  const afterRenameFiles = await listFilesRecursive(skillDir);
  for (const filePath of afterRenameFiles) {
    if (!shouldProcessTextFile(filePath)) continue;

    const original = await fs.readFile(filePath, "utf8");
    const rewritten = rewriteImportedContent(original, {
      legacySkillNames: [...new Set([names.sourceDirName, names.rawSkillName])],
      canonicalSkillName: names.canonicalSkillName,
    });
    if (!rewritten.changed) continue;

    if (dryRun) {
      process.stdout.write(`[dry-run] update ${filePath} (PAI_DIR/CLAUDE canonicalization)\n`);
    } else {
      await fs.writeFile(filePath, rewritten.output, "utf8");
    }
  }
}

async function maybeRenameDir(root: string, from: string, to: string, dryRun: boolean): Promise<void> {
  const fromPath = path.join(root, from);
  const toPath = path.join(root, to);

  const fromExists = await pathExists(fromPath);
  if (!fromExists) return;

  const toExists = await pathExists(toPath);
  if (toExists) {
    process.stdout.write(`[warn] Both ${from}/ and ${to}/ exist under ${root}; leaving as-is\n`);
    return;
  }

  if (dryRun) {
    process.stdout.write(`[dry-run] mv ${fromPath} ${toPath}\n`);
  } else {
    await fs.rename(fromPath, toPath);
  }
}

function extractFrontmatter(markdown: string): { yaml: string; body: string } | null {
  if (!markdown.startsWith("---")) return null;
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const endIdx = lines.indexOf("---", 1);
  if (endIdx === -1) return null;
  const yaml = lines.slice(1, endIdx).join("\n");
  const body = lines.slice(endIdx + 1).join("\n");
  return { yaml, body };
}

function normalizeDescriptionYaml(yaml: string, skillName: string): { yaml: string; changed: boolean } {
  const lines = yaml.split(/\r?\n/);
  let changed = false;

  // Normalize description:
  const out: string[] = [];
  let sawName = false;
  let sawDescription = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Normalize/force skill name canonical form.
    if (/^name:\s*/.test(line)) {
      const canonical = `name: ${skillName}`;
      if (!sawName) {
        if (line !== canonical) changed = true;
        out.push(canonical);
        sawName = true;
      } else {
        // Collapse duplicate name keys.
        changed = true;
      }
      continue;
    }

    const m = line.match(/^description:\s*(.*)$/);
    if (!m) {
      out.push(line);
      continue;
    }

    sawDescription = true;

    let desc = m[1] ?? "";

    if (desc === "|" || desc === ">") {
      // Collect indented block.
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!/^\s+/.test(next)) {
          i = j - 1;
          break;
        }
        block.push(next.replace(/^\s+/, ""));
        i = j;
      }
      desc = toSingleLine(block.join("\n"));
      changed = true;
    } else {
      const normalized = toSingleLine(desc);
      if (normalized !== desc) {
        desc = normalized;
        changed = true;
      }
    }

    // Migrate legacy discovery guidance.
    if (/\bSkillSearch\(/.test(desc)) {
      const replacement = `Use \`skill_find\` with query \`${skillName}\` for docs.`;
      const migrated = toSingleLine(
        desc
          .replace(/\s*SkillSearch\([^)]*\)\s*for docs\.?/gi, ` ${replacement}`)
          .replace(/\s*SkillSearch\([^)]*\)\.?/gi, ` ${replacement}`),
      );
      if (migrated !== desc) {
        desc = migrated;
        changed = true;
      }
    }

    if (!/\bUSE WHEN\b/.test(desc)) {
      desc = `${desc}${desc.endsWith(".") ? "" : "."} USE WHEN you need to use this skill.`;
      changed = true;
    }

    out.push(`description: ${desc}`);
  }

  if (!sawName) {
    out.unshift(`name: ${skillName}`);
    changed = true;
  }

  if (!sawDescription) {
    out.push(`description: ${skillName} skill. USE WHEN you need to use this skill.`);
    changed = true;
  }

  return { yaml: out.join("\n"), changed };
}

async function canonicalizeSkillMd(skillDir: string, skillName: string, mode: CanonicalizeMode, dryRun: boolean): Promise<void> {
  if (mode === "none") return;

  const skillMdPath = path.join(skillDir, "SKILL.md");
  const exists = await pathExists(skillMdPath);
  if (!exists) {
    process.stdout.write(`[warn] Missing SKILL.md at ${skillMdPath}; skipping canonicalization\n`);
    return;
  }

  const original = await fs.readFile(skillMdPath, "utf8");
  const fm = extractFrontmatter(original);
  if (!fm) {
    process.stdout.write(`[warn] SKILL.md has no parseable frontmatter; skipping canonicalization\n`);
    return;
  }

  const normalized = normalizeDescriptionYaml(fm.yaml, skillName);
  let next = `---\n${normalized.yaml}\n---\n${fm.body.startsWith("\n") ? fm.body.slice(1) : fm.body}`;

  if (mode === "strict") {
    // Ensure minimal required sections exist; do not rewrite existing content.
    if (!/\n## Workflow Routing\n/.test(next)) {
      next = `${next.trimEnd()}\n\n## Workflow Routing\n\n| Workflow | Trigger | File |\n|----------|---------|------|\n| (none) | (none) | (none) |\n`;
      normalized.changed = true;
    }
    if (!/\n## Examples\n/.test(next)) {
      next = `${next.trimEnd()}\n\n## Examples\n\n**Example 1: Use this skill**\n\n\`\`\`\nUser: \"Use the ${skillName} skill\"\n-> Follow ${skillName}/SKILL.md\n\`\`\`\n`;
      normalized.changed = true;
    }
  }

  if (next !== original) {
    if (dryRun) {
      process.stdout.write(`[dry-run] update ${skillMdPath}\n`);
    } else {
      await fs.writeFile(skillMdPath, next, "utf8");
    }
  }
}

type ValidationFinding = {
  severity: "error" | "warning";
  message: string;
};

function parseFrontmatterField(yaml: string, key: "name" | "description"): string | undefined {
  const lines = yaml.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!m) continue;
    return m[1]?.trim();
  }
  return undefined;
}

async function runPostImportChecks(
  skillDir: string,
  skillName: string,
  mode: CanonicalizeMode,
): Promise<void> {
  const findings: ValidationFinding[] = [];
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (!(await pathExists(skillMdPath))) {
    findings.push({ severity: "error", message: `Missing SKILL.md: ${skillMdPath}` });
  } else {
    const skillMd = await fs.readFile(skillMdPath, "utf8");
    const fm = extractFrontmatter(skillMd);
    if (!fm) {
      findings.push({ severity: "error", message: "SKILL.md frontmatter is missing or not parseable" });
    } else {
      const name = parseFrontmatterField(fm.yaml, "name");
      const description = parseFrontmatterField(fm.yaml, "description");

      if (!name) {
        findings.push({ severity: "error", message: "Frontmatter missing required `name:` field" });
      } else if (name !== skillName) {
        findings.push({
          severity: "error",
          message: `Frontmatter name mismatch (expected ${skillName}, found ${name})`,
        });
      }

      if (!description) {
        findings.push({ severity: "error", message: "Frontmatter missing required `description:` field" });
      } else {
        if (!/\bUSE WHEN\b/.test(description)) {
          findings.push({ severity: "error", message: "Frontmatter `description:` must contain `USE WHEN`" });
        }
        if (/\bSkillSearch\(/.test(description)) {
          findings.push({
            severity: "error",
            message: "Frontmatter `description:` contains `SkillSearch(` (use `skill_find` guidance instead)",
          });
        }
      }
    }

    if (/\bSkillSearch\(/.test(skillMd)) {
      findings.push({
        severity: "error",
        message: "SKILL.md contains `SkillSearch(`; this is disallowed in imported skills",
      });
    }
  }

  const workflowsDir = path.join(skillDir, "Workflows");
  const toolsDir = path.join(skillDir, "Tools");
  const hasWorkflows = await pathExists(workflowsDir);
  const hasTools = await pathExists(toolsDir);

  if (!hasWorkflows) {
    findings.push({
      severity: mode === "strict" ? "error" : "warning",
      message: "Missing Workflows/ directory",
    });
  }
  if (!hasTools) {
    findings.push({
      severity: mode === "strict" ? "error" : "warning",
      message: "Missing Tools/ directory",
    });
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  for (const warning of warnings) {
    process.stdout.write(`[warn] ${warning.message}\n`);
  }

  if (errors.length) {
    for (const error of errors) {
      process.stderr.write(`[error] ${error.message}\n`);
    }
    die(`Post-import validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}).`);
  }

  process.stdout.write("[ok] Post-import validation passed.\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.dest) {
    printHelp();
    die("Missing required --source and/or --dest");
  }

  const source = path.resolve(args.source);
  const destRoot = path.resolve(args.dest);

  const sourceStat = await fs
    .stat(source)
    .catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory()) {
    die(`Source is not a directory: ${source}`);
  }

  const inferredName = path.basename(source);
  const rawSkillName = (args.name ?? inferredName).trim();
  const skillName = toKebabSkillName(rawSkillName);

  if (!skillName || !isKebabSkillName(skillName)) {
    die(
      `Skill name could not be canonicalized to kebab-case. Input: ${rawSkillName}; normalized: ${skillName || "(empty)"}`,
    );
  }

  if (rawSkillName !== skillName) {
    process.stdout.write(`[note] canonicalized skill name: ${rawSkillName} -> ${skillName}\n`);
  }

  const destSkillDir = path.join(destRoot, skillName);
  const destExists = await pathExists(destSkillDir);
  if (destExists && !args.force) {
    die(`Destination already exists: ${destSkillDir} (use --force to overwrite)`);
  }

  // Verify source has SKILL.md
  const sourceSkillMd = path.join(source, "SKILL.md");
  if (!(await pathExists(sourceSkillMd))) {
    die(`Source skill missing SKILL.md: ${sourceSkillMd}`);
  }

  process.stdout.write(`Importing ${skillName}\n`);
  process.stdout.write(`  source: ${source}\n`);
  process.stdout.write(`  dest:   ${destSkillDir}\n`);
  process.stdout.write(`  mode:   ${args.canonicalize}\n`);
  process.stdout.write(`  validate: ${args.validate ? "on" : "off"}\n`);

  if (destExists && args.force) {
    await removeDir(destSkillDir, args.dryRun);
  }

  await copyDirRecursive(source, destSkillDir, args.dryRun);

  // Minimal canonicalization around dir casing.
  if (args.canonicalize !== "none") {
    await maybeRenameDir(destSkillDir, "workflows", "Workflows", args.dryRun);
    await maybeRenameDir(destSkillDir, "tools", "Tools", args.dryRun);
  }

  // Ensure expected dirs exist (minimal).
  if (args.canonicalize === "strict") {
    await ensureDir(path.join(destSkillDir, "Workflows"), args.dryRun);
    await ensureDir(path.join(destSkillDir, "Tools"), args.dryRun);
  }

  if (args.dryRun) {
    process.stdout.write(
      "[note] Skipping content canonicalization and post-import validation in --dry-run mode (files are not materialized).\n",
    );
  } else {
    await canonicalizeImportedReferences(destSkillDir, args.canonicalize, args.dryRun, {
      sourceDirName: inferredName,
      rawSkillName,
      canonicalSkillName: skillName,
    });

    await canonicalizeSkillMd(destSkillDir, skillName, args.canonicalize, args.dryRun);

    if (args.validate) {
      await runPostImportChecks(destSkillDir, skillName, args.canonicalize);
    }
  }

  process.stdout.write("Done.\n");
  process.stdout.write("Next (install into runtime):\n");
  process.stdout.write(`  cd \"/Users/zuul/Projects/pai-opencode\" && bun \"Tools/Install.ts\" --target \"/Users/zuul/.config/opencode\"\n`);
}

main().catch((err) => {
  die(err?.stack ? String(err.stack) : String(err));
});
