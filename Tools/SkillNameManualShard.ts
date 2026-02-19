/*
 * SkillNameManualShard.ts
 *
 * Split M9 manual queue into deterministic shard files for parallel subagents.
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

type Shard = {
  shardId: string;
  shardNumber: number;
  totalShards: number;
  generatedAt: string;
  sourceQueuePath: string;
  summary: {
    total: number;
    byType: Record<string, number>;
    highSeverity: number;
    mediumSeverity: number;
    autoCandidate: number;
    manualOnly: number;
  };
  entries: QueueEntry[];
};

type ShardIndex = {
  generatedAt: string;
  sourceQueuePath: string;
  totalEntries: number;
  totalShards: number;
  shardFiles: string[];
};

type Args = {
  queuePath: string;
  outDir: string;
  shardCount: number;
};

function defaultQueuePath(): string {
  return "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review/queue-full.json";
}

function defaultOutDir(): string {
  return "/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3c6d10ef1ffeQgqw3HQlw83pbX/scratch/m9-manual-review";
}

function usage(defaults: Args): string {
  return [
    "SkillNameManualShard - split manual queue for subagents",
    "",
    "Usage:",
    "  bun Tools/SkillNameManualShard.ts [options]",
    "",
    "Options:",
    `  --queue <path>       Queue file (default: ${defaults.queuePath})`,
    `  --out-dir <path>     Output directory (default: ${defaults.outDir})`,
    `  --shards <number>    Number of shards (default: ${defaults.shardCount})`,
    "  -h, --help           Show help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const defaults: Args = {
    queuePath: defaultQueuePath(),
    outDir: defaultOutDir(),
    shardCount: 12,
  };

  const args: Args = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage(defaults)}\n`);
      process.exit(0);
    }
    if (arg === "--queue") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --queue");
      args.queuePath = path.resolve(v);
      continue;
    }
    if (arg === "--out-dir") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --out-dir");
      args.outDir = path.resolve(v);
      continue;
    }
    if (arg === "--shards") {
      const v = argv[++i];
      if (!v) throw new Error("Missing value for --shards");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0 || n > 200) {
        throw new Error(`Invalid --shards value: ${v}`);
      }
      args.shardCount = n;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

function buildShardSummary(entries: QueueEntry[]): Shard["summary"] {
  const byType: Record<string, number> = {};
  let highSeverity = 0;
  let mediumSeverity = 0;
  let autoCandidate = 0;
  let manualOnly = 0;

  for (const e of entries) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.severity === "high") highSeverity += 1;
    else mediumSeverity += 1;
    if (e.autoCandidate) autoCandidate += 1;
    else manualOnly += 1;
  }

  return {
    total: entries.length,
    byType,
    highSeverity,
    mediumSeverity,
    autoCandidate,
    manualOnly,
  };
}

function shardMarkdown(index: ShardIndex, shards: Shard[]): string {
  const lines: string[] = [];
  lines.push("# M9B Shard Plan");
  lines.push("");
  lines.push(`Generated: ${index.generatedAt}`);
  lines.push(`Source queue: ${index.sourceQueuePath}`);
  lines.push(`Total entries: ${index.totalEntries}`);
  lines.push(`Total shards: ${index.totalShards}`);
  lines.push("");
  lines.push("## Shards");
  lines.push("");
  lines.push("| Shard | Entries | High | Medium | Auto | Manual | stale-path | name-word | stale-xml-name | stale-skill-call |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of shards) {
    const byType = s.summary.byType;
    lines.push(
      `| ${s.shardId} | ${s.summary.total} | ${s.summary.highSeverity} | ${s.summary.mediumSeverity} | ${s.summary.autoCandidate} | ${s.summary.manualOnly} | ${byType["stale-path"] ?? 0} | ${byType["name-word"] ?? 0} | ${byType["stale-xml-name"] ?? 0} | ${byType["stale-skill-call"] ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("## Next step");
  lines.push("");
  lines.push("- Use shard files with subagent fan-out (M9C).");
  lines.push("- Each subagent writes `shard-XX-report.md` with APPLY/KEEP/DEFER outcomes.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const queue = await readJson<QueueDoc>(args.queuePath);

  const entries = [...queue.entries].sort((a, b) => {
    // High severity first, then deterministic location
    const sa = a.severity === "high" ? 0 : 1;
    const sb = b.severity === "high" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ka = `${a.file}:${String(a.line).padStart(8, "0")}:${a.type}:${a.id}`;
    const kb = `${b.file}:${String(b.line).padStart(8, "0")}:${b.type}:${b.id}`;
    return ka.localeCompare(kb);
  });

  const buckets: QueueEntry[][] = Array.from({ length: args.shardCount }, () => []);
  for (let i = 0; i < entries.length; i++) {
    buckets[i % args.shardCount].push(entries[i]);
  }

  const generatedAt = new Date().toISOString();
  const shardDocs: Shard[] = [];
  const shardFiles: string[] = [];

  await fs.mkdir(args.outDir, { recursive: true });

  for (let i = 0; i < buckets.length; i++) {
    const shardNumber = i + 1;
    const shardId = `shard-${String(shardNumber).padStart(2, "0")}`;
    const doc: Shard = {
      shardId,
      shardNumber,
      totalShards: buckets.length,
      generatedAt,
      sourceQueuePath: args.queuePath,
      summary: buildShardSummary(buckets[i]),
      entries: buckets[i],
    };
    const fileName = `queue-${shardId}.json`;
    const filePath = path.join(args.outDir, fileName);
    await fs.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    shardDocs.push(doc);
    shardFiles.push(filePath);
  }

  const index: ShardIndex = {
    generatedAt,
    sourceQueuePath: args.queuePath,
    totalEntries: queue.entries.length,
    totalShards: buckets.length,
    shardFiles,
  };

  const indexPath = path.join(args.outDir, "queue-shard-index.json");
  const planPath = path.join(args.outDir, "queue-shard-plan.md");
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.writeFile(planPath, shardMarkdown(index, shardDocs), "utf8");

  process.stdout.write(`Wrote ${shardFiles.length} shard files\n`);
  process.stdout.write(`- ${indexPath}\n`);
  process.stdout.write(`- ${planPath}\n`);
  process.stdout.write(`\nSummary:\n`);
  process.stdout.write(`- queue entries: ${queue.entries.length}\n`);
  process.stdout.write(`- shards: ${args.shardCount}\n`);
  for (const s of shardDocs) {
    process.stdout.write(`  - ${s.shardId}: ${s.summary.total} entries (high=${s.summary.highSeverity}, auto=${s.summary.autoCandidate})\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ? String(err.stack) : String(err)}\n`);
  process.exit(1);
});
