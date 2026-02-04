/**
 * Prompt Sources
 *
 * Build the canonical system prompt sources from:
 * - opencode.json `instructions[]` (filesystem paths)
 * - nested AGENTS.md stack
 *
 * Missing files are ignored (never crash).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null;
}

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function safeReadFile(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    if (!fs.statSync(p).isFile()) return null;
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function safeReadJson(p: string): UnknownRecord | null {
  try {
    const raw = safeReadFile(p);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getInstructionPathsFromConfig(cfg: UnknownRecord | null): string[] {
  const ins = cfg ? (cfg.instructions as unknown) : undefined;
  if (!Array.isArray(ins)) return [];
  const out: string[] = [];

  for (const item of ins) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (isRecord(item)) {
      const p = item.path;
      if (typeof p === "string" && p.trim()) {
        out.push(p.trim());
      }
    }
  }
  return out;
}

export function loadConfiguredInstructions(opencodeConfigPath: string): {
  sources: Array<{ path: string; content: string }>;
  missing: string[];
} {
  const cfg = safeReadJson(opencodeConfigPath);
  const paths = getInstructionPathsFromConfig(cfg);
  const sources: Array<{ path: string; content: string }> = [];
  const missing: string[] = [];

  for (const raw of paths) {
    const expanded = expandTilde(raw.trim());
    const content = safeReadFile(expanded);
    if (!content) {
      missing.push(raw);
      continue;
    }
    sources.push({ path: expanded, content: content.trim() });
  }

  return { sources, missing };
}

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isGitRoot(p: string): boolean {
  try {
    const gitPath = path.join(p, ".git");
    if (!fs.existsSync(gitPath)) return false;
    const st = fs.statSync(gitPath);
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

export function findAnchorDir(startDir: string): string {
  // Prefer git root; fallback to filesystem root.
  let cur = path.resolve(startDir);
  if (!dirExists(cur)) cur = process.cwd();

  let last = "";
  while (cur && cur !== last) {
    if (isGitRoot(cur)) return cur;
    last = cur;
    cur = path.dirname(cur);
  }
  // Filesystem root.
  return last || path.parse(process.cwd()).root;
}

export function loadAgentsStack(opts: {
  paiDir: string;
  projectDir: string;
}): {
  sources: Array<{ path: string; content: string }>;
} {
  const seen = new Set<string>();
  const sources: Array<{ path: string; content: string }> = [];

  // Global AGENTS.md (if present)
  const globalAgents = path.join(opts.paiDir, "AGENTS.md");
  const globalText = safeReadFile(globalAgents);
  if (globalText) {
    seen.add(globalAgents);
    sources.push({ path: globalAgents, content: globalText.trim() });
  }

  const anchor = findAnchorDir(opts.projectDir);
  const target = path.resolve(opts.projectDir);

  // Collect directory chain from anchor -> target
  const dirs: string[] = [];
  let cur = target;
  let last = "";
  while (cur && cur !== last) {
    dirs.push(cur);
    if (cur === anchor) break;
    last = cur;
    cur = path.dirname(cur);
  }
  dirs.reverse();

  for (const d of dirs) {
    const agentsPath = path.join(d, "AGENTS.md");
    if (seen.has(agentsPath)) continue;
    const text = safeReadFile(agentsPath);
    if (!text) continue;
    seen.add(agentsPath);
    sources.push({ path: agentsPath, content: text.trim() });
  }

  return { sources };
}
