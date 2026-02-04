#!/usr/bin/env bun
/**
 * TraceRawSession.ts
 *
 * Read-only diagnostic tool for OpenCode PAI RAW session logs.
 * Helps debug hook ordering/races without enabling any risky hooks.
 *
 * Usage:
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/TraceRawSession.ts <sessionId>
 *   PAI_DIR="$HOME/.config/opencode" bun run ~/.config/opencode/skills/PAI/Tools/TraceRawSession.ts --latest
 *
 * Output:
 * - Event counts by name/kind
 * - Unmatched tool.before/tool.after callIds
 * - Tail timeline
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPaiRuntimeInfo } from '../../../pai-tools/PaiRuntime';

type RawEvent = {
  v?: string;
  id?: string;
  ts?: string;
  sessionId?: string;
  kind?: string;
  name?: string;
  payload?: Record<string, unknown>;
};

function usage(): string {
  return [
    'TraceRawSession - debug PAI RAW jsonl ordering',
    '',
    'Usage:',
    '  bun run TraceRawSession.ts <sessionId>',
    '  bun run TraceRawSession.ts --latest',
    '',
    'Options:',
    '  --tail <n>   Show last n events (default: 40)',
    '  --json       Output a JSON summary',
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
    return fs.readdirSync(p).map((n) => path.join(p, n)).filter(dirExists);
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

function fmtTs(ts: string | undefined): string {
  if (!ts) return '';
  return ts.replace('T', ' ').replace('Z', '');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const jsonOut = args.includes('--json');
  const latest = args.includes('--latest');

  const tailIdx = args.indexOf('--tail');
  const tail = tailIdx >= 0 ? Number(args[tailIdx + 1] || '40') : 40;
  const tailN = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : 40;

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
  const events = lines.map(safeJsonParse).filter(Boolean) as RawEvent[];

  const byName = new Map<string, number>();
  const byKind = new Map<string, number>();
  const toolBefore = new Map<string, RawEvent>();
  const toolAfter = new Map<string, RawEvent>();

  for (const e of events) {
    const name = e.name || '(unknown)';
    const kind = e.kind || '(unknown)';
    byName.set(name, (byName.get(name) || 0) + 1);
    byKind.set(kind, (byKind.get(kind) || 0) + 1);

    if (kind === 'tool.before') {
      const callId = (e.payload && typeof e.payload.callId === 'string' ? e.payload.callId : '') as string;
      if (callId) toolBefore.set(callId, e);
    }
    if (kind === 'tool.after') {
      const callId = (e.payload && typeof e.payload.callId === 'string' ? e.payload.callId : '') as string;
      if (callId) toolAfter.set(callId, e);
    }
  }

  const unmatchedBefore = [...toolBefore.keys()].filter((id) => !toolAfter.has(id));
  const unmatchedAfter = [...toolAfter.keys()].filter((id) => !toolBefore.has(id));

  const tailEvents = events.slice(-tailN);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId,
          yearMonth,
          rawPath,
          counts: {
            byKind: Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])),
            byName: Object.fromEntries([...byName.entries()].sort((a, b) => b[1] - a[1])),
          },
          tools: {
            unmatchedBefore,
            unmatchedAfter,
          },
          tail: tailEvents,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`PAI_DIR:  ${runtime.paiDir}`);
  console.log(`Session:  ${sessionId}`);
  console.log(`Month:    ${yearMonth}`);
  console.log(`RAW file: ${rawPath}`);
  console.log('');

  console.log('Counts by kind:');
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${k}: ${n}`);
  }
  console.log('');
  console.log('Counts by name (top 12):');
  for (const [k, n] of [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  - ${k}: ${n}`);
  }
  console.log('');

  if (unmatchedBefore.length || unmatchedAfter.length) {
    console.log('Tool call mismatches:');
    if (unmatchedBefore.length) console.log(`  - tool.before without after: ${unmatchedBefore.length}`);
    if (unmatchedAfter.length) console.log(`  - tool.after without before: ${unmatchedAfter.length}`);
    console.log('');
  }

  console.log(`Tail (${tailEvents.length}):`);
  for (const e of tailEvents) {
    const id = e.id || '';
    const name = e.name || '';
    const kind = e.kind || '';
    console.log(`  ${fmtTs(e.ts)} | ${kind.padEnd(12)} | ${name.padEnd(18)} | ${id}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(2);
  });
}
