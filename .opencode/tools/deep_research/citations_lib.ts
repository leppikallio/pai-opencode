import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { ensureDir } from "../../plugins/lib/paths";

export type JsonObject = Record<string, unknown>;

export type CitationStatus = "valid" | "paywalled" | "blocked" | "mismatch" | "invalid";

export type UrlMapItemV1 = {
  url_original: string;
  normalized_url: string;
  cid: string;
};

export type OfflineFixtureEntry = {
  normalized_url?: string;
  url_original?: string;
  cid?: string;
  status?: string;
  url?: string;
  http_status?: number;
  title?: string;
  publisher?: string;
  evidence_snippet?: string;
  notes?: string;
};

export type OfflineFixtureLookup = {
  byNormalized: Map<string, OfflineFixtureEntry>;
  byOriginal: Map<string, OfflineFixtureEntry>;
  byCid: Map<string, OfflineFixtureEntry>;
  fixtureDigest: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256HexLowerUtf8(input: string): string {
  return createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex");
}

function canonicalizeJson(value: unknown): unknown {
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

function getObjectProp(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = value[key];
  return isPlainObject(v) ? v : null;
}

export function getStringProp(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === "string" ? v : null;
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

export function ok<T extends JsonObject>(data: T): string {
  return JSON.stringify({ ok: true, ...data }, null, 2);
}

export function err(code: string, message: string, details: JsonObject = {}): string {
  return JSON.stringify({ ok: false, error: { code, message, details } }, null, 2);
}

function assertEnum(value: string, allowed: string[]): boolean {
  return allowed.includes(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function errorWithPath(message: string, pathStr: string) {
  return err("SCHEMA_VALIDATION_FAILED", message, { path: pathStr });
}

const MANIFEST_STATUS: string[] = ["created", "running", "paused", "failed", "completed", "cancelled"];
const MANIFEST_MODE: string[] = ["quick", "standard", "deep"];
const MANIFEST_STAGE: string[] = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];

export function validateManifestV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("manifest must be an object", "$");
  const v = value;

  if (v.schema_version !== "manifest.v1") return errorWithPath("manifest.schema_version must be manifest.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("manifest.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("manifest.created_at missing", "$.created_at");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("manifest.updated_at missing", "$.updated_at");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("manifest.revision invalid", "$.revision");

  if (!isNonEmptyString(v.mode) || !assertEnum(v.mode, MANIFEST_MODE)) return errorWithPath("manifest.mode invalid", "$.mode");
  if (!isNonEmptyString(v.status) || !assertEnum(v.status, MANIFEST_STATUS)) return errorWithPath("manifest.status invalid", "$.status");

  if (!isPlainObject(v.query)) return errorWithPath("manifest.query missing", "$.query");
  if (!isNonEmptyString(v.query.text)) return errorWithPath("manifest.query.text missing", "$.query.text");
  if (v.query.constraints !== undefined && !isPlainObject(v.query.constraints)) {
    return errorWithPath("manifest.query.constraints must be object", "$.query.constraints");
  }
  if (v.query.sensitivity !== undefined) {
    if (!isNonEmptyString(v.query.sensitivity) || !assertEnum(v.query.sensitivity, ["normal", "restricted", "no_web"])) {
      return errorWithPath("manifest.query.sensitivity invalid", "$.query.sensitivity");
    }
  }

  if (!isPlainObject(v.stage)) return errorWithPath("manifest.stage missing", "$.stage");
  if (!isNonEmptyString(v.stage.current) || !assertEnum(v.stage.current, MANIFEST_STAGE)) {
    return errorWithPath("manifest.stage.current invalid", "$.stage.current");
  }
  if (!isNonEmptyString(v.stage.started_at)) return errorWithPath("manifest.stage.started_at missing", "$.stage.started_at");
  if (!Array.isArray(v.stage.history)) return errorWithPath("manifest.stage.history must be array", "$.stage.history");
  for (let i = 0; i < v.stage.history.length; i++) {
    const h = v.stage.history[i];
    if (!isPlainObject(h)) return errorWithPath("manifest.stage.history entry must be object", `$.stage.history[${i}]`);
    if (!isNonEmptyString(h.from)) return errorWithPath("stage.history.from missing", `$.stage.history[${i}].from`);
    if (!isNonEmptyString(h.to)) return errorWithPath("stage.history.to missing", `$.stage.history[${i}].to`);
    if (!isNonEmptyString(h.ts)) return errorWithPath("stage.history.ts missing", `$.stage.history[${i}].ts`);
    if (!isNonEmptyString(h.reason)) return errorWithPath("stage.history.reason missing", `$.stage.history[${i}].reason`);
    if (!isNonEmptyString(h.inputs_digest)) return errorWithPath("stage.history.inputs_digest missing", `$.stage.history[${i}].inputs_digest`);
    if (!isInteger(h.gates_revision)) return errorWithPath("stage.history.gates_revision invalid", `$.stage.history[${i}].gates_revision`);
  }

  if (!isPlainObject(v.limits)) return errorWithPath("manifest.limits missing", "$.limits");
  const limits = v.limits as Record<string, unknown>;
  for (const key of ["max_wave1_agents", "max_wave2_agents", "max_summary_kb", "max_total_summary_kb", "max_review_iterations"]) {
    if (!isFiniteNumber(limits[key])) return errorWithPath(`manifest.limits.${key} invalid`, `$.limits.${key}`);
  }

  if (!isPlainObject(v.artifacts)) return errorWithPath("manifest.artifacts missing", "$.artifacts");
  if (!isNonEmptyString(v.artifacts.root) || !path.isAbsolute(v.artifacts.root)) {
    return errorWithPath("manifest.artifacts.root must be absolute path", "$.artifacts.root");
  }
  if (!isPlainObject(v.artifacts.paths)) return errorWithPath("manifest.artifacts.paths missing", "$.artifacts.paths");
  const artifactPaths = v.artifacts.paths as Record<string, unknown>;
  for (const k of [
    "wave1_dir",
    "wave2_dir",
    "citations_dir",
    "summaries_dir",
    "synthesis_dir",
    "logs_dir",
    "gates_file",
    "perspectives_file",
    "citations_file",
    "summary_pack_file",
    "pivot_file",
  ]) {
    if (!isNonEmptyString(artifactPaths[k])) return errorWithPath(`manifest.artifacts.paths.${k} missing`, `$.artifacts.paths.${k}`);
  }

  if (!isPlainObject(v.metrics)) return errorWithPath("manifest.metrics must be object", "$.metrics");
  if (!Array.isArray(v.failures)) return errorWithPath("manifest.failures must be array", "$.failures");

  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export async function appendAuditJsonl(args: { runRoot: string; event: Record<string, unknown> }): Promise<void> {
  const logsDir = path.join(args.runRoot, "logs");
  const auditPath = path.join(logsDir, "audit.jsonl");
  await ensureDir(logsDir);
  await fs.promises.appendFile(auditPath, `${JSON.stringify(args.event)}\n`, "utf8");
}

export async function statPath(p: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

export function isCitationStatus(value: unknown): value is CitationStatus {
  return value === "valid" || value === "paywalled" || value === "blocked" || value === "mismatch" || value === "invalid";
}

export function appendNote(current: string, next: string): string {
  const base = current.trim();
  const tail = next.trim();
  if (!base) return tail;
  if (!tail) return base;
  return `${base}; ${tail}`;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export async function listMarkdownFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFilesRecursive(abs);
      out.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(abs);
  }
  return out;
}

export function extractHttpUrlsFromLine(line: string): string[] {
  const matches = line.match(/https?:\/\/[^\s<>()\[\]"'`]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.;:!?]+$/g, "").trim();
    if (!cleaned) continue;
    try {
      const parsed = new URL(cleaned);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") continue;
      const value = parsed.toString();
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    } catch {
      // ignore non-URL tokens
    }
  }
  return out;
}

export function normalizeCitationUrl(urlOriginal: string):
  | { ok: true; normalized_url: string }
  | { ok: false; message: string; details: Record<string, unknown> } {
  try {
    const parsed = new URL(urlOriginal);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return {
        ok: false,
        message: "only http/https URLs are allowed",
        details: { protocol: parsed.protocol },
      };
    }

    const host = parsed.hostname.toLowerCase();
    let port = parsed.port;
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }

    let pathname = parsed.pathname || "/";
    if (pathname !== "/" && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    const filteredPairs = [...parsed.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        if (lower.startsWith("utm_")) return false;
        if (lower === "gclid" || lower === "fbclid") return false;
        return true;
      })
      .sort((a, b) => {
        const byKey = a[0].localeCompare(b[0]);
        if (byKey !== 0) return byKey;
        return a[1].localeCompare(b[1]);
      });

    const query = filteredPairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const authority = port ? `${host}:${port}` : host;
    const normalizedUrl = `${protocol}//${authority}${pathname}${query ? `?${query}` : ""}`;
    return { ok: true, normalized_url: normalizedUrl };
  } catch (e) {
    return {
      ok: false,
      message: "invalid absolute URL",
      details: { error: String(e) },
    };
  }
}

export function citationCid(normalizedUrl: string): string {
  return `cid_${sha256HexLowerUtf8(normalizedUrl)}`;
}
