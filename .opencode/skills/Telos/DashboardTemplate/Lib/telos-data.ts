import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type TelosFileType = 'markdown' | 'csv';

export type TelosFile = {
  filename: string;
  name: string;
  type: TelosFileType;
  content: string;
};

const PAI_DIR = process.env.PAI_DIR || path.join(os.homedir(), '.config', 'opencode');
const TELOS_DIR = path.join(PAI_DIR, 'skills', 'CORE', 'USER', 'TELOS');

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function listDirFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

function isCsv(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}

function toDisplayName(filename: string): string {
  return filename
    .replace(/^data\//, '')
    .replace(/\.(md|csv)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function resolveTelosPath(filename: string): { absPath: string; type: TelosFileType } | null {
  const normalized = filename.replace(/^\//, '');
  if (isCsv(normalized)) {
    const base = path.basename(normalized);
    return { absPath: path.join(TELOS_DIR, 'data', base), type: 'csv' };
  }
  if (isMarkdown(normalized)) {
    const base = path.basename(normalized);
    return { absPath: path.join(TELOS_DIR, base), type: 'markdown' };
  }
  return null;
}

export function getTelosFileList(): string[] {
  const out: string[] = [];

  // Markdown files in TELOS root.
  for (const f of listDirFiles(TELOS_DIR)) {
    if (!isMarkdown(f)) continue;
    out.push(f);
  }

  // CSV files under TELOS/data.
  const dataDir = path.join(TELOS_DIR, 'data');
  for (const f of listDirFiles(dataDir)) {
    if (!isCsv(f)) continue;
    out.push(`data/${f}`);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

export function getTelosFileCount(): number {
  return getTelosFileList().length;
}

export function getAllTelosData(): TelosFile[] {
  return getTelosFileList().map((filename) => {
    const resolved = resolveTelosPath(filename);
    const absPath = resolved?.absPath;
    const type = resolved?.type ?? (filename.toLowerCase().endsWith('.csv') ? 'csv' : 'markdown');
    const content = absPath ? safeReadFile(absPath) : '';
    return {
      filename,
      name: toDisplayName(filename),
      type,
      content,
    };
  });
}

export function getTelosContext(): string {
  const files = getAllTelosData();
  if (files.length === 0) {
    return `No TELOS files found at: ${TELOS_DIR}`;
  }

  const parts: string[] = [];
  parts.push(`TELOS_DIR: ${TELOS_DIR}`);
  for (const f of files) {
    parts.push(`\n---\nFILE: ${f.filename}\nTYPE: ${f.type}\n---\n`);
    parts.push(f.content || '(empty)');
  }
  return parts.join('\n');
}
