import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { ensureDir } from "../../plugins/lib/paths";

export type JsonObject = Record<string, unknown>;

export type ToolWithExecute = {
  execute: (...args: unknown[]) => unknown | Promise<unknown>;
};

const MANIFEST_STATUS: string[] = ["created", "running", "paused", "failed", "completed", "cancelled"];
const MANIFEST_MODE: string[] = ["quick", "standard", "deep"];
const MANIFEST_STAGE: string[] = ["init", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];
const GAP_PRIORITY_VALUES = ["P0", "P1", "P2", "P3"] as const;
type GapPriority = typeof GAP_PRIORITY_VALUES[number];
type PivotGap = {
  gap_id: string;
  priority: GapPriority;
  text: string;
  tags: string[];
  source: "explicit" | "parsed_wave1";
  from_perspective_id?: string;
};
const GAP_PRIORITY_RANK: Record<GapPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function errorWithPath(message: string, pathStr: string) {
  return err("SCHEMA_VALIDATION_FAILED", message, { path: pathStr });
}

export function errorCode(e: unknown): string | null {
  if (!isPlainObject(e)) return null;
  const code = e.code;
  return typeof code === "string" ? code : null;
}

function getObjectProp(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = value[key];
  return isPlainObject(v) ? v : null;
}

export function getStringProp(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === "string" ? v : null;
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

export async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function appendAuditJsonl(args: { runRoot: string; event: Record<string, unknown> }): Promise<void> {
  const logsDir = path.join(args.runRoot, "logs");
  const auditPath = path.join(logsDir, "audit.jsonl");
  await ensureDir(logsDir);
  await fs.promises.appendFile(auditPath, `${JSON.stringify(args.event)}\n`, "utf8");
}

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

export function validatePerspectivesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("perspectives must be an object", "$");
  const v = value;

  if (v.schema_version !== "perspectives.v1") {
    return errorWithPath("perspectives.schema_version must be perspectives.v1", "$.schema_version");
  }
  if (!isNonEmptyString(v.run_id)) return errorWithPath("perspectives.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("perspectives.created_at missing", "$.created_at");
  if (!Array.isArray(v.perspectives)) return errorWithPath("perspectives.perspectives must be array", "$.perspectives");

  const allowedTracks = ["standard", "independent", "contrarian"];

  for (let i = 0; i < v.perspectives.length; i++) {
    const p = v.perspectives[i];
    if (!isPlainObject(p)) return errorWithPath("perspective must be object", `$.perspectives[${i}]`);
    if (!isNonEmptyString(p.id)) return errorWithPath("perspective.id missing", `$.perspectives[${i}].id`);
    if (!isNonEmptyString(p.title)) return errorWithPath("perspective.title missing", `$.perspectives[${i}].title`);
    if (!isNonEmptyString(p.track) || !assertEnum(p.track, allowedTracks)) {
      return errorWithPath("perspective.track invalid", `$.perspectives[${i}].track`);
    }
    if (!isNonEmptyString(p.agent_type)) {
      return errorWithPath("perspective.agent_type missing", `$.perspectives[${i}].agent_type`);
    }

    if (!isPlainObject(p.prompt_contract)) {
      return errorWithPath("perspective.prompt_contract must be object", `$.perspectives[${i}].prompt_contract`);
    }

    const c = p.prompt_contract;
    if (!isFiniteNumber(c.max_words)) {
      return errorWithPath("prompt_contract.max_words invalid", `$.perspectives[${i}].prompt_contract.max_words`);
    }
    if (!isFiniteNumber(c.max_sources)) {
      return errorWithPath("prompt_contract.max_sources invalid", `$.perspectives[${i}].prompt_contract.max_sources`);
    }
    if (!isPlainObject(c.tool_budget)) {
      return errorWithPath("prompt_contract.tool_budget must be object", `$.perspectives[${i}].prompt_contract.tool_budget`);
    }
    if (!Array.isArray(c.must_include_sections)) {
      return errorWithPath("prompt_contract.must_include_sections must be array", `$.perspectives[${i}].prompt_contract.must_include_sections`);
    }
    for (let j = 0; j < c.must_include_sections.length; j++) {
      if (!isNonEmptyString(c.must_include_sections[j])) {
        return errorWithPath(
          "prompt_contract.must_include_sections entries must be non-empty strings",
          `$.perspectives[${i}].prompt_contract.must_include_sections[${j}]`,
        );
      }
    }
  }

  return null;
}

function escapeRegex(value: string): string {
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

export function normalizeGapPriority(value: unknown): GapPriority | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return (GAP_PRIORITY_VALUES as readonly string[]).includes(v) ? (v as GapPriority) : null;
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

export function compareGapPriority(a: GapPriority, b: GapPriority): number {
  return GAP_PRIORITY_RANK[a] - GAP_PRIORITY_RANK[b];
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

export function extractPivotGapsFromMarkdown(markdown: string, perspectiveId: string):
  | { ok: true; gaps: PivotGap[] }
  | { ok: false; code: string; message: string; details: JsonObject } {
  const section = findHeadingSection(markdown, "Gaps");
  if (section === null) {
    return {
      ok: false,
      code: "GAPS_SECTION_NOT_FOUND",
      message: "Gaps heading not found",
      details: { perspective_id: perspectiveId },
    };
  }

  const gaps: PivotGap[] = [];
  let index = 0;
  const lines = section.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("-")) continue;

    const match = /^-\s+\((P[0-3])\)\s+(.+)$/.exec(line);
    if (!match) {
      return {
        ok: false,
        code: "GAPS_PARSE_FAILED",
        message: "Malformed gap bullet under Gaps section",
        details: {
          perspective_id: perspectiveId,
          line,
        },
      };
    }

    index += 1;
    const priority = match[1] as GapPriority;
    const text = normalizeWhitespace(match[2] ?? "");
    const tags = [...new Set((text.match(/#[a-z0-9_-]+/g) ?? []).map((tag) => tag.slice(1)))].sort((a, b) => a.localeCompare(b));
    gaps.push({
      gap_id: `gap_${perspectiveId}_${index}`,
      priority,
      text,
      tags,
      from_perspective_id: perspectiveId,
      source: "parsed_wave1",
    });
  }

  return { ok: true, gaps };
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

export function buildRetryChangeNote(failure: { code: string; details: Record<string, unknown> }): string {
  switch (failure.code) {
    case "MISSING_REQUIRED_SECTION": {
      const section = typeof failure.details.section === "string" && failure.details.section.trim().length > 0
        ? failure.details.section.trim()
        : "required section";
      return truncateMessage(`Add missing required section '${section}' and ensure Sources uses bullet URL entries.`);
    }
    case "TOO_MANY_WORDS": {
      return truncateMessage("Reduce content length to satisfy max_words while keeping required sections.");
    }
    case "TOO_MANY_SOURCES": {
      return truncateMessage("Reduce Sources entries to max_sources and keep only bullet URL items.");
    }
    case "MALFORMED_SOURCES": {
      return truncateMessage("Fix Sources so each entry is a bullet and contains an absolute URL.");
    }
    default: {
      return truncateMessage("Address validation error and regenerate output to satisfy the prompt contract.");
    }
  }
}

export async function collectWaveReviewMetrics(args: {
  markdownPath: string;
  requiredSections: string[];
}): Promise<{ words: number; sources: number; missing_sections: string[] }> {
  const markdown = await fs.promises.readFile(args.markdownPath, "utf8");
  const missingSections = args.requiredSections.filter((section) => !hasHeading(markdown, section));

  let sources = 0;
  const sourceHeading = args.requiredSections.find((section) => section.toLowerCase() === "sources");
  if (sourceHeading) {
    const sourcesSection = findHeadingSection(markdown, sourceHeading);
    if (sourcesSection !== null) {
      const parsedSources = parseSourcesSection(sourcesSection);
      if (parsedSources.ok) sources = parsedSources.count;
    }
  }

  return {
    words: countWords(markdown),
    sources,
    missing_sections: missingSections,
  };
}

export function buildWave1PromptMd(args: {
  queryText: string;
  perspectiveId: string;
  title: string;
  track: string;
  agentType: string;
  maxWords: number;
  maxSources: number;
  mustIncludeSections: string[];
}): string {
  return [
    "# Wave 1 Perspective Plan",
    "",
    `- Perspective ID: ${args.perspectiveId}`,
    `- Title: ${args.title}`,
    `- Track: ${args.track}`,
    `- Agent Type: ${args.agentType}`,
    "",
    "## Query",
    args.queryText,
    "",
    "## Prompt Contract",
    `- Max words: ${args.maxWords}`,
    `- Max sources: ${args.maxSources}`,
    `- Required sections: ${args.mustIncludeSections.join(", ")}`,
    "",
    "Produce markdown that satisfies the prompt contract exactly.",
  ].join("\n");
}
