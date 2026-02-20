/**
 * Superpowers bootstrap injection (PAI adapter)
 *
 * Loads the local `skills/superpowers/SKILL.md` body and injects it into the
 * system prompt for primary sessions.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileLogError } from "../lib/file-logger";
import { getPaiDir } from "../lib/pai-runtime";

export const SUPERPOWERS_BOOTSTRAP_MARKER = "PAI SUPERPOWERS BOOTSTRAP (Auto-loaded by PAI-OpenCode Plugin)";

function stripFrontmatter(raw: string): string {
  // Allow a small number of leading HTML comments (generated headers).
  let s = raw;
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^\s*<!--[\s\S]*?-->\s*/m, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/^\s+/, "");

  if (!s.startsWith("---\n")) return raw;
  const idx = s.indexOf("\n---\n", 4);
  if (idx === -1) return raw;
  return s.slice(idx + "\n---\n".length);
}

export function loadSuperpowersBootstrap(): string | null {
  try {
    const paiDir = getPaiDir();
    const skillPath = join(paiDir, "skills", "superpowers", "SKILL.md");
    if (!existsSync(skillPath)) return null;
    const raw = readFileSync(skillPath, "utf-8");
    const body = stripFrontmatter(raw).trim();
    if (!body) return null;

    return `<system-reminder>\n${SUPERPOWERS_BOOTSTRAP_MARKER}\n\n${body}\n</system-reminder>`;
  } catch (error) {
    fileLogError("Superpowers bootstrap load failed", error);
    return null;
  }
}
