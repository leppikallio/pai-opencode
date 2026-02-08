/*
 * SkillNameMigrationPlan.ts
 *
 * Dry-run planner for migrating OpenCode skill names/directories to kebab-case.
 * This tool does NOT modify repository files.
 *
 * Outputs:
 * - migration-manifest.json
 * - migration-reference-hits.json
 * - migration-plan-report.md
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Args = {
  repoRoot: string;
  skillsRoot: string;
  outDir: string;
  excludeSkillDirs: string[];
};

type SkillEntry = {
  oldDirRel: string;
  newDirRel: string;
  oldDirAbs: string;
  newDirAbs: string;
  directoryName: string;
  frontmatterName: string;
  oldName: string;
  newName: string;
  renameDir: boolean;
  renameName: boolean;
  excluded: boolean;
  excludeReason?: string;
  depth: number;
};

type Collision = {
  newDirRel: string;
  oldDirRels: string[];
};

type HitCategory = "safe" | "manual";

type ReferenceHit = {
  file: string;
  line: number;
  category: HitCategory;
  pattern: "skill-call" | "xml-name" | "skills-path" | "name-word";
  oldName: string;
  newName: string;
  oldDirRel: string;
  newDirRel: string;
  matchText: string;
  replacement: string;
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

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

function usage(defaults: Args): string {
  return [
    "SkillNameMigrationPlan - dry-run planner for skill kebab-case migration",
    "",
    "Usage:",
    "  bun Tools/SkillNameMigrationPlan.ts [options]",
    "",
    "Options:",
    `  --repo-root <path>         Repository root (default: ${defaults.repoRoot})`,
    `  --skills-root <path>       Skills root (default: ${defaults.skillsRoot})`,
    `  --out-dir <path>           Output directory (default: ${defaults.outDir})`,
    "  --exclude-skill-dir <name> Exclude skill directory by exact name (repeatable)",
    "  -h, --help                 Show help",
    "",
    "Default exclusions:",
    `  ${defaults.excludeSkillDirs.join(", ")}`,
    "",
    "Output files:",
    "  migration-manifest.json",
    "  migration-reference-hits.json",
    "  migration-plan-report.md",
  ].join("\n");
}

function repoRootFromThisFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(path.join(here, ".."));
}

function parseArgs(argv: string[]): Args {
  const repoRoot = repoRootFromThisFile();
  const defaults: Args = {
    repoRoot,
    skillsRoot: path.join(repoRoot, ".opencode", "skills"),
    outDir: path.join(repoRoot, "tmp", "skill-name-migration-plan"),
    excludeSkillDirs: ["PAI", "CORE"],
  };

  const result: Args = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage(defaults)}\n`);
      process.exit(0);
    }
    if (arg === "--repo-root") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --repo-root");
      result.repoRoot = path.resolve(v);
      continue;
    }
    if (arg === "--skills-root") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --skills-root");
      result.skillsRoot = path.resolve(v);
      continue;
    }
    if (arg === "--out-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --out-dir");
      result.outDir = path.resolve(v);
      continue;
    }
    if (arg === "--exclude-skill-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --exclude-skill-dir");
      result.excludeSkillDirs.push(v);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listSkillMdFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(abs);
      }
    }
  }

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
}

function parseFrontmatterName(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m);
  return name ? name[1].trim() : "";
}

function applyAncestorRenames(oldRel: string, renameLeafByOldRel: Map<string, string>): string {
  const original = oldRel.split("/");
  const segments = [...original];
  for (let i = 0; i < original.length; i++) {
    const prefix = original.slice(0, i + 1).join("/");
    const renamedLeaf = renameLeafByOldRel.get(prefix);
    if (renamedLeaf) {
      segments[i] = renamedLeaf;
    }
  }
  return segments.join("/");
}

function countDepth(rel: string): number {
  if (!rel) return 0;
  return rel.split("/").length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

async function listProjectTextFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];

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

  await walk(repoRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

function collectReferenceHitsForFile(
  args: {
    fileAbs: string;
    text: string;
    repoRoot: string;
    entries: SkillEntry[];
  },
): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const dedupe = new Set<string>();

  function addHit(hit: Omit<ReferenceHit, "line" | "file"> & { index: number }): void {
    const key = `${hit.pattern}:${hit.index}:${hit.oldName}:${hit.oldDirRel}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    hits.push({
      file: toPosix(path.relative(args.repoRoot, args.fileAbs)),
      line: lineNumberAt(args.text, hit.index),
      category: hit.category,
      pattern: hit.pattern,
      oldName: hit.oldName,
      newName: hit.newName,
      oldDirRel: hit.oldDirRel,
      newDirRel: hit.newDirRel,
      matchText: hit.matchText,
      replacement: hit.replacement,
    });
  }

  for (const entry of args.entries) {
    const oldNameEsc = escapeRegExp(entry.oldName);
    const oldDirEsc = escapeRegExp(entry.oldDirRel);

    // Safe pattern: skill({ name: "OldName" ... })
    {
      const re = new RegExp(`skill\\s*\\(\\s*\\{[\\s\\S]{0,220}?\\bname\\s*:\\s*["']${oldNameEsc}["']`, "g");
      for (;;) {
        const m = re.exec(args.text);
        if (!m) break;
        addHit({
          index: m.index,
          category: "safe",
          pattern: "skill-call",
          oldName: entry.oldName,
          newName: entry.newName,
          oldDirRel: entry.oldDirRel,
          newDirRel: entry.newDirRel,
          matchText: m[0].slice(0, 220),
          replacement: entry.newName,
        });
      }
    }

    // Safe pattern: XML list entry <name>OldName</name>
    {
      const re = new RegExp(`<name>\\s*${oldNameEsc}\\s*</name>`, "g");
      for (;;) {
        const m = re.exec(args.text);
        if (!m) break;
        addHit({
          index: m.index,
          category: "safe",
          pattern: "xml-name",
          oldName: entry.oldName,
          newName: entry.newName,
          oldDirRel: entry.oldDirRel,
          newDirRel: entry.newDirRel,
          matchText: m[0],
          replacement: `<name>${entry.newName}</name>`,
        });
      }
    }

    // Safe pattern: explicit path string to skills/<oldDirRel>/
    {
      const re = new RegExp(`(?:\\.opencode/)?skills/${oldDirEsc}/`, "g");
      for (;;) {
        const m = re.exec(args.text);
        if (!m) break;
        addHit({
          index: m.index,
          category: "safe",
          pattern: "skills-path",
          oldName: entry.oldName,
          newName: entry.newName,
          oldDirRel: entry.oldDirRel,
          newDirRel: entry.newDirRel,
          matchText: m[0],
          replacement: m[0].replace(`skills/${entry.oldDirRel}/`, `skills/${entry.newDirRel}/`),
        });
      }
    }

    // Manual review: bare old name token (high false-positive risk)
    {
      const re = new RegExp(`\\b${oldNameEsc}\\b`, "g");
      for (;;) {
        const m = re.exec(args.text);
        if (!m) break;
        addHit({
          index: m.index,
          category: "manual",
          pattern: "name-word",
          oldName: entry.oldName,
          newName: entry.newName,
          oldDirRel: entry.oldDirRel,
          newDirRel: entry.newDirRel,
          matchText: m[0],
          replacement: entry.newName,
        });
      }
    }
  }

  return hits;
}

function buildReportMarkdown(input: {
  repoRoot: string;
  skillsRoot: string;
  outDir: string;
  generatedAt: string;
  entries: SkillEntry[];
  collisions: Collision[];
  referenceHits: ReferenceHit[];
  filesScanned: number;
}): string {
  const included = input.entries.filter((x) => !x.excluded);
  const changed = included.filter((x) => x.renameDir || x.renameName);
  const safe = input.referenceHits.filter((h) => h.category === "safe").length;
  const manual = input.referenceHits.filter((h) => h.category === "manual").length;

  const lines: string[] = [];
  lines.push("# Skill Name Migration Plan Report");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Repo root: ${input.repoRoot}`);
  lines.push(`Skills root: ${input.skillsRoot}`);
  lines.push(`Output dir: ${input.outDir}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total discovered skills: ${input.entries.length}`);
  lines.push(`- Included for migration: ${included.length}`);
  lines.push(`- Excluded: ${input.entries.length - included.length}`);
  lines.push(`- Planned renames: ${changed.length}`);
  lines.push(`- Collisions: ${input.collisions.length}`);
  lines.push(`- Files scanned for references: ${input.filesScanned}`);
  lines.push(`- Reference hits: ${input.referenceHits.length} (safe=${safe}, manual=${manual})`);
  lines.push("");

  lines.push("## Planned skill renames");
  lines.push("");
  lines.push("| Old dir | New dir | Old name | New name | Rename dir | Rename name |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of changed.sort((a, b) => a.oldDirRel.localeCompare(b.oldDirRel))) {
    lines.push(
      `| ${item.oldDirRel} | ${item.newDirRel} | ${item.oldName} | ${item.newName} | ${item.renameDir ? "yes" : "no"} | ${item.renameName ? "yes" : "no"} |`,
    );
  }
  if (changed.length === 0) lines.push("| (none) | (none) | (none) | (none) | no | no |");
  lines.push("");

  lines.push("## Exclusions");
  lines.push("");
  const excluded = input.entries.filter((x) => x.excluded);
  if (excluded.length === 0) {
    lines.push("- None");
  } else {
    for (const item of excluded.sort((a, b) => a.oldDirRel.localeCompare(b.oldDirRel))) {
      lines.push(`- ${item.oldDirRel} (reason: ${item.excludeReason ?? "n/a"})`);
    }
  }
  lines.push("");

  lines.push("## Collision check");
  lines.push("");
  if (input.collisions.length === 0) {
    lines.push("- No target path collisions detected.");
  } else {
    for (const c of input.collisions) {
      lines.push(`- ${c.newDirRel} <= ${c.oldDirRels.join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## Reference-hit breakdown");
  lines.push("");
  const byPattern = new Map<string, number>();
  for (const hit of input.referenceHits) {
    byPattern.set(hit.pattern, (byPattern.get(hit.pattern) ?? 0) + 1);
  }
  for (const [pattern, count] of [...byPattern.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${pattern}: ${count}`);
  }
  if (byPattern.size === 0) lines.push("- none");
  lines.push("");

  lines.push("## Next action");
  lines.push("");
  lines.push("- Review `migration-manifest.json` and `migration-reference-hits.json`.");
  lines.push("- Approve manifest before creating apply tool (M5).");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await pathExists(args.repoRoot))) throw new Error(`repo root not found: ${args.repoRoot}`);
  if (!(await pathExists(args.skillsRoot))) throw new Error(`skills root not found: ${args.skillsRoot}`);

  const skillFiles = await listSkillMdFiles(args.skillsRoot);
  const rawEntries: SkillEntry[] = [];

  for (const skillMdAbs of skillFiles) {
    const dirAbs = path.dirname(skillMdAbs);
    const oldDirRel = toPosix(path.relative(args.skillsRoot, dirAbs));
    const directoryName = path.basename(dirAbs);
    const depth = countDepth(oldDirRel);
    const content = await fs.readFile(skillMdAbs, "utf8");
    const frontmatterName = parseFrontmatterName(content);
    const oldName = frontmatterName || directoryName;
    const newName = toKebabCase(oldName) || toKebabCase(directoryName);
    const excluded = args.excludeSkillDirs.includes(directoryName);

    rawEntries.push({
      oldDirRel,
      newDirRel: oldDirRel,
      oldDirAbs: dirAbs,
      newDirAbs: dirAbs,
      directoryName,
      frontmatterName,
      oldName,
      newName,
      renameDir: false,
      renameName: oldName !== newName,
      excluded,
      excludeReason: excluded ? `directory name excluded (${directoryName})` : undefined,
      depth,
    });
  }

  // Build oldRel -> renamed leaf map for included entries
  const renameLeafByOldRel = new Map<string, string>();
  for (const e of rawEntries) {
    if (e.excluded) continue;
    renameLeafByOldRel.set(e.oldDirRel, e.newName);
  }

  // Compute final newDirRel/newDirAbs with ancestor renames applied
  for (const e of rawEntries) {
    if (e.excluded) continue;
    const newRel = applyAncestorRenames(e.oldDirRel, renameLeafByOldRel);
    e.newDirRel = newRel;
    e.newDirAbs = path.join(args.skillsRoot, ...newRel.split("/"));
    e.renameDir = e.oldDirRel !== e.newDirRel;
  }

  // Collision detection on target dir paths
  const targetBuckets = new Map<string, string[]>();
  for (const e of rawEntries) {
    if (e.excluded) continue;
    const arr = targetBuckets.get(e.newDirRel) ?? [];
    arr.push(e.oldDirRel);
    targetBuckets.set(e.newDirRel, arr);
  }
  const collisions: Collision[] = [];
  for (const [newDirRel, oldDirRels] of targetBuckets.entries()) {
    if (oldDirRels.length > 1) collisions.push({ newDirRel, oldDirRels: oldDirRels.sort() });
  }
  collisions.sort((a, b) => a.newDirRel.localeCompare(b.newDirRel));

  // Reference scan (whole repo, text files only)
  const files = await listProjectTextFiles(args.repoRoot);
  const migratable = rawEntries.filter((x) => !x.excluded && (x.renameDir || x.renameName));
  const hits: ReferenceHit[] = [];

  for (const fileAbs of files) {
    const text = await fs.readFile(fileAbs, "utf8").catch(() => "");
    if (!text) continue;
    const fileHits = collectReferenceHitsForFile({
      fileAbs,
      text,
      repoRoot: args.repoRoot,
      entries: migratable,
    });
    hits.push(...fileHits);
  }

  // Stable sort for predictable diff/review
  hits.sort((a, b) => {
    const fa = `${a.file}:${String(a.line).padStart(8, "0")}:${a.pattern}:${a.oldName}`;
    const fb = `${b.file}:${String(b.line).padStart(8, "0")}:${b.pattern}:${b.oldName}`;
    return fa.localeCompare(fb);
  });

  const generatedAt = new Date().toISOString();
  const manifest = {
    generatedAt,
    repoRoot: args.repoRoot,
    skillsRoot: args.skillsRoot,
    outDir: args.outDir,
    options: {
      excludeSkillDirs: [...new Set(args.excludeSkillDirs)].sort(),
    },
    summary: {
      discoveredSkills: rawEntries.length,
      excludedSkills: rawEntries.filter((x) => x.excluded).length,
      migratableSkills: migratable.length,
      renameDirCount: rawEntries.filter((x) => !x.excluded && x.renameDir).length,
      renameNameCount: rawEntries.filter((x) => !x.excluded && x.renameName).length,
      collisionCount: collisions.length,
    },
    items: rawEntries
      .slice()
      .sort((a, b) => a.oldDirRel.localeCompare(b.oldDirRel))
      .map((x) => ({
        oldDirRel: x.oldDirRel,
        newDirRel: x.newDirRel,
        directoryName: x.directoryName,
        frontmatterName: x.frontmatterName,
        oldName: x.oldName,
        newName: x.newName,
        renameDir: x.renameDir,
        renameName: x.renameName,
        excluded: x.excluded,
        excludeReason: x.excludeReason ?? null,
        depth: x.depth,
      })),
    collisions,
  };

  const referenceHits = {
    generatedAt,
    repoRoot: args.repoRoot,
    summary: {
      filesScanned: files.length,
      totalHits: hits.length,
      safeHits: hits.filter((h) => h.category === "safe").length,
      manualHits: hits.filter((h) => h.category === "manual").length,
    },
    hits,
  };

  const report = buildReportMarkdown({
    repoRoot: args.repoRoot,
    skillsRoot: args.skillsRoot,
    outDir: args.outDir,
    generatedAt,
    entries: rawEntries,
    collisions,
    referenceHits: hits,
    filesScanned: files.length,
  });

  await fs.mkdir(args.outDir, { recursive: true });
  const manifestPath = path.join(args.outDir, "migration-manifest.json");
  const referencePath = path.join(args.outDir, "migration-reference-hits.json");
  const reportPath = path.join(args.outDir, "migration-plan-report.md");

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(referencePath, `${JSON.stringify(referenceHits, null, 2)}\n`, "utf8");
  await fs.writeFile(reportPath, report, "utf8");

  process.stdout.write(`Wrote:\n`);
  process.stdout.write(`- ${manifestPath}\n`);
  process.stdout.write(`- ${referencePath}\n`);
  process.stdout.write(`- ${reportPath}\n`);
  process.stdout.write(`\nSummary:\n`);
  process.stdout.write(`- discovered skills: ${manifest.summary.discoveredSkills}\n`);
  process.stdout.write(`- migratable skills: ${manifest.summary.migratableSkills}\n`);
  process.stdout.write(`- collisions: ${manifest.summary.collisionCount}\n`);
  process.stdout.write(`- reference hits: ${referenceHits.summary.totalHits} (safe=${referenceHits.summary.safeHits}, manual=${referenceHits.summary.manualHits})\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
