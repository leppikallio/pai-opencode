#!/usr/bin/env bun
/**
 * ReplayRawSession.ts
 *
 * Offline “replay” and normalization for OpenCode PAI RAW session logs.
 * This does NOT execute tools or modify any hooks. It reads JSONL and produces
 * deterministic summaries (and optional normalized JSONL output).
 *
 * Usage:
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts <sessionId>
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/ReplayRawSession.ts --latest
 *
 * Options:
 *   --out <file>  Write normalized jsonl with seq numbers
 *   --json        JSON summary to stdout
 *   --max <n>     Max inversions/mismatches to list (default: 30)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPaiRuntimeInfo } from '../../../pai-tools/PaiRuntime';

type RawEvent = {
  v?: string;
  id?: string;
  ts?: string;
  sessionId?: string;
  sourceSessionId?: string;
  kind?: string;
  name?: string;
  payload?: Record<string, unknown>;
  [k: string]: unknown;
};

function usage(): string {
  return [
    'ReplayRawSession - normalize and analyze PAI RAW jsonl',
    '',
    'Usage:',
    '  bun run ReplayRawSession.ts <sessionId>',
    '  bun run ReplayRawSession.ts --latest',
    '',
    'Options:',
    '  --out <file>  Write normalized jsonl with seq numbers',
    '  --json        Output JSON summary',
    '  --max <n>     Max items to list (default: 30)',
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

function listDirs(p: string): string[] {
  try {
    return fs.readdirSync(p).map((n) => path.join(p, n)).filter((pp) => dirExists(pp));
  } catch {
    return [];
  }
}

function findSessionRaw(memoryDir: string, sessionId: string): { yearMonth: string; rawPath: string } | null {
  const rawRoot = path.join(memoryDir, 'RAW');
  for (const monthDir of listDirs(rawRoot)) {
    const yearMonth = path.basename(monthDir);
    const candidate = path.join(monthDir, `${sessionId}.jsonl`);
    if (fileExists(candidate)) return { yearMonth, rawPath: candidate };
  }
  return null;
}

function findLatestSessionRaw(memoryDir: string): { sessionId: string; yearMonth: string; rawPath: string } | null {
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

function safeJsonParse(line: string): RawEvent | null {
  try {
    const obj = JSON.parse(line) as RawEvent;
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

function tsMs(ts: string | undefined): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function getCallId(e: RawEvent): string {
  const p = e.payload;
  return p && typeof p.callId === 'string' ? p.callId : '';
}

function compareEvents(a: RawEvent, b: RawEvent): number {
  const ta = tsMs(a.ts);
  const tb = tsMs(b.ts);
  if (ta !== tb) return ta - tb;
  const ia = String(a.id || '');
  const ib = String(b.id || '');
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const jsonOut = args.includes('--json');
  const latest = args.includes('--latest');

  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? String(args[outIdx + 1] || '') : '';

  const maxIdx = args.indexOf('--max');
  const maxRaw = maxIdx >= 0 ? Number(args[maxIdx + 1] || '30') : 30;
  const maxN = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 30;

  const sessionArg = args.filter((a) => !a.startsWith('--'))[0] || '';

  const runtime = getPaiRuntimeInfo();
  if (!dirExists(runtime.memoryDir)) {
    const msg = `MEMORY dir not found: ${runtime.memoryDir}`;
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(2);
  }

  let sessionId = sessionArg;
  let yearMonth = '';
  let rawPath = '';

  if (latest) {
    const found = findLatestSessionRaw(runtime.memoryDir);
    if (!found) {
      const msg = `No RAW sessions found under: ${path.join(runtime.memoryDir, 'RAW')}`;
      if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(msg);
      process.exit(2);
    }
    sessionId = found.sessionId;
    yearMonth = found.yearMonth;
    rawPath = found.rawPath;
  } else {
    if (!sessionId) {
      console.log(usage());
      process.exit(1);
    }
    const found = findSessionRaw(runtime.memoryDir, sessionId);
    if (!found) {
      const msg = `RAW file not found for session: ${sessionId}`;
      if (jsonOut) console.log(JSON.stringify({ ok: false, error: msg, sessionId }));
      else console.error(msg);
      process.exit(2);
    }
    yearMonth = found.yearMonth;
    rawPath = found.rawPath;
  }

  const lines = fs.readFileSync(rawPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const parsed = lines.map(safeJsonParse).filter(Boolean) as RawEvent[];

  // Inversions: where timestamps go backwards in file order.
  const inversions: Array<{ index: number; prevTs: string; ts: string; prevId: string; id: string }> = [];
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    const a = tsMs(prev.ts);
    const b = tsMs(cur.ts);
    if (a > 0 && b > 0 && b < a) {
      inversions.push({
        index: i,
        prevTs: String(prev.ts || ''),
        ts: String(cur.ts || ''),
        prevId: String(prev.id || ''),
        id: String(cur.id || ''),
      });
    }
  }

  // Tool call matching.
  const toolBefore = new Set<string>();
  const toolAfter = new Set<string>();
  for (const e of parsed) {
    if (e.kind === 'tool.before') {
      const id = getCallId(e);
      if (id) toolBefore.add(id);
    }
    if (e.kind === 'tool.after') {
      const id = getCallId(e);
      if (id) toolAfter.add(id);
    }
  }
  const beforeMissingAfter = [...toolBefore].filter((id) => !toolAfter.has(id));
  const afterMissingBefore = [...toolAfter].filter((id) => !toolBefore.has(id));

  // Normalized ordering by timestamp.
  const normalized = [...parsed].sort(compareEvents);

  if (outPath) {
    const dir = path.dirname(outPath);
    if (!dirExists(dir)) fs.mkdirSync(dir, { recursive: true });
    const outLines = normalized.map((e, idx) => {
      const rec = { ...e, seq: idx + 1, origIndex: parsed.indexOf(e) };
      return `${JSON.stringify(rec)}\n`;
    });
    fs.writeFileSync(outPath, outLines.join(''), 'utf-8');
  }

  const summary = {
    ok: true,
    sessionId,
    yearMonth,
    rawPath,
    count: parsed.length,
    inversions: { count: inversions.length, sample: inversions.slice(0, maxN) },
    tools: {
      before: toolBefore.size,
      after: toolAfter.size,
      beforeMissingAfter: beforeMissingAfter.slice(0, maxN),
      afterMissingBefore: afterMissingBefore.slice(0, maxN),
      counts: {
        beforeMissingAfter: beforeMissingAfter.length,
        afterMissingBefore: afterMissingBefore.length,
      },
    },
    ...(outPath ? { normalizedOut: outPath } : {}),
  };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Session:  ${sessionId}`);
  console.log(`Month:    ${yearMonth}`);
  console.log(`RAW file: ${rawPath}`);
  if (outPath) console.log(`Out:      ${outPath}`);
  console.log('');
  console.log(`Events: ${parsed.length}`);
  console.log(`Timestamp inversions (file order): ${inversions.length}`);
  if (inversions.length) {
    console.log(`  Sample (first ${Math.min(maxN, inversions.length)}):`);
    for (const inv of inversions.slice(0, maxN)) {
      console.log(`  - #${inv.index}: ${inv.prevTs} (${inv.prevId}) -> ${inv.ts} (${inv.id})`);
    }
  }
  console.log('');
  console.log(`Tool.before callIds: ${toolBefore.size}`);
  console.log(`Tool.after  callIds: ${toolAfter.size}`);
  if (beforeMissingAfter.length || afterMissingBefore.length) {
    console.log(`Unmatched tool.before: ${beforeMissingAfter.length}`);
    console.log(`Unmatched tool.after : ${afterMissingBefore.length}`);
    if (beforeMissingAfter.length) {
      console.log(`  before-missing-after sample: ${beforeMissingAfter.slice(0, maxN).join(', ')}`);
    }
    if (afterMissingBefore.length) {
      console.log(`  after-missing-before sample: ${afterMissingBefore.slice(0, maxN).join(', ')}`);
    }
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(2);
  });
}
