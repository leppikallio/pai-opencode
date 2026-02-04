#!/usr/bin/env bun
/**
 * VerifyMemoryWiring.ts
 *
 * Read-only verification that OpenCode PAI session artifacts are being written.
 *
 * Usage:
 *   bun run ~/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts <sessionId>
 *   bun run ~/.config/opencode/skills/PAI/Tools/VerifyMemoryWiring.ts --latest
 *
 * Notes:
 * - Uses $PAI_DIR when set (recommended for checking runtime vs source tree).
 * - Required: MEMORY/RAW/<YYYY-MM>/<sessionId>.jsonl and MEMORY/WORK/<YYYY-MM>/<sessionId>/THREAD.md + ISC.json + META.yaml
 * - Optional: LEARNING artifacts are typically written on session.finalize (session.deleted).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPaiRuntimeInfo } from '../../../pai-tools/PaiRuntime';

type Check = {
  label: string;
  ok: boolean;
  path: string;
  required: boolean;
  detail?: string;
};

function usage(): string {
  return [
    'VerifyMemoryWiring - checks OpenCode PAI memory artifacts',
    '',
    'Usage:',
    '  bun run VerifyMemoryWiring.ts <sessionId>',
    '  bun run VerifyMemoryWiring.ts --latest',
    '',
    'Options:',
    '  --latest   Use most recently modified RAW session file',
    '  --json     Output JSON instead of text',
    '',
    'Tips:',
    '  - To check installed runtime, set: PAI_DIR="$HOME/.config/opencode"',
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
    return fs
      .readdirSync(p)
      .map((n) => path.join(p, n))
      .filter((pp) => dirExists(pp));
  } catch {
    return [];
  }
}

function findSessionRaw(memoryDir: string, sessionId: string): { yearMonth: string; rawPath: string } | null {
  const rawRoot = path.join(memoryDir, 'RAW');
  const months = listDirs(rawRoot);
  for (const monthDir of months) {
    const yearMonth = path.basename(monthDir);
    const candidate = path.join(monthDir, `${sessionId}.jsonl`);
    if (fileExists(candidate)) return { yearMonth, rawPath: candidate };
  }
  return null;
}

function findLatestSessionRaw(memoryDir: string): { sessionId: string; yearMonth: string; rawPath: string } | null {
  const rawRoot = path.join(memoryDir, 'RAW');
  const months = listDirs(rawRoot);
  let best: { sessionId: string; yearMonth: string; rawPath: string; mtimeMs: number } | null = null;

  for (const monthDir of months) {
    const yearMonth = path.basename(monthDir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(monthDir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!name.startsWith('ses_') || !name.endsWith('.jsonl')) continue;
      const rawPath = path.join(monthDir, name);
      try {
        const stat = fs.statSync(rawPath);
        const mtimeMs = stat.mtimeMs;
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

function makeChecks(runtime: ReturnType<typeof getPaiRuntimeInfo>, sessionId: string, yearMonth: string, rawPath: string): Check[] {
  const checks: Check[] = [];
  const workDir = path.join(runtime.memoryDir, 'WORK', yearMonth, sessionId);
  const securityPath = path.join(runtime.memoryDir, 'SECURITY', yearMonth, `${sessionId}.jsonl`);

  checks.push({ label: 'RAW jsonl', ok: fileExists(rawPath), path: rawPath, required: true });
  checks.push({ label: 'WORK dir', ok: dirExists(workDir), path: workDir, required: true });
  checks.push({ label: 'THREAD.md', ok: fileExists(path.join(workDir, 'THREAD.md')), path: path.join(workDir, 'THREAD.md'), required: true });
  checks.push({ label: 'ISC.json', ok: fileExists(path.join(workDir, 'ISC.json')), path: path.join(workDir, 'ISC.json'), required: true });
  checks.push({ label: 'META.yaml', ok: fileExists(path.join(workDir, 'META.yaml')), path: path.join(workDir, 'META.yaml'), required: true });
  checks.push({ label: 'SECURITY jsonl', ok: fileExists(securityPath), path: securityPath, required: false, detail: 'Only written when security hooks log events.' });

  const learningDir = path.join(runtime.memoryDir, 'LEARNING');
  checks.push({
    label: 'LEARNING dir',
    ok: dirExists(learningDir),
    path: learningDir,
    required: false,
    detail: 'Learnings are usually persisted on session.finalize (session.deleted).',
  });

  return checks;
}

function summarize(checks: Check[]): { ok: boolean; missingRequired: Check[] } {
  const missingRequired = checks.filter((c) => c.required && !c.ok);
  return { ok: missingRequired.length === 0, missingRequired };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const jsonOut = args.includes('--json');
  const latest = args.includes('--latest');
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

  const checks = makeChecks(runtime, sessionId, yearMonth, rawPath);
  const result = summarize(checks);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          sessionId,
          yearMonth,
          paiDir: runtime.paiDir,
          memoryDir: runtime.memoryDir,
          checks,
        },
        null,
        2
      )
    );
  } else {
    console.log(`PAI_DIR: ${runtime.paiDir}`);
    console.log(`Session: ${sessionId}`);
    console.log(`Month:   ${yearMonth}`);
    console.log('');
    for (const c of checks) {
      const tag = c.ok ? '✅' : c.required ? '❌' : '⚠️';
      console.log(`${tag} ${c.label}${c.required ? '' : ' (optional)'}: ${c.path}`);
      if (c.detail) console.log(`   ↳ ${c.detail}`);
    }
    console.log('');
    console.log(result.ok ? 'OK: required artifacts present.' : 'FAIL: missing required artifacts.');
  }

  process.exit(result.ok ? 0 : 2);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(2);
  });
}
