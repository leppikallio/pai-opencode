import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import type { JsonObject } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256HexLowerUtf8(input: string): string {
  return createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex");
}

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    out[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function sha256DigestForJson(value: unknown): string {
  const stable = JSON.stringify(canonicalizeJson(value));
  return `sha256:${sha256HexLowerUtf8(stable)}`;
}

export function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

export function parseIntSafe(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

export function parseAbsolutePathSetting(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;
  const expanded = raw === "~"
    ? os.homedir()
    : raw.startsWith("~/")
      ? path.join(os.homedir(), raw.slice(2))
      : raw;
  if (!path.isAbsolute(expanded)) return null;
  return path.normalize(expanded);
}

export function stableRunId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `dr_${ts}_${rnd}`;
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, filePath);
}

export async function atomicWriteText(filePath: string, value: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, value, "utf8");
  await fs.promises.rename(tmp, filePath);
}

export async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

// RFC 7396 JSON Merge Patch
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null) return undefined; // caller removes
  if (typeof patch !== "object" || patch === null) return patch;
  if (Array.isArray(patch)) return patch;

  const pObj = patch as Record<string, unknown>;
  const tObj = (typeof target === "object" && target !== null && !Array.isArray(target))
    ? (target as Record<string, unknown>)
    : {};

  const out: Record<string, unknown> = { ...tObj };
  for (const [k, v] of Object.entries(pObj)) {
    if (v === null) {
      delete out[k];
      continue;
    }
    const prev = out[k];
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = mergePatch(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function ok<T extends JsonObject>(data: T): string {
  return JSON.stringify({ ok: true, ...data }, null, 2);
}

export function err(code: string, message: string, details: JsonObject = {}): string {
  return JSON.stringify({ ok: false, error: { code, message, details } }, null, 2);
}

export function assertEnum(value: string, allowed: string[]): boolean {
  return allowed.includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

export function errorWithPath(message: string, pathStr: string) {
  return err("SCHEMA_VALIDATION_FAILED", message, { path: pathStr });
}

export function getObjectProp(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = value[key];
  return isPlainObject(v) ? v : null;
}

export function getStringProp(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === "string" ? v : null;
}

export function getNumberProp(value: Record<string, unknown>, key: string): number | null {
  const v = value[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function errorCode(e: unknown): string | null {
  if (!isPlainObject(e)) return null;
  const code = e.code;
  return typeof code === "string" ? code : null;
}

export function getManifestArtifacts(manifest: Record<string, unknown>): Record<string, unknown> | null {
  return getObjectProp(manifest, "artifacts");
}

export function getManifestPaths(manifest: Record<string, unknown>): Record<string, unknown> {
  const artifacts = getManifestArtifacts(manifest);
  const paths = artifacts ? getObjectProp(artifacts, "paths") : null;
  return paths ?? {};
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasHeading(markdown: string, heading: string): boolean {
  const headingRegex = new RegExp(`^\\s{0,3}#{1,6}\\s+${escapeRegex(heading)}\\s*(?:#+\\s*)?$`, "m");
  return headingRegex.test(markdown);
}

export function findHeadingSection(markdown: string, heading: string): string | null {
  const headingRegex = new RegExp(`^\\s{0,3}#{1,6}\\s+${escapeRegex(heading)}\\s*(?:#+\\s*)?$`, "m");
  const startMatch = headingRegex.exec(markdown);
  if (!startMatch || startMatch.index === undefined) return null;

  const sectionStart = startMatch.index + startMatch[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeading = /^\s{0,3}#{1,6}\s+/m.exec(rest);
  const sectionEnd = nextHeading ? sectionStart + (nextHeading.index ?? 0) : markdown.length;
  return markdown.slice(sectionStart, sectionEnd);
}

export function countWords(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function parseSourcesSection(sectionBody: string):
  | { ok: true; count: number }
  | { ok: false; reason: "NOT_BULLET" | "MISSING_URL"; line: string } {
  const lines = sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let count = 0;
  for (const line of lines) {
    if (!/^([-*+]\s+|\d+\.\s+)/.test(line)) {
      return { ok: false, reason: "NOT_BULLET", line };
    }
    if (!/https?:\/\//.test(line)) {
      return { ok: false, reason: "MISSING_URL", line };
    }
    count += 1;
  }

  return { ok: true, count };
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedup = new Set<string>();
  for (const entry of value) {
    const tag = normalizeWhitespace(String(entry ?? ""));
    if (!tag) continue;
    dedup.add(tag);
  }
  return [...dedup].sort((a, b) => a.localeCompare(b));
}

export function normalizeOutputPathForPivotArtifact(runRoot: string, outputPath: string): string {
  const trimmed = outputPath.trim();
  if (!trimmed) return trimmed;
  if (!path.isAbsolute(trimmed)) return trimmed;
  const rel = path.relative(runRoot, trimmed);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return trimmed;
  return rel.split(path.sep).join("/");
}

export function resolveRunPath(runRoot: string, maybeAbsoluteOrRelative: string): string {
  const trimmed = maybeAbsoluteOrRelative.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.join(runRoot, trimmed);
}

export function truncateMessage(value: string, max = 200): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function toFailureShape(value: unknown): { code: string; message: string; details: Record<string, unknown> } {
  const v = isPlainObject(value) ? value : {};
  const code = typeof v.code === "string" && v.code.trim().length > 0 ? v.code : "VALIDATION_FAILED";
  const message = typeof v.message === "string" && v.message.trim().length > 0 ? v.message : "validation failed";
  const details = isPlainObject(v.details) ? v.details : {};
  return { code, message, details };
}

export function listPatchPaths(value: unknown, prefix: string): string[] {
  if (!isPlainObject(value)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const next = `${prefix}.${k}`;
    if (isPlainObject(v)) out.push(...listPatchPaths(v, next));
    else out.push(next);
  }
  return out;
}

export function containsImmutableManifestPatch(patch: Record<string, unknown>): string[] {
  const paths = listPatchPaths(patch, "$");
  const bad: string[] = [];
  for (const p of paths) {
    if (
      p === "$.schema_version" ||
      p === "$.run_id" ||
      p === "$.created_at" ||
      p === "$.updated_at" ||
      p === "$.revision" ||
      p.startsWith("$.artifacts")
    ) {
      bad.push(p);
    }
  }
  return bad;
}
