import * as path from "node:path";

import { readJsonlObjects } from "./citations_validate_lib";
import {
  getManifestArtifacts,
  getStringProp,
  hasHeading,
} from "./utils";

export function resolveRunRootFromManifest(manifestPath: string, manifest: Record<string, unknown>): string {
  const artifacts = getManifestArtifacts(manifest);
  const root = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "").trim();
  if (root && path.isAbsolute(root)) return root;
  return path.dirname(manifestPath);
}

export function resolveArtifactPath(argsPath: string | undefined, runRoot: string, manifestRel: string | undefined, fallbackRel: string): string {
  const provided = (argsPath ?? "").trim();
  if (provided) return provided;
  const rel = (manifestRel ?? "").trim() || fallbackRel;
  return path.join(runRoot, rel);
}

export function extractCitationMentions(markdown: string): string[] {
  const out = new Set<string>();
  const regex = /\[@([A-Za-z0-9_:-]+)\]/g;
  let match: RegExpExecArray | null = regex.exec(markdown);
  while (match !== null) {
    const cid = (match[1] ?? "").trim();
    if (cid) out.add(cid);
    match = regex.exec(markdown);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function hasRawHttpUrl(markdown: string): boolean {
  return /https?:\/\//i.test(markdown);
}

export function formatRate(value: number): number {
  return Number(value.toFixed(6));
}

export async function readValidatedCids(citationsPath: string): Promise<Set<string>> {
  const records = await readJsonlObjects(citationsPath);
  const out = new Set<string>();
  for (const record of records) {
    const cid = String(record.cid ?? "").trim();
    const status = String(record.status ?? "").trim();
    if (!cid) continue;
    if (status === "valid" || status === "paywalled") out.add(cid);
  }
  return out;
}

export function requiredSynthesisHeadingsV1(): string[] {
  return ["Summary", "Key Findings", "Evidence", "Caveats"];
}

export function countUncitedNumericClaims(markdown: string): number {
  const lines = markdown.split(/\r?\n/);
  const numericRegex = /\b\d+(?:\.\d+)?%?\b/;
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (!numericRegex.test(line)) continue;
    if (/\[@[A-Za-z0-9_:-]+\]/.test(line)) continue;
    const nextLine = (lines[i + 1] ?? "").trim();
    if (!/\[@[A-Za-z0-9_:-]+\]/.test(nextLine)) count += 1;
  }
  return count;
}

export { hasHeading };
