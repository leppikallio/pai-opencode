/*
 * SkillNameMigrationApply.ts
 *
 * Apply tool for skill-name/directory migration based on M3 planner artifacts.
 *
 * Safety model:
 * - Default mode is dry-run (no writes)
 * - Requires --write to mutate files
 * - Applies only "safe" reference hits and only in allowlisted path prefixes
 * - Manual hits are report-only
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type ManifestItem = {
  oldDirRel: string;
  newDirRel: string;
  directoryName: string;
  frontmatterName: string;
  oldName: string;
  newName: string;
  renameDir: boolean;
  renameName: boolean;
  excluded: boolean;
  excludeReason: string | null;
  depth: number;
};

type Manifest = {
  generatedAt: string;
  repoRoot: string;
  skillsRoot: string;
  outDir?: string;
  summary?: {
    collisionCount?: number;
  };
  collisions?: Array<{ newDirRel: string; oldDirRels: string[] }>;
  items: ManifestItem[];
};

type ReferenceHit = {
  file: string;
  line: number;
  category: "safe" | "manual";
  pattern: "skill-call" | "xml-name" | "skills-path" | "name-word";
  oldName: string;
  newName: string;
  oldDirRel: string;
  newDirRel: string;
  matchText: string;
  replacement: string;
};

type ReferenceHits = {
  generatedAt: string;
  repoRoot: string;
  summary?: {
    filesScanned?: number;
    totalHits?: number;
    safeHits?: number;
    manualHits?: number;
  };
  hits: ReferenceHit[];
};

type Args = {
  manifestPath: string;
  referencesPath: string;
  repoRoot: string;
  skillsRoot: string;
  rewritePrefixes: string[];
  write: boolean;
};

type ApplyStats = {
  plannedSkillCount: number;
  directoryRenamesPlanned: number;
  directoryRenamesApplied: number;
  frontmatterUpdatesPlanned: number;
  frontmatterUpdatesApplied: number;
  rewriteFilesPlanned: number;
  rewriteFilesApplied: number;
  rewriteReplacementsApplied: number;
  safeHitsConsidered: number;
  safeHitsSkippedByScope: number;
  manualHitsIgnored: number;
};

function repoRootFromThisFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(path.join(here, ".."));
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function normalizePrefix(input: string): string {
  const p = input.replace(/\\/g, "/").replace(/^\.\//, "");
  return p.endsWith("/") ? p : `${p}/`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usage(defaults: Args): string {
  return [
    "SkillNameMigrationApply - apply planned skill-name migration",
    "",
    "Usage:",
    "  bun Tools/SkillNameMigrationApply.ts --manifest <path> --references <path> [options]",
    "",
    "Options:",
    `  --manifest <path>            Manifest JSON (default: ${defaults.manifestPath})`,
    `  --references <path>          Reference hits JSON (default: ${defaults.referencesPath})`,
    `  --repo-root <path>           Repository root (default: ${defaults.repoRoot})`,
    `  --skills-root <path>         Skills root (default: ${defaults.skillsRoot})`,
    "  --rewrite-prefix <prefix>    Allowlist prefix for safe rewrites (repeatable)",
    "                              defaults: .opencode/, Tools/, Packs/",
    "  --write                      Apply changes (without this, dry-run)",
    "  -h, --help                   Show help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const repoRoot = repoRootFromThisFile();
  const baseOut = path.join(
    process.env.HOME || "",
    ".config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m3-skill-migration",
  );
  const defaults: Args = {
    manifestPath: path.join(baseOut, "migration-manifest.json"),
    referencesPath: path.join(baseOut, "migration-reference-hits.json"),
    repoRoot,
    skillsRoot: path.join(repoRoot, ".opencode", "skills"),
    rewritePrefixes: [".opencode/", "Tools/", "Packs/"],
    write: false,
  };

  const args: Args = { ...defaults, rewritePrefixes: [...defaults.rewritePrefixes] };
  let rewritePrefixOverridden = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage(defaults)}\n`);
      process.exit(0);
    }
    if (arg === "--manifest") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --manifest");
      args.manifestPath = path.resolve(v);
      continue;
    }
    if (arg === "--references") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --references");
      args.referencesPath = path.resolve(v);
      continue;
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
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  args.rewritePrefixes = [...new Set(args.rewritePrefixes.map(normalizePrefix))].sort();
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

async function readJson<T>(filePath: string): Promise<T> {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt) as T;
}

function applyRenamedAncestors(oldRel: string, renamedOldToNew: Map<string, string>): string {
  const segs = oldRel.split("/");
  let bestPrefixLen = 0;
  let bestNewPrefixSegs: string[] | null = null;

  for (let i = 1; i < segs.length; i++) {
    const oldPrefix = segs.slice(0, i).join("/");
    const maybe = renamedOldToNew.get(oldPrefix);
    if (!maybe) continue;
    bestPrefixLen = i;
    bestNewPrefixSegs = maybe.split("/");
  }

  if (!bestNewPrefixSegs) return oldRel;
  return [...bestNewPrefixSegs, ...segs.slice(bestPrefixLen)].join("/");
}

function samePathCaseInsensitive(a: string, b: string): boolean {
  const na = path.resolve(a).replace(/\\/g, "/").toLowerCase();
  const nb = path.resolve(b).replace(/\\/g, "/").toLowerCase();
  return na === nb;
}

function buildTempRenamePath(targetAbs: string): string {
  const parent = path.dirname(targetAbs);
  const base = path.basename(targetAbs);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(parent, `.__skill-migrate-tmp__${base}__${token}`);
}

function replaceAllLiteral(input: string, from: string, to: string): { next: string; count: number } {
  if (!from || from === to) return { next: input, count: 0 };
  const count = input.split(from).length - 1;
  if (count <= 0) return { next: input, count: 0 };
  return { next: input.split(from).join(to), count };
}

function updateFrontmatterName(content: string, nextName: string): { next: string; changed: boolean } {
  if (!content.startsWith("---\n")) {
    return { next: content, changed: false };
  }
  const lines = content.split(/\r?\n/);
  const endIdx = lines.indexOf("---", 1);
  if (endIdx <= 0) return { next: content, changed: false };

  const yaml = lines.slice(1, endIdx);
  let changed = false;
  let foundName = false;
  const nextYaml = yaml.map((line) => {
    if (/^name:\s*/.test(line)) {
      foundName = true;
      const rewritten = `name: ${nextName}`;
      if (line !== rewritten) changed = true;
      return rewritten;
    }
    return line;
  });

  if (!foundName) {
    nextYaml.unshift(`name: ${nextName}`);
    changed = true;
  }

  if (!changed) return { next: content, changed: false };

  const nextLines = ["---", ...nextYaml, "---", ...lines.slice(endIdx + 1)];
  return { next: nextLines.join("\n"), changed: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!(await pathExists(args.manifestPath))) throw new Error(`manifest not found: ${args.manifestPath}`);
  if (!(await pathExists(args.referencesPath))) throw new Error(`references not found: ${args.referencesPath}`);

  const manifest = await readJson<Manifest>(args.manifestPath);
  const references = await readJson<ReferenceHits>(args.referencesPath);

  const collisions = manifest.collisions ?? [];
  if (collisions.length > 0) {
    throw new Error(`Refusing to apply while collisions exist (${collisions.length}). Resolve in manifest first.`);
  }

  const items = manifest.items
    .filter((x) => !x.excluded && (x.renameDir || x.renameName))
    .sort((a, b) => (a.depth - b.depth) || a.oldDirRel.localeCompare(b.oldDirRel));

  const stats: ApplyStats = {
    plannedSkillCount: items.length,
    directoryRenamesPlanned: items.filter((x) => x.renameDir).length,
    directoryRenamesApplied: 0,
    frontmatterUpdatesPlanned: items.filter((x) => x.renameName).length,
    frontmatterUpdatesApplied: 0,
    rewriteFilesPlanned: 0,
    rewriteFilesApplied: 0,
    rewriteReplacementsApplied: 0,
    safeHitsConsidered: 0,
    safeHitsSkippedByScope: 0,
    manualHitsIgnored: references.hits.filter((h) => h.category === "manual").length,
  };

  const modeLabel = args.write ? "WRITE" : "DRY-RUN";
  process.stdout.write(`[${modeLabel}] Using manifest: ${args.manifestPath}\n`);
  process.stdout.write(`[${modeLabel}] Using references: ${args.referencesPath}\n`);
  process.stdout.write(`[${modeLabel}] Rewrite prefixes: ${args.rewritePrefixes.join(", ")}\n`);

  // STEP 1: Rename directories (ancestor-aware)
  const renamedOldToNew = new Map<string, string>();
  for (const item of items) {
    if (!item.renameDir) continue;

    const currentOldRel = applyRenamedAncestors(item.oldDirRel, renamedOldToNew);
    const oldAbs = path.join(args.skillsRoot, ...currentOldRel.split("/"));
    const newAbs = path.join(args.skillsRoot, ...item.newDirRel.split("/"));

    if (currentOldRel === item.newDirRel) {
      renamedOldToNew.set(item.oldDirRel, item.newDirRel);
      continue;
    }

    const oldExists = await pathExists(oldAbs);
    const newExists = await pathExists(newAbs);

    if (!oldExists && newExists) {
      // Already moved in a previous run; accept idempotently.
      renamedOldToNew.set(item.oldDirRel, item.newDirRel);
      continue;
    }

    if (!oldExists && !newExists) {
      throw new Error(`Cannot rename missing source: ${oldAbs}`);
    }

    if (oldExists && newExists) {
      if (!samePathCaseInsensitive(oldAbs, newAbs)) {
        throw new Error(`Refusing rename because target exists: ${newAbs}`);
      }

      // Case-only rename on case-insensitive filesystems: hop through a temp dir.
      const tempAbs = buildTempRenamePath(newAbs);
      if (args.write) await fs.mkdir(path.dirname(tempAbs), { recursive: true });
      process.stdout.write(`[${modeLabel}] mv ${oldAbs} -> ${tempAbs} (temp hop)\n`);
      process.stdout.write(`[${modeLabel}] mv ${tempAbs} -> ${newAbs}\n`);
      if (args.write) {
        await fs.rename(oldAbs, tempAbs);
        await fs.rename(tempAbs, newAbs);
      }
      stats.directoryRenamesApplied += 1;
      renamedOldToNew.set(item.oldDirRel, item.newDirRel);
      continue;
    }

    const parent = path.dirname(newAbs);
    if (args.write) await fs.mkdir(parent, { recursive: true });
    process.stdout.write(`[${modeLabel}] mv ${oldAbs} -> ${newAbs}\n`);
    if (args.write) await fs.rename(oldAbs, newAbs);
    stats.directoryRenamesApplied += 1;
    renamedOldToNew.set(item.oldDirRel, item.newDirRel);
  }

  // STEP 2: Update SKILL.md frontmatter name
  for (const item of items) {
    if (!item.renameName) continue;

    const skillMdTarget = path.join(args.skillsRoot, ...item.newDirRel.split("/"), "SKILL.md");
    const skillMdSource = path.join(args.skillsRoot, ...item.oldDirRel.split("/"), "SKILL.md");

    const skillMdReadPath = args.write
      ? skillMdTarget
      : ((await pathExists(skillMdTarget)) ? skillMdTarget : skillMdSource);

    if (!(await pathExists(skillMdReadPath))) {
      throw new Error(`Missing SKILL.md for migrated skill: ${skillMdReadPath}`);
    }

    const original = await fs.readFile(skillMdReadPath, "utf8");
    const updated = updateFrontmatterName(original, item.newName);
    if (!updated.changed) continue;

    process.stdout.write(`[${modeLabel}] update frontmatter name in ${skillMdTarget} -> ${item.newName}\n`);
    if (args.write) await fs.writeFile(skillMdTarget, updated.next, "utf8");
    stats.frontmatterUpdatesApplied += 1;
  }

  // STEP 3: Apply safe rewrites in allowlisted trees only
  const safeHits = references.hits.filter((h) => h.category === "safe");
  stats.safeHitsConsidered = safeHits.length;

  const byFile = new Map<string, ReferenceHit[]>();
  for (const hit of safeHits) {
    const filePosix = hit.file.replace(/\\/g, "/");
    const inScope = args.rewritePrefixes.some((prefix) => filePosix.startsWith(prefix));
    if (!inScope) {
      stats.safeHitsSkippedByScope += 1;
      continue;
    }
    const arr = byFile.get(filePosix) ?? [];
    arr.push(hit);
    byFile.set(filePosix, arr);
  }

  stats.rewriteFilesPlanned = byFile.size;

  for (const [filePosix, hits] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fileAbs = path.join(args.repoRoot, ...filePosix.split("/"));
    if (!(await pathExists(fileAbs))) {
      process.stdout.write(`[warn] rewrite target missing (skip): ${filePosix}\n`);
      continue;
    }

    let text = await fs.readFile(fileAbs, "utf8");
    const original = text;
    let replacementsForFile = 0;

    // Apply unique rewrites only once per file/pattern pair.
    const seen = new Set<string>();
    for (const h of hits) {
      const sig = `${h.pattern}\u0000${h.matchText}\u0000${h.replacement}\u0000${h.oldName}\u0000${h.newName}`;
      if (seen.has(sig)) continue;
      seen.add(sig);

      if (h.pattern === "skills-path" || h.pattern === "xml-name") {
        const res = replaceAllLiteral(text, h.matchText, h.replacement);
        text = res.next;
        replacementsForFile += res.count;
        continue;
      }

      if (h.pattern === "skill-call") {
        const oldNameEsc = escapeRegExp(h.oldName);
        const re = new RegExp(
          `(skill\\s*\\(\\s*\\{[\\s\\S]{0,220}?\\bname\\s*:\\s*["'])${oldNameEsc}(["'])`,
          "g",
        );
        const matches = text.match(re)?.length ?? 0;
        if (matches > 0) {
          text = text.replace(re, `$1${h.newName}$2`);
          replacementsForFile += matches;
        }
      }
    }

    if (text !== original) {
      process.stdout.write(`[${modeLabel}] rewrite ${filePosix} (replacements=${replacementsForFile})\n`);
      if (args.write) await fs.writeFile(fileAbs, text, "utf8");
      stats.rewriteFilesApplied += 1;
      stats.rewriteReplacementsApplied += replacementsForFile;
    }
  }

  process.stdout.write("\nSummary:\n");
  process.stdout.write(`- planned skills: ${stats.plannedSkillCount}\n`);
  process.stdout.write(`- directory renames: ${stats.directoryRenamesApplied}/${stats.directoryRenamesPlanned}\n`);
  process.stdout.write(`- frontmatter updates: ${stats.frontmatterUpdatesApplied}/${stats.frontmatterUpdatesPlanned}\n`);
  process.stdout.write(`- safe hits considered: ${stats.safeHitsConsidered}\n`);
  process.stdout.write(`- safe hits skipped by scope: ${stats.safeHitsSkippedByScope}\n`);
  process.stdout.write(`- manual hits ignored: ${stats.manualHitsIgnored}\n`);
  process.stdout.write(`- rewritten files: ${stats.rewriteFilesApplied}/${stats.rewriteFilesPlanned}\n`);
  process.stdout.write(`- total replacements applied: ${stats.rewriteReplacementsApplied}\n`);
  process.stdout.write(`\nMode: ${args.write ? "WRITE (changes applied)" : "DRY-RUN (no files changed)"}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
