#!/usr/bin/env bun
/**
 * ExtractSessionLearnings.ts
 *
 * Manual, loop-safe learning extraction from a WORK session into LEARNING.
 * This avoids relying on risky runtime hooks (e.g., session.deleted) while still
 * enabling “wisdom capture” on-demand.
 *
 * Usage:
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts <sessionId>
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts --latest
 *
 * Options:
 *   --persist   Write extracted learnings into MEMORY/LEARNING/
 *   --include-markers  Also scan for "Learning:"/"Key insight:" patterns (noisier)
 *   --json      Output JSON
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPaiRuntimeInfo } from '../../../pai-tools/PaiRuntime';

type LearningCategory = 'ALGORITHM' | 'SYSTEM' | 'CODE' | 'RESPONSE' | 'GENERAL';

type LearningEntry = {
  title: string;
  content: string;
  category: LearningCategory;
  source: string;
  timestamp: string;
  persistedPath?: string;
};

type RawEventFile = { sessionId: string; yearMonth: string; rawPath: string };

function usage(): string {
  return [
    'ExtractSessionLearnings - manual WORK → LEARNING extraction',
    '',
    'Usage:',
    '  bun run ExtractSessionLearnings.ts <sessionId> [--persist]',
    '  bun run ExtractSessionLearnings.ts --latest [--persist]',
    '',
    'Options:',
    '  --persist   Write markdown files into MEMORY/LEARNING/<CATEGORY>/<YYYY-MM>/',
    '  --include-markers  Also scan for "Learning:"/"Key insight:" patterns (noisier)',
    '  --json      Output JSON instead of text',
  ].join('\n');
}

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

function listDirs(p: string): string[] {
  try {
    return fs.readdirSync(p).map((n) => path.join(p, n)).filter(dirExists);
  } catch {
    return [];
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function timestampForFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function detectCategory(content: string): LearningCategory {
  const lower = content.toLowerCase();
  if (/algorithm|phase|isc|execute|verify|observe|think|plan|build/i.test(lower)) return 'ALGORITHM';
  if (/system|config|hook|plugin|infrastructure|architecture/i.test(lower)) return 'SYSTEM';
  if (/code|function|class|method|bug|fix|refactor/i.test(lower)) return 'CODE';
  if (/response|format|output|voice|display/i.test(lower)) return 'RESPONSE';
  return 'GENERAL';
}

function extractLearningsFromText(content: string, source: string): LearningEntry[] {
  const learnings: LearningEntry[] = [];

  const patterns = [
    /(?:Learning|Learned|Key insight|Insight|Takeaway):\s*(.+?)(?:\n\n|\n(?=[A-Z#*-]))/gis,
    /##\s+(?:Learning|Learned|Key insight|Insight|Takeaway)[^\n]*\n\n(.+?)(?:\n##|\n---|$)/gis,
  ];

  for (const pattern of patterns) {
    for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
      const learningContent = String(match[1] || '').trim();
      if (learningContent.length < 20) continue;
      learnings.push({
        title: learningContent.split('\n')[0].slice(0, 80),
        content: learningContent,
        category: detectCategory(learningContent),
        source,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return learnings;
}

function stripToolOutputNoise(markdown: string): string {
  // Remove common tool-output wrappers captured into THREAD.md.
  // 1) Fenced code blocks
  // 2) <file> ... </file> dumps (opencode Read tool)
  // 3) <commentary> ... </commentary> (tool chatter)
  // 4) Line-numbered dumps like: 00001| ...
  let t = markdown;
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/<file>[\s\S]*?<\/file>/g, '');
  t = t.replace(/<commentary>[\s\S]*?<\/commentary>/g, '');
  t = t
    .split(/\r?\n/)
    .filter((line) => !/^\s*\d{5}\|/.test(line))
    .join('\n');
  return t;
}

function extractLearnPhases(threadMarkdown: string): LearningEntry[] {
  const text = stripToolOutputNoise(threadMarkdown);
  const out: LearningEntry[] = [];

  // Capture content after LEARN phase header up to SUMMARY/voice/next phase.
  const re = /━━━\s+📚\s+(?:L E A R N|LEARN)\s+━━━\s+7\/7[\s\S]*?\n([\s\S]*?)(?=\n📋 SUMMARY:|\n🗣️\s|\n━━━\s+|$)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const chunk = String(m[1] || '').trim();
    if (!chunk) continue;
    // Skip placeholder-only chunks.
    if (/\[What to improve next time\]/i.test(chunk) && chunk.length < 80) continue;
    out.push({
      title: 'LEARN Phase Notes',
      content: chunk,
      category: detectCategory(chunk),
      source: 'THREAD.md:LEARN',
      timestamp: new Date().toISOString(),
    });
  }

  return out;
}

function findLatestRaw(memoryDir: string): RawEventFile | null {
  const rawRoot = path.join(memoryDir, 'RAW');
  let best: { sessionId: string; yearMonth: string; rawPath: string; mtimeMs: number } | null = null;
  for (const monthDir of listDirs(rawRoot)) {
    const yearMonth = path.basename(monthDir);
    let names: string[] = [];
    try {
      names = fs.readdirSync(monthDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.startsWith('ses_') || !name.endsWith('.jsonl')) continue;
      const rawPath = path.join(monthDir, name);
      try {
        const mtimeMs = fs.statSync(rawPath).mtimeMs;
        const sessionId = name.replace(/\.jsonl$/, '');
        if (!best || mtimeMs > best.mtimeMs) best = { sessionId, yearMonth, rawPath, mtimeMs };
      } catch {
        // ignore
      }
    }
  }
  if (!best) return null;
  return { sessionId: best.sessionId, yearMonth: best.yearMonth, rawPath: best.rawPath };
}

function findRaw(memoryDir: string, sessionId: string): RawEventFile | null {
  const rawRoot = path.join(memoryDir, 'RAW');
  for (const monthDir of listDirs(rawRoot)) {
    const yearMonth = path.basename(monthDir);
    const rawPath = path.join(monthDir, `${sessionId}.jsonl`);
    if (fileExists(rawPath)) return { sessionId, yearMonth, rawPath };
  }
  return null;
}

async function persistLearning(runtime: ReturnType<typeof getPaiRuntimeInfo>, yearMonth: string, learning: LearningEntry): Promise<string> {
  const outDir = path.join(runtime.memoryDir, 'LEARNING', learning.category, yearMonth);
  await ensureDir(outDir);
  const ts = timestampForFilename(new Date());
  const base = slugify(learning.title || 'learning') || 'learning';
  const outPath = path.join(outDir, `${ts}_${base}.md`);
  const md = [
    `# ${learning.title}`,
    '',
    `**Category:** ${learning.category}`,
    `**Source:** ${learning.source}`,
    `**Timestamp:** ${learning.timestamp}`,
    '',
    '---',
    '',
    learning.content.trim(),
    '',
  ].join('\n');
  await fs.promises.writeFile(outPath, md, 'utf-8');
  return outPath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const jsonOut = args.includes('--json');
  const persist = args.includes('--persist');
  const includeMarkers = args.includes('--include-markers');
  const latest = args.includes('--latest');
  const sessionArg = args.filter((a) => !a.startsWith('--'))[0] || '';

  const runtime = getPaiRuntimeInfo();
  if (!dirExists(runtime.memoryDir)) {
    const msg = `MEMORY dir not found: ${runtime.memoryDir}`;
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(2);
  }

  const raw = latest
    ? findLatestRaw(runtime.memoryDir)
    : sessionArg
      ? findRaw(runtime.memoryDir, sessionArg)
      : null;

  if (!raw) {
    const msg = latest ? 'No RAW sessions found.' : 'RAW session not found (provide <sessionId> or --latest).';
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(2);
  }

  const workDir = path.join(runtime.memoryDir, 'WORK', raw.yearMonth, raw.sessionId);
  if (!dirExists(workDir)) {
    const msg = `WORK dir not found for session: ${workDir}`;
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg, sessionId: raw.sessionId }));
    else console.error(msg);
    process.exit(2);
  }

  const learnings: LearningEntry[] = [];

  // 1) THREAD.md patterns
  const threadPath = path.join(workDir, 'THREAD.md');
  if (fileExists(threadPath)) {
    const thread = fs.readFileSync(threadPath, 'utf-8');
    // Prefer deterministic extraction from explicit LEARN phases.
    learnings.push(...extractLearnPhases(thread));
    // Optional: also extract explicit markers (can be noisy in tool-heavy threads).
    if (includeMarkers) {
      learnings.push(...extractLearningsFromText(stripToolOutputNoise(thread), 'THREAD.md'));
    }
  }

  // 2) scratch/*.md patterns
  const scratchDir = path.join(workDir, 'scratch');
  if (dirExists(scratchDir)) {
    const files = fs.readdirSync(scratchDir).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const p = path.join(scratchDir, f);
      try {
        const c = fs.readFileSync(p, 'utf-8');
        learnings.push(...extractLearningsFromText(stripToolOutputNoise(c), `scratch/${f}`));
      } catch {
        // ignore
      }
    }
  }

  // 3) ISC summary as a learning entry (if available)
  const iscPath = path.join(workDir, 'ISC.json');
  if (fileExists(iscPath)) {
    try {
      const isc = JSON.parse(fs.readFileSync(iscPath, 'utf-8')) as Record<string, unknown>;
      const criteria = Array.isArray(isc.criteria) ? (isc.criteria as Array<Record<string, unknown>>) : [];
      const done = criteria.filter((c) => {
        const s = String(c.status || '').toUpperCase();
        return s === 'DONE' || s === 'VERIFIED' || s === 'COMPLETED';
      });
      if (done.length) {
        const content = done
          .map((c) => `- ${String(c.text || c.description || '(no text)')}: ${String(c.status || 'UNKNOWN')}`)
          .join('\n');
        learnings.push({
          title: 'ISC Completion Summary',
          content: `Completed ${done.length} criteria:\n\n${content}`,
          category: 'ALGORITHM',
          source: 'ISC.json',
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }

  // De-dup by exact content.
  const seen = new Set<string>();
  const unique = learnings.filter((l) => {
    const norm = l.content.replace(/\s+/g, ' ').trim();
    const key = `${l.category}:${l.title}:${norm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist if requested.
  if (persist) {
    for (const l of unique) {
      try {
        l.persistedPath = await persistLearning(runtime, raw.yearMonth, l);
      } catch {
        // ignore
      }
    }
  }

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId: raw.sessionId,
          yearMonth: raw.yearMonth,
          workDir,
          persist,
          count: unique.length,
          learnings: unique,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Session: ${raw.sessionId}`);
  console.log(`Month:   ${raw.yearMonth}`);
  console.log(`WORK:    ${workDir}`);
  console.log(`Persist: ${persist ? 'yes' : 'no'}`);
  console.log('');
  console.log(`Learnings: ${unique.length}`);
  for (const l of unique) {
    console.log('');
    console.log(`- [${l.category}] ${l.title} (${l.source})`);
    if (l.persistedPath) console.log(`  ↳ saved: ${l.persistedPath}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(2);
  });
}
