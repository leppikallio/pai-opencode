/*
 * SkillNameManualQueue.ts
 *
 * Build a post-write manual review queue with exact coordinates.
 *
 * Inputs:
 * - baseline migration manifest (pre-write old->new mapping)
 * - repo root + scan prefixes
 *
 * Outputs:
 * - queue-full.json
 * - queue-summary.md
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
};

type Manifest = {
  items: ManifestItem[];
};

type QueueEntry = {
  id: string;
  file: string;
  line: number;
  type: "stale-path" | "stale-xml-name" | "stale-skill-call" | "name-word";
  severity: "high" | "medium";
  oldValue: string;
  newValue: string;
  matchText: string;
  autoCandidate: boolean;
};

type QueueDoc = {
  generatedAt: string;
  repoRoot: string;
  manifestPath: string;
  scanPrefixes: string[];
  summary: {
    filesScanned: number;
    total: number;
    byType: Record<string, number>;
    autoCandidateCount: number;
    manualOnlyCount: number;
  };
  entries: QueueEntry[];
};

type Args = {
  repoRoot: string;
  manifestPath: string;
  outDir: string;
  scanPrefixes: string[];
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

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function usage(defaults: Args): string {
  return [
    "SkillNameManualQueue - build manual review queue with exact coordinates",
    "",
    "Usage:",
    "  bun Tools/SkillNameManualQueue.ts [options]",
    "",
    "Options:",
    `  --repo-root <path>      Repo root (default: ${defaults.repoRoot})`,
    `  --manifest <path>       Baseline manifest path (default: ${defaults.manifestPath})`,
    `  --out-dir <path>        Output dir (default: ${defaults.outDir})`,
    "  --scan-prefix <prefix>  Prefix to scan (repeatable)",
    "                         defaults: .opencode/, Tools/, Packs/",
    "  -h, --help              Show help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const repoRoot = repoRootFromThisFile();
  const defaults: Args = {
    repoRoot,
    manifestPath:
      "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m3-skill-migration/migration-manifest.json",
    outDir:
      "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review",
    scanPrefixes: [".opencode/", "Tools/", "Packs/"],
  };

  const args: Args = { ...defaults, scanPrefixes: [...defaults.scanPrefixes] };
  let prefixesOverridden = false;

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
    if (arg === "--scan-prefix") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --scan-prefix");
      if (!prefixesOverridden) {
        args.scanPrefixes = [];
        prefixesOverridden = true;
      }
      args.scanPrefixes.push(v);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  args.scanPrefixes = [...new Set(args.scanPrefixes.map(normalizePrefix))].sort();
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
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

async function listTextFiles(repoRoot: string, prefixes: string[]): Promise<string[]> {
  const out = new Set<string>();

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
      out.add(abs);
    }
  }

  for (const prefix of prefixes) {
    const abs = path.join(repoRoot, ...prefix.replace(/\/$/, "").split("/"));
    if (!(await pathExists(abs))) continue;
    await walk(abs);
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

function addEntry(entries: QueueEntry[], dedupe: Set<string>, entry: QueueEntry): void {
  const key = `${entry.file}:${entry.line}:${entry.type}:${entry.oldValue}:${entry.newValue}:${entry.matchText}`;
  if (dedupe.has(key)) return;
  dedupe.add(key);
  entries.push(entry);
}

function buildSummaryMarkdown(queue: QueueDoc): string {
  const lines: string[] = [];
  lines.push("# M9 Manual Queue Summary");
  lines.push("");
  lines.push(`Generated: ${queue.generatedAt}`);
  lines.push(`Manifest: ${queue.manifestPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- files scanned: ${queue.summary.filesScanned}`);
  lines.push(`- total queue entries: ${queue.summary.total}`);
  lines.push(`- auto-candidate entries: ${queue.summary.autoCandidateCount}`);
  lines.push(`- manual-only entries: ${queue.summary.manualOnlyCount}`);
  lines.push("");
  lines.push("## By type");
  lines.push("");
  for (const [type, count] of Object.entries(queue.summary.byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push("");

  const byFile = new Map<string, number>();
  for (const e of queue.entries) {
    byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1);
  }
  lines.push("## Top files (first 40)");
  lines.push("");
  for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    lines.push(`- ${count}\t${file}`);
  }
  if (byFile.size === 0) lines.push("- none");
  lines.push("");

  lines.push("## Next step");
  lines.push("");
  lines.push("- Use this queue for M9B sharding (`queue-shard-01.json` ...).\n");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await pathExists(args.repoRoot))) throw new Error(`repo root not found: ${args.repoRoot}`);
  if (!(await pathExists(args.manifestPath))) throw new Error(`manifest not found: ${args.manifestPath}`);

  const manifest = await readJson<Manifest>(args.manifestPath);
  const items = manifest.items.filter((x) => !x.excluded && x.oldName !== x.newName);

  const files = await listTextFiles(args.repoRoot, args.scanPrefixes);
  const entries: QueueEntry[] = [];
  const dedupe = new Set<string>();
  let idCounter = 0;

  for (const fileAbs of files) {
    const text = await fs.readFile(fileAbs, "utf8").catch(() => "");
    if (!text) continue;
    const fileRel = toPosix(path.relative(args.repoRoot, fileAbs));

    for (const item of items) {
      const oldDirRelEsc = escapeRegExp(item.oldDirRel);
      const oldNameEsc = escapeRegExp(item.oldName);

      // 1) stale path refs (high, auto candidate)
      {
        const re = new RegExp(`(?:\\.opencode/)?skills/${oldDirRelEsc}/`, "g");
        for (;;) {
          const m = re.exec(text);
          if (!m) break;
          idCounter += 1;
          addEntry(entries, dedupe, {
            id: `Q${String(idCounter).padStart(6, "0")}`,
            file: fileRel,
            line: lineNumberAt(text, m.index),
            type: "stale-path",
            severity: "high",
            oldValue: item.oldDirRel,
            newValue: item.newDirRel,
            matchText: m[0],
            autoCandidate: true,
          });
        }
      }

      // 2) stale xml skill name refs (high, auto candidate)
      {
        const re = new RegExp(`<name>\\s*${oldNameEsc}\\s*</name>`, "g");
        for (;;) {
          const m = re.exec(text);
          if (!m) break;
          idCounter += 1;
          addEntry(entries, dedupe, {
            id: `Q${String(idCounter).padStart(6, "0")}`,
            file: fileRel,
            line: lineNumberAt(text, m.index),
            type: "stale-xml-name",
            severity: "high",
            oldValue: item.oldName,
            newValue: item.newName,
            matchText: m[0],
            autoCandidate: true,
          });
        }
      }

      // 3) stale skill tool calls (high, auto candidate)
      {
        const re = new RegExp(`skill\\s*\\(\\s*\\{[\\s\\S]{0,220}?\\bname\\s*:\\s*["']${oldNameEsc}["']`, "g");
        for (;;) {
          const m = re.exec(text);
          if (!m) break;
          idCounter += 1;
          addEntry(entries, dedupe, {
            id: `Q${String(idCounter).padStart(6, "0")}`,
            file: fileRel,
            line: lineNumberAt(text, m.index),
            type: "stale-skill-call",
            severity: "high",
            oldValue: item.oldName,
            newValue: item.newName,
            matchText: m[0].slice(0, 220),
            autoCandidate: true,
          });
        }
      }

      // 4) bare old name words (medium, manual-only)
      {
        const re = new RegExp(`\\b${oldNameEsc}\\b`, "g");
        for (;;) {
          const m = re.exec(text);
          if (!m) break;
          idCounter += 1;
          addEntry(entries, dedupe, {
            id: `Q${String(idCounter).padStart(6, "0")}`,
            file: fileRel,
            line: lineNumberAt(text, m.index),
            type: "name-word",
            severity: "medium",
            oldValue: item.oldName,
            newValue: item.newName,
            matchText: m[0],
            autoCandidate: false,
          });
        }
      }
    }
  }

  entries.sort((a, b) => {
    const ka = `${a.file}:${String(a.line).padStart(8, "0")}:${a.type}:${a.oldValue}`;
    const kb = `${b.file}:${String(b.line).padStart(8, "0")}:${b.type}:${b.oldValue}`;
    return ka.localeCompare(kb);
  });

  const byType: Record<string, number> = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }

  const queue: QueueDoc = {
    generatedAt: new Date().toISOString(),
    repoRoot: args.repoRoot,
    manifestPath: args.manifestPath,
    scanPrefixes: args.scanPrefixes,
    summary: {
      filesScanned: files.length,
      total: entries.length,
      byType,
      autoCandidateCount: entries.filter((e) => e.autoCandidate).length,
      manualOnlyCount: entries.filter((e) => !e.autoCandidate).length,
    },
    entries,
  };

  await fs.mkdir(args.outDir, { recursive: true });
  const queuePath = path.join(args.outDir, "queue-full.json");
  const summaryPath = path.join(args.outDir, "queue-summary.md");
  await fs.writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${buildSummaryMarkdown(queue)}\n`, "utf8");

  process.stdout.write(`Wrote:\n- ${queuePath}\n- ${summaryPath}\n`);
  process.stdout.write(`\nSummary:\n`);
  process.stdout.write(`- files scanned: ${queue.summary.filesScanned}\n`);
  process.stdout.write(`- total entries: ${queue.summary.total}\n`);
  process.stdout.write(`- auto-candidate: ${queue.summary.autoCandidateCount}\n`);
  process.stdout.write(`- manual-only: ${queue.summary.manualOnlyCount}\n`);
  for (const [type, count] of Object.entries(queue.summary.byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    process.stdout.write(`  - ${type}: ${count}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
