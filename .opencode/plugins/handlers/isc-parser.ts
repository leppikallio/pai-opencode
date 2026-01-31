/**
 * ISC Parser
 *
 * Extracts Ideal + ISC criteria + anti-criteria from assistant responses.
 * Uses tolerant parsing of table rows and falls back to tracker section.
 */

import { createHash } from "node:crypto";

export interface ParsedCriterion {
  id: string;
  text: string;
  status: string;
  evidenceRefs?: string[];
}

export interface ParsedIsc {
  ideal?: string;
  criteria: ParsedCriterion[];
  antiCriteria: ParsedCriterion[];
  attempted: boolean;
  warnings: string[];
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function normalizeCell(value: string): string {
  return value.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function parseRow(line: string): string[] | null {
  const normalized = line.replace(/│/g, "|");
  if (!normalized.includes("|")) return null;
  const parts = normalized
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 3) return null;
  return parts.map(normalizeCell);
}

export function parseIscResponse(text: string): ParsedIsc {
  const lines = text.split(/\r?\n/);
  let section: "tracker" | "final" | "" = "";

  const trackerCriteria: ParsedCriterion[] = [];
  const finalCriteria: ParsedCriterion[] = [];
  const trackerAnti: ParsedCriterion[] = [];
  const finalAnti: ParsedCriterion[] = [];

  let ideal: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!ideal) {
      const match = trimmed.match(/IDEAL:\s*(.+)$/i);
      if (match) ideal = normalizeCell(match[1]);
    }

    if (/ISC TRACKER/i.test(trimmed)) {
      section = "tracker";
      // anti-criteria handled via table parsing
      continue;
    }
    if (/FINAL ISC STATE/i.test(trimmed)) {
      section = "final";
      // anti-criteria handled via table parsing
      continue;
    }
    if (/ANTI-CRITERIA/i.test(trimmed)) {
      // anti-criteria handled via table parsing
      continue;
    }

    const parts = parseRow(line);
    if (!parts) continue;

    const first = parts[0];
    if (first === "#" || first.toLowerCase() === "criterion") continue;
    if (first === "!") {
      const textCell = parts[1] ?? "";
      if (!textCell) continue;
      const criterion: ParsedCriterion = {
        id: hashText(textCell),
        text: textCell,
        status: "WATCHING",
      };
      if (section === "final") finalAnti.push(criterion);
      else trackerAnti.push(criterion);
      continue;
    }

    if (!/^[0-9]+$/.test(first)) continue;
    const textCell = parts[1] ?? "";
    const statusCell = parts[2] ?? "";
    const evidenceCell = parts[3];
    if (!textCell) continue;
    const criterion: ParsedCriterion = {
      id: hashText(textCell),
      text: textCell,
      status: statusCell,
      evidenceRefs: evidenceCell ? [evidenceCell] : undefined,
    };

    if (section === "final") finalCriteria.push(criterion);
    else trackerCriteria.push(criterion);
  }

  const criteria = finalCriteria.length > 0 ? finalCriteria : trackerCriteria;
  const antiCriteria = finalAnti.length > 0 ? finalAnti : trackerAnti;

  const attempted = /ISC TRACKER|FINAL ISC STATE|\bOBSERVE\b/i.test(text);
  const warnings: string[] = [];
  if (attempted && criteria.length === 0) {
    warnings.push("Algorithm format detected but no ISC criteria parsed");
  }

  return { ideal, criteria, antiCriteria, attempted, warnings };
}
