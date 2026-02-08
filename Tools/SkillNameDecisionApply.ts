/*
 * SkillNameDecisionApply.ts
 *
 * Coordinator M9D tool:
 * - QA shard decision files
 * - Apply APPLY decisions in a controlled single-writer pass
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

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
  entries: QueueEntry[];
};

type Decision = {
  id: string;
  file: string;
  line: number;
  decision: "APPLY" | "KEEP" | "DEFER";
  reason?: string;
};

type DecisionDoc = {
  shard: string;
  total: number;
  counts: { APPLY: number; KEEP: number; DEFER: number };
  decisions: Decision[];
};

type DeferResolutionDoc = {
  total: number;
  counts: { APPLY: number; KEEP: number };
  resolutions: Array<{
    id: string;
    file: string;
    line: number;
    decision: "APPLY" | "KEEP";
    reason?: string;
  }>;
};

type ApplyResult = {
  id: string;
  file: string;
  line: number;
  type: QueueEntry["type"];
  status: "applied" | "already" | "skipped";
  note: string;
};

type Args = {
  repoRoot: string;
  queuePath: string;
  decisionsDir: string;
  outDir: string;
  deferResolutionPath: string | null;
  write: boolean;
};

function defaults(): Args {
  return {
    repoRoot: "/Users/zuul/Projects/pai-opencode",
    queuePath:
      "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review/queue-full.json",
    decisionsDir:
      "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review",
    outDir: "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review",
    deferResolutionPath: null,
    write: false,
  };
}

function usage(d: Args): string {
  return [
    "SkillNameDecisionApply - M9D coordinator QA/apply",
    "",
    "Usage:",
    "  bun Tools/SkillNameDecisionApply.ts [options]",
    "",
    "Options:",
    `  --repo-root <path>     Repo root (default: ${d.repoRoot})`,
    `  --queue <path>         Queue JSON (default: ${d.queuePath})`,
    `  --decisions-dir <path> Decisions directory (default: ${d.decisionsDir})`,
    `  --out-dir <path>       Output directory (default: ${d.outDir})`,
    "  --defer-resolution <path> JSON with final APPLY/KEEP for deferred IDs",
    "  --write                Apply edits (default: dry-run)",
    "  -h, --help             Show help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const d = defaults();
  const a: Args = { ...d };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage(d)}\n`);
      process.exit(0);
    }
    if (arg === "--repo-root") {
      const v = argv[++i];
      if (!v) throw new Error("Missing --repo-root value");
      a.repoRoot = path.resolve(v);
      continue;
    }
    if (arg === "--queue") {
      const v = argv[++i];
      if (!v) throw new Error("Missing --queue value");
      a.queuePath = path.resolve(v);
      continue;
    }
    if (arg === "--decisions-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing --decisions-dir value");
      a.decisionsDir = path.resolve(v);
      continue;
    }
    if (arg === "--out-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing --out-dir value");
      a.outDir = path.resolve(v);
      continue;
    }
    if (arg === "--defer-resolution") {
      const v = argv[++i];
      if (!v) throw new Error("Missing --defer-resolution value");
      a.deferResolutionPath = path.resolve(v);
      continue;
    }
    if (arg === "--write") {
      a.write = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return a;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineReplace(entry: QueueEntry, line: string): { next: string; status: "applied" | "already" | "skipped"; note: string } {
  const oldEsc = escapeRegExp(entry.oldValue);
  const newVal = entry.newValue;

  if (entry.type === "stale-path") {
    const expected = entry.matchText;
    let replacement = expected;
    replacement = replacement.replace(`skills/${entry.oldValue}/`, `skills/${entry.newValue}/`);
    if (replacement === expected) {
      replacement = replacement.replace(entry.oldValue, entry.newValue);
    }
    if (line.includes(expected)) {
      return { next: line.replace(expected, replacement), status: "applied", note: "stale-path replaced" };
    }
    if (line.includes(replacement)) {
      return { next: line, status: "already", note: "stale-path already migrated" };
    }
    const re = new RegExp(`(?:\\.opencode/)?skills/${escapeRegExp(entry.oldValue)}/`);
    if (re.test(line)) {
      return {
        next: line.replace(re, (m) => m.replace(entry.oldValue, entry.newValue)),
        status: "applied",
        note: "stale-path fallback regex",
      };
    }
    return { next: line, status: "skipped", note: "stale-path not found on line" };
  }

  if (entry.type === "stale-xml-name") {
    const re = new RegExp(`<name>\\s*${oldEsc}\\s*</name>`);
    if (re.test(line)) {
      return { next: line.replace(re, `<name>${newVal}</name>`), status: "applied", note: "xml-name replaced" };
    }
    const reNew = new RegExp(`<name>\\s*${escapeRegExp(newVal)}\\s*</name>`);
    if (reNew.test(line)) return { next: line, status: "already", note: "xml-name already migrated" };
    return { next: line, status: "skipped", note: "xml-name pattern not found" };
  }

  if (entry.type === "stale-skill-call") {
    const re = new RegExp(`(\\bname\\s*:\\s*["'])${oldEsc}(["'])`);
    if (re.test(line)) {
      return { next: line.replace(re, `$1${newVal}$2`), status: "applied", note: "skill-call name replaced" };
    }
    const reNew = new RegExp(`(\\bname\\s*:\\s*["'])${escapeRegExp(newVal)}(["'])`);
    if (reNew.test(line)) return { next: line, status: "already", note: "skill-call already migrated" };
    return { next: line, status: "skipped", note: "skill-call pattern not found" };
  }

  // name-word
  {
    const re = new RegExp(`\\b${oldEsc}\\b`);
    if (re.test(line)) {
      return { next: line.replace(re, newVal), status: "applied", note: "name-word replaced" };
    }
    const reNew = new RegExp(`\\b${escapeRegExp(newVal)}\\b`);
    if (reNew.test(line)) return { next: line, status: "already", note: "name-word already migrated" };
    return { next: line, status: "skipped", note: "name-word not found on line" };
  }
}

function markdownReport(input: {
  mode: "DRY-RUN" | "WRITE";
  queuePath: string;
  decisionFiles: string[];
  totalQueue: number;
  totalDecisions: number;
  apply: number;
  keep: number;
  defer: number;
  unknownIds: string[];
  duplicateIds: string[];
  missingIds: string[];
  fileCountTouched: number;
  appliedCount: number;
  alreadyCount: number;
  skippedCount: number;
}): string {
  const lines: string[] = [];
  lines.push("# M9D Coordinator QA + Apply Report");
  lines.push("");
  lines.push(`Mode: ${input.mode}`);
  lines.push(`Queue: ${input.queuePath}`);
  lines.push(`Decision files: ${input.decisionFiles.length}`);
  lines.push("");
  lines.push("## Decision coverage");
  lines.push("");
  lines.push(`- queue entries: ${input.totalQueue}`);
  lines.push(`- decisions loaded: ${input.totalDecisions}`);
  lines.push(`- APPLY: ${input.apply}`);
  lines.push(`- KEEP: ${input.keep}`);
  lines.push(`- DEFER: ${input.defer}`);
  lines.push(`- unknown IDs: ${input.unknownIds.length}`);
  lines.push(`- duplicate IDs: ${input.duplicateIds.length}`);
  lines.push(`- missing IDs: ${input.missingIds.length}`);
  lines.push("");
  lines.push("## Apply pass");
  lines.push("");
  lines.push(`- files touched: ${input.fileCountTouched}`);
  lines.push(`- applied: ${input.appliedCount}`);
  lines.push(`- already: ${input.alreadyCount}`);
  lines.push(`- skipped: ${input.skippedCount}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Unknown/duplicate IDs should be zero before final close.");
  lines.push("- DEFER IDs remain for coordinator resolution (M9D).\n");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const queue = await readJson<QueueDoc>(args.queuePath);

  const decisionFiles = (await fs.readdir(args.decisionsDir))
    .filter((n) => /^shard-\d\d-decisions\.json$/.test(n))
    .sort();

  if (decisionFiles.length === 0) {
    throw new Error(`No shard decision files found in ${args.decisionsDir}`);
  }

  const queueById = new Map(queue.entries.map((e) => [e.id, e]));
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const unknownIds = new Set<string>();
  const decisions: Decision[] = [];

  for (const file of decisionFiles) {
    const doc = await readJson<DecisionDoc>(path.join(args.decisionsDir, file));
    for (const d of doc.decisions) {
      decisions.push(d);
      if (!queueById.has(d.id)) unknownIds.add(d.id);
      if (seenIds.has(d.id)) duplicateIds.add(d.id);
      seenIds.add(d.id);
    }
  }

  if (args.deferResolutionPath) {
    const res = await readJson<DeferResolutionDoc>(args.deferResolutionPath);
    const byId = new Map(res.resolutions.map((r) => [r.id, r]));
    for (const d of decisions) {
      const override = byId.get(d.id);
      if (!override) continue;
      d.decision = override.decision;
      if (override.reason) d.reason = override.reason;
    }
  }

  const missingIds = queue.entries.filter((e) => !seenIds.has(e.id)).map((e) => e.id);

  const applyEntries = decisions
    .filter((d) => d.decision === "APPLY" && queueById.has(d.id))
    .map((d) => queueById.get(d.id) as QueueEntry)
    .sort((a, b) => {
      const ka = `${a.file}:${String(a.line).padStart(8, "0")}:${a.id}`;
      const kb = `${b.file}:${String(b.line).padStart(8, "0")}:${b.id}`;
      return ka.localeCompare(kb);
    });

  const byFile = new Map<string, QueueEntry[]>();
  for (const e of applyEntries) {
    const arr = byFile.get(e.file) ?? [];
    arr.push(e);
    byFile.set(e.file, arr);
  }

  const results: ApplyResult[] = [];

  for (const [fileRel, entries] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const abs = path.join(args.repoRoot, ...fileRel.split("/"));
    let text = "";
    try {
      text = await fs.readFile(abs, "utf8");
    } catch {
      for (const e of entries) {
        results.push({ id: e.id, file: e.file, line: e.line, type: e.type, status: "skipped", note: "file missing" });
      }
      continue;
    }

    const lines = text.split(/\r?\n/);
    let changed = false;

    for (const e of entries) {
      const idx = e.line - 1;
      if (idx < 0 || idx >= lines.length) {
        results.push({ id: e.id, file: e.file, line: e.line, type: e.type, status: "skipped", note: "line out of range" });
        continue;
      }

      const repl = lineReplace(e, lines[idx]);
      if (repl.status === "applied") {
        lines[idx] = repl.next;
        changed = true;
      }
      results.push({ id: e.id, file: e.file, line: e.line, type: e.type, status: repl.status, note: repl.note });
    }

    if (changed && args.write) {
      await fs.writeFile(abs, `${lines.join("\n")}${text.endsWith("\n") ? "\n" : ""}`, "utf8");
    }
  }

  const applyCount = decisions.filter((d) => d.decision === "APPLY").length;
  const keepCount = decisions.filter((d) => d.decision === "KEEP").length;
  const deferCount = decisions.filter((d) => d.decision === "DEFER").length;

  const appliedCount = results.filter((r) => r.status === "applied").length;
  const alreadyCount = results.filter((r) => r.status === "already").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const fileCountTouched = new Set(results.filter((r) => r.status !== "skipped").map((r) => r.file)).size;

  await fs.mkdir(args.outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.write ? "WRITE" : "DRY-RUN",
    queuePath: args.queuePath,
    decisionsDir: args.decisionsDir,
    summary: {
      decisionFiles: decisionFiles.length,
      totalQueue: queue.entries.length,
      totalDecisions: decisions.length,
      apply: applyCount,
      keep: keepCount,
      defer: deferCount,
      unknownIds: [...unknownIds].sort(),
      duplicateIds: [...duplicateIds].sort(),
      missingIds: missingIds.sort(),
      fileCountTouched,
      appliedCount,
      alreadyCount,
      skippedCount,
    },
    applyResults: results,
    deferDecisions: decisions.filter((d) => d.decision === "DEFER"),
  };

  const reportJson = path.join(args.outDir, "m9d-apply-report.json");
  const reportMd = path.join(args.outDir, "m9d-apply-report.md");
  await fs.writeFile(reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(
    reportMd,
    `${markdownReport({
      mode: args.write ? "WRITE" : "DRY-RUN",
      queuePath: args.queuePath,
      decisionFiles,
      totalQueue: queue.entries.length,
      totalDecisions: decisions.length,
      apply: applyCount,
      keep: keepCount,
      defer: deferCount,
      unknownIds: [...unknownIds],
      duplicateIds: [...duplicateIds],
      missingIds,
      fileCountTouched,
      appliedCount,
      alreadyCount,
      skippedCount,
    })}\n`,
    "utf8",
  );

  process.stdout.write(`Wrote:\n- ${reportJson}\n- ${reportMd}\n`);
  process.stdout.write("\nSummary:\n");
  process.stdout.write(`- queue entries: ${queue.entries.length}\n`);
  process.stdout.write(`- decisions: ${decisions.length} (APPLY=${applyCount}, KEEP=${keepCount}, DEFER=${deferCount})\n`);
  process.stdout.write(`- unknown IDs: ${unknownIds.size}, duplicate IDs: ${duplicateIds.size}, missing IDs: ${missingIds.length}\n`);
  process.stdout.write(`- apply results: applied=${appliedCount}, already=${alreadyCount}, skipped=${skippedCount}\n`);
  process.stdout.write(`- files touched: ${fileCountTouched}\n`);
  process.stdout.write(`Mode: ${args.write ? "WRITE" : "DRY-RUN"}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
