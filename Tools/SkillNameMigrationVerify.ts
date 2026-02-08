/*
 * SkillNameMigrationVerify.ts
 *
 * Post-migration verification for skill naming integrity and stale references.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type ManifestItem = {
  oldDirRel: string;
  newDirRel: string;
  oldName: string;
  newName: string;
  excluded: boolean;
  depth: number;
};

type Manifest = {
  items: ManifestItem[];
};

type SkillEntry = {
  dirRel: string;
  skillMdAbs: string;
  directoryName: string;
  frontmatterName: string;
};

type Finding = {
  file: string;
  line: number;
  category:
    | "dir-not-kebab"
    | "frontmatter-mismatch"
    | "missing-expected-skill"
    | "unexpected-skill-dir"
    | "stale-skills-path"
    | "stale-xml-name"
    | "stale-skill-call";
  message: string;
  oldValue?: string;
  newValue?: string;
};

type VerifyReport = {
  generatedAt: string;
  repoRoot: string;
  skillsRoot: string;
  manifestPath: string | null;
  outDir: string;
  rewritePrefixes: string[];
  summary: {
    discoveredSkills: number;
    excludedSkills: number;
    checkedSkills: number;
    dirNotKebabCount: number;
    frontmatterMismatchCount: number;
    missingExpectedCount: number;
    unexpectedSkillCount: number;
    stalePathCount: number;
    staleXmlNameCount: number;
    staleSkillCallCount: number;
    filesScannedForStaleRefs: number;
    pass: boolean;
  };
  findings: Finding[];
};

type Args = {
  repoRoot: string;
  skillsRoot: string;
  manifestPath: string | null;
  outDir: string;
  rewritePrefixes: string[];
  strict: boolean;
};

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".txt",
  ".sh",
]);

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", ".turbo"]);

function repoRootFromThisFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(path.join(here, ".."));
}

function normalizePrefix(input: string): string {
  const p = input.replace(/\\/g, "/").replace(/^\.\//, "");
  return p.endsWith("/") ? p : `${p}/`;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function kebabRegex(): RegExp {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function parseFrontmatterName(content: string): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return "";
  const yaml = fm[1];
  const name = yaml.match(/^name:\s*(.+)$/m);
  return name ? name[1].trim() : "";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

function usage(defaults: Args): string {
  return [
    "SkillNameMigrationVerify - verify post-migration skill integrity",
    "",
    "Usage:",
    "  bun Tools/SkillNameMigrationVerify.ts [options]",
    "",
    "Options:",
    `  --repo-root <path>        Repo root (default: ${defaults.repoRoot})`,
    `  --skills-root <path>      Skills root (default: ${defaults.skillsRoot})`,
    "  --manifest <path>         Migration manifest JSON (optional)",
    `  --out-dir <path>          Output directory (default: ${defaults.outDir})`,
    "  --rewrite-prefix <prefix> Prefix allowlist for stale reference scan (repeatable)",
    "                           defaults: .opencode/, Tools/, Packs/",
    "  --no-strict               Exit 0 even when verification fails",
    "  -h, --help                Show help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const repoRoot = repoRootFromThisFile();
  const defaults: Args = {
    repoRoot,
    skillsRoot: path.join(repoRoot, ".opencode", "skills"),
    manifestPath: null,
    outDir: path.join(repoRoot, "tmp", "skill-name-migration-verify"),
    rewritePrefixes: [".opencode/", "Tools/", "Packs/"],
    strict: true,
  };

  const args: Args = { ...defaults, rewritePrefixes: [...defaults.rewritePrefixes] };
  let rewritePrefixOverridden = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage(defaults)}\n`);
      process.exit(0);
    }
    if (arg === "--repo-root") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --repo-root");
      args.repoRoot = path.resolve(v);
      continue;
    }
    if (arg === "--skills-root") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --skills-root");
      args.skillsRoot = path.resolve(v);
      continue;
    }
    if (arg === "--manifest") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --manifest");
      args.manifestPath = path.resolve(v);
      continue;
    }
    if (arg === "--out-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --out-dir");
      args.outDir = path.resolve(v);
      continue;
    }
    if (arg === "--rewrite-prefix") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --rewrite-prefix");
      if (!rewritePrefixOverridden) {
        args.rewritePrefixes = [];
        rewritePrefixOverridden = true;
      }
      args.rewritePrefixes.push(v);
      continue;
    }
    if (arg === "--no-strict") {
      args.strict = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  args.rewritePrefixes = [...new Set(args.rewritePrefixes.map(normalizePrefix))].sort();
  return args;
}

async function listSkillEntries(skillsRoot: string): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Do not follow symlinks (e.g. CORE -> PAI).
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        const skillDir = path.dirname(abs);
        const rel = toPosix(path.relative(skillsRoot, skillDir));
        const text = await fs.readFile(abs, "utf8");
        out.push({
          dirRel: rel,
          skillMdAbs: abs,
          directoryName: path.basename(skillDir),
          frontmatterName: parseFrontmatterName(text),
        });
      }
    }
  }

  await walk(skillsRoot);
  return out.sort((a, b) => a.dirRel.localeCompare(b.dirRel));
}

async function listTextFilesUnderPrefix(repoRoot: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const absPrefix = path.join(repoRoot, ...prefix.replace(/\/$/, "").split("/"));
  if (!(await pathExists(absPrefix))) return out;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      out.push(abs);
    }
  }

  await walk(absPrefix);
  return out;
}

function reportToMarkdown(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push("# Skill Migration Verification Report (M8)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Repo root: ${report.repoRoot}`);
  lines.push(`Skills root: ${report.skillsRoot}`);
  lines.push(`Manifest: ${report.manifestPath ?? "(none)"}`);
  lines.push(`Output dir: ${report.outDir}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- pass: ${report.summary.pass ? "yes" : "no"}`);
  lines.push(`- discovered skills: ${report.summary.discoveredSkills}`);
  lines.push(`- excluded skills: ${report.summary.excludedSkills}`);
  lines.push(`- checked skills: ${report.summary.checkedSkills}`);
  lines.push(`- dir-not-kebab: ${report.summary.dirNotKebabCount}`);
  lines.push(`- frontmatter mismatches: ${report.summary.frontmatterMismatchCount}`);
  lines.push(`- missing expected skills: ${report.summary.missingExpectedCount}`);
  lines.push(`- unexpected skill dirs: ${report.summary.unexpectedSkillCount}`);
  lines.push(`- stale skills-path refs: ${report.summary.stalePathCount}`);
  lines.push(`- stale xml-name refs: ${report.summary.staleXmlNameCount}`);
  lines.push(`- stale skill-call refs: ${report.summary.staleSkillCallCount}`);
  lines.push(`- files scanned for stale refs: ${report.summary.filesScannedForStaleRefs}`);
  lines.push("");

  const byCat = new Map<string, number>();
  for (const f of report.findings) {
    byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
  }
  lines.push("## Finding categories");
  lines.push("");
  for (const [cat, count] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${cat}: ${count}`);
  }
  if (byCat.size === 0) lines.push("- none");
  lines.push("");

  lines.push("## Sample findings (first 80)");
  lines.push("");
  const sample = report.findings.slice(0, 80);
  if (sample.length === 0) {
    lines.push("- none");
  } else {
    for (const f of sample) {
      lines.push(`- [${f.category}] ${f.file}:${f.line} — ${f.message}`);
    }
  }
  lines.push("");
  lines.push("Full details are in migration-verify.json.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await pathExists(args.repoRoot))) throw new Error(`repo root not found: ${args.repoRoot}`);
  if (!(await pathExists(args.skillsRoot))) throw new Error(`skills root not found: ${args.skillsRoot}`);

  let manifest: Manifest | null = null;
  if (args.manifestPath) {
    if (!(await pathExists(args.manifestPath))) {
      throw new Error(`manifest not found: ${args.manifestPath}`);
    }
    manifest = await readJson<Manifest>(args.manifestPath);
  }

  const findings: Finding[] = [];
  const allSkills = await listSkillEntries(args.skillsRoot);

  const excludedDirRels = new Set<string>();
  const expectedDirRels = new Set<string>();
  const oldItems: ManifestItem[] = [];

  if (manifest) {
    for (const item of manifest.items) {
      if (item.excluded) excludedDirRels.add(item.oldDirRel);
      else {
        expectedDirRels.add(item.newDirRel);
        oldItems.push(item);
      }
    }
  }

  const currentByDir = new Map(allSkills.map((x) => [x.dirRel, x]));
  const kebab = kebabRegex();

  let excludedCount = 0;
  let checkedCount = 0;

  for (const skill of allSkills) {
    if (excludedDirRels.has(skill.dirRel)) {
      excludedCount += 1;
      continue;
    }

    checkedCount += 1;

    if (!kebab.test(skill.directoryName)) {
      findings.push({
        file: toPosix(path.relative(args.repoRoot, skill.skillMdAbs)),
        line: 1,
        category: "dir-not-kebab",
        message: `Directory name '${skill.directoryName}' is not kebab-case`,
      });
    }

    if (skill.frontmatterName !== skill.directoryName) {
      findings.push({
        file: toPosix(path.relative(args.repoRoot, skill.skillMdAbs)),
        line: 1,
        category: "frontmatter-mismatch",
        message: `Frontmatter name '${skill.frontmatterName}' != directory '${skill.directoryName}'`,
        oldValue: skill.frontmatterName,
        newValue: skill.directoryName,
      });
    }
  }

  // Completeness against manifest
  if (manifest) {
    for (const expected of expectedDirRels) {
      if (!currentByDir.has(expected)) {
        findings.push({
          file: toPosix(path.join(path.relative(args.repoRoot, args.skillsRoot), expected, "SKILL.md")),
          line: 1,
          category: "missing-expected-skill",
          message: `Expected migrated skill missing at '${expected}'`,
        });
      }
    }

    for (const current of currentByDir.keys()) {
      if (excludedDirRels.has(current)) continue;
      if (!expectedDirRels.has(current)) {
        findings.push({
          file: toPosix(path.join(path.relative(args.repoRoot, args.skillsRoot), current, "SKILL.md")),
          line: 1,
          category: "unexpected-skill-dir",
          message: `Current skill dir not in expected manifest set: '${current}'`,
        });
      }
    }
  }

  // Stale reference scan against old manifest names/paths.
  let scannedFiles = 0;
  if (manifest) {
    const files = new Set<string>();
    for (const prefix of args.rewritePrefixes) {
      for (const f of await listTextFilesUnderPrefix(args.repoRoot, prefix)) {
        files.add(f);
      }
    }

    for (const fileAbs of [...files].sort((a, b) => a.localeCompare(b))) {
      const text = await fs.readFile(fileAbs, "utf8").catch(() => "");
      if (!text) continue;
      scannedFiles += 1;
      const fileRel = toPosix(path.relative(args.repoRoot, fileAbs));

      for (const item of oldItems) {
        const oldDirRelEsc = escapeRegExp(item.oldDirRel);
        const oldNameEsc = escapeRegExp(item.oldName);

        // stale path refs
        if (text.includes(`skills/${item.oldDirRel}/`) || text.includes(`.opencode/skills/${item.oldDirRel}/`)) {
          const re = new RegExp(`(?:\\.opencode/)?skills/${oldDirRelEsc}/`, "g");
          let match: RegExpExecArray | null;
          for (;;) {
            match = re.exec(text);
            if (!match) break;
            findings.push({
              file: fileRel,
              line: lineNumberAt(text, match.index),
              category: "stale-skills-path",
              message: `Stale old skills path reference: ${match[0]}`,
              oldValue: item.oldDirRel,
              newValue: item.newDirRel,
            });
          }
        }

        // stale xml skill name refs
        if (text.includes(`<name>${item.oldName}</name>`)) {
          const re = new RegExp(`<name>\\s*${oldNameEsc}\\s*</name>`, "g");
          let match: RegExpExecArray | null;
          for (;;) {
            match = re.exec(text);
            if (!match) break;
            findings.push({
              file: fileRel,
              line: lineNumberAt(text, match.index),
              category: "stale-xml-name",
              message: `Stale XML skill name: ${match[0]}`,
              oldValue: item.oldName,
              newValue: item.newName,
            });
          }
        }

        // stale tool call skill names
        if (text.includes(item.oldName) && text.includes("skill(")) {
          const re = new RegExp(`skill\\s*\\(\\s*\\{[\\s\\S]{0,220}?\\bname\\s*:\\s*["']${oldNameEsc}["']`, "g");
          let match: RegExpExecArray | null;
          for (;;) {
            match = re.exec(text);
            if (!match) break;
            findings.push({
              file: fileRel,
              line: lineNumberAt(text, match.index),
              category: "stale-skill-call",
              message: `Stale skill tool call name: ${item.oldName}`,
              oldValue: item.oldName,
              newValue: item.newName,
            });
          }
        }
      }
    }
  }

  const count = (category: Finding["category"]): number => findings.filter((f) => f.category === category).length;

  const report: VerifyReport = {
    generatedAt: new Date().toISOString(),
    repoRoot: args.repoRoot,
    skillsRoot: args.skillsRoot,
    manifestPath: args.manifestPath,
    outDir: args.outDir,
    rewritePrefixes: args.rewritePrefixes,
    summary: {
      discoveredSkills: allSkills.length,
      excludedSkills: excludedCount,
      checkedSkills: checkedCount,
      dirNotKebabCount: count("dir-not-kebab"),
      frontmatterMismatchCount: count("frontmatter-mismatch"),
      missingExpectedCount: count("missing-expected-skill"),
      unexpectedSkillCount: count("unexpected-skill-dir"),
      stalePathCount: count("stale-skills-path"),
      staleXmlNameCount: count("stale-xml-name"),
      staleSkillCallCount: count("stale-skill-call"),
      filesScannedForStaleRefs: scannedFiles,
      pass: false,
    },
    findings: findings.sort((a, b) => {
      const ka = `${a.category}:${a.file}:${String(a.line).padStart(8, "0")}`;
      const kb = `${b.category}:${b.file}:${String(b.line).padStart(8, "0")}`;
      return ka.localeCompare(kb);
    }),
  };

  report.summary.pass =
    report.summary.dirNotKebabCount === 0 &&
    report.summary.frontmatterMismatchCount === 0 &&
    report.summary.missingExpectedCount === 0;

  await fs.mkdir(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "migration-verify.json");
  const mdPath = path.join(args.outDir, "migration-verify.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, reportToMarkdown(report), "utf8");

  process.stdout.write(`Wrote:\n- ${jsonPath}\n- ${mdPath}\n`);
  process.stdout.write(`\nSummary:\n`);
  process.stdout.write(`- discovered skills: ${report.summary.discoveredSkills}\n`);
  process.stdout.write(`- excluded skills: ${report.summary.excludedSkills}\n`);
  process.stdout.write(`- checked skills: ${report.summary.checkedSkills}\n`);
  process.stdout.write(`- dir-not-kebab: ${report.summary.dirNotKebabCount}\n`);
  process.stdout.write(`- frontmatter mismatches: ${report.summary.frontmatterMismatchCount}\n`);
  process.stdout.write(`- missing expected: ${report.summary.missingExpectedCount}\n`);
  process.stdout.write(`- unexpected current: ${report.summary.unexpectedSkillCount}\n`);
  process.stdout.write(`- stale path refs: ${report.summary.stalePathCount}\n`);
  process.stdout.write(`- stale xml-name refs: ${report.summary.staleXmlNameCount}\n`);
  process.stdout.write(`- stale skill-call refs: ${report.summary.staleSkillCallCount}\n`);
  process.stdout.write(`- pass: ${report.summary.pass ? "yes" : "no"}\n`);

  if (args.strict && !report.summary.pass) {
    process.stderr.write("\nVerification failed (strict mode). See migration-verify.json for details.\n");
    process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
