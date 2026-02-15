import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  atomicWriteText,
  canonicalizeJson,
  getObjectProp,
  getStringProp,
  isPlainObject,
} from "./utils";
import { parseJsonSafe } from "./wave_tools_io";

export function resolveRunRootFromManifest(manifestPath: string, manifest: Record<string, unknown>): string {
  const artifacts = getObjectProp(manifest, "artifacts");
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

export function formatRate(value: number): number {
  return Number(value.toFixed(6));
}

export function requiredSynthesisHeadingsV1(): string[] {
  return ["Summary", "Key Findings", "Evidence", "Caveats"];
}

export type NumericClaimFindingV1 = {
  line: number;
  col: number;
  token: string;
  line_text: string;
};

export function collectUncitedNumericClaimFindingsV1(markdown: string): NumericClaimFindingV1[] {
  const findings: NumericClaimFindingV1[] = [];
  const lines = markdown.split(/\r?\n/);
  const paragraph: Array<{ line: number; text: string }> = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const hasCitation = paragraph.some((entry) => /\[@([A-Za-z0-9_:-]+)\]/.test(entry.text));
    if (!hasCitation) {
      for (const entry of paragraph) {
        if (/^\s*\d+\.\s+/.test(entry.text)) continue;
        const numericRegex = /-?\d+(?:\.\d+)?%?/g;
        let match: RegExpExecArray | null = numericRegex.exec(entry.text);
        while (match) {
          const token = (match[0] ?? "").trim();
          if (token) {
            findings.push({
              line: entry.line,
              col: (match.index ?? 0) + 1,
              token,
              line_text: entry.text,
            });
          }
          match = numericRegex.exec(entry.text);
        }
      }
    }
    paragraph.length = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) continue;

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    paragraph.push({ line: index + 1, text: line });
  }

  flushParagraph();
  findings.sort((a, b) => (a.line - b.line) || (a.col - b.col));
  return findings;
}

export async function atomicWriteCanonicalJson(filePath: string, value: unknown): Promise<void> {
  const stable = canonicalizeJson(value);
  await atomicWriteText(filePath, `${JSON.stringify(stable, null, 2)}\n`);
}

export const FIXTURE_BUNDLE_SCHEMA_VERSION = "fixture_bundle.v1";
export const FIXTURE_REPLAY_REPORT_SCHEMA_VERSION = "fixture_replay.report.v1";
export const FIXTURE_REGRESSION_REPORT_SCHEMA_VERSION = "fixture_regression.report.v1";
export const GATE_E_REPORT_REL_PATHS: readonly string[] = [
  "reports/gate-e-citation-utilization.json",
  "reports/gate-e-numeric-claims.json",
  "reports/gate-e-sections-present.json",
  "reports/gate-e-status.json",
];
export const FIXTURE_BUNDLE_REQUIRED_REL_PATHS: readonly string[] = [
  "bundle.json",
  "manifest.json",
  "gates.json",
  "citations/citations.jsonl",
  "synthesis/final-synthesis.md",
  ...GATE_E_REPORT_REL_PATHS,
];

function compareLex(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortedLex(values: string[]): string[] {
  return [...values].sort(compareLex);
}

export function isSortedLex(values: string[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (compareLex(values[i - 1] ?? "", values[i] ?? "") > 0) return false;
  }
  return true;
}

function normalizeBundleRelPath(relPath: string): string {
  return relPath.split("/").filter(Boolean).join(path.sep);
}

export function bundlePath(bundleRoot: string, relPath: string): string {
  return path.join(bundleRoot, normalizeBundleRelPath(relPath));
}

export async function sha256DigestForFile(filePath: string): Promise<string> {
  const bytes = await fs.promises.readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function parseToolResult(raw: unknown):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: string; message: string; details: Record<string, unknown> } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      code: "UPSTREAM_INVALID_JSON",
      message: "upstream tool returned non-string payload",
      details: { type: typeof raw },
    };
  }

  const parsed = parseJsonSafe(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return {
      ok: false,
      code: "UPSTREAM_INVALID_JSON",
      message: "upstream tool returned invalid JSON",
      details: { raw },
    };
  }

  const value = parsed.value as Record<string, unknown>;
  if (value.ok === true) return { ok: true, value };

  const failure = isPlainObject(value.error) ? (value.error as Record<string, unknown>) : {};
  return {
    ok: false,
    code: String(failure.code ?? "UPSTREAM_FAILED"),
    message: String(failure.message ?? "upstream tool failed"),
    details: isPlainObject(failure.details) ? (failure.details as Record<string, unknown>) : {},
  };
}

export function normalizeWarningList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const entry of value) {
    const warning = String(entry ?? "").trim();
    if (!warning) continue;
    set.add(warning);
  }
  return sortedLex([...set]);
}

export function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? "") !== (b[i] ?? "")) return false;
  }
  return true;
}
