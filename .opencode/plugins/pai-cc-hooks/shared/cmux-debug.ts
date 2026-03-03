import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getPaiDir } from "../../lib/pai-runtime";

const CMUX_DEBUG_ENV = "PAI_CMUX_DEBUG";
const CMUX_LAST_ERROR_FILE = "cmux-last-error.json";
const STDIO_MAX_BYTES = 2_048;
const ARG_MAX_CHARS = 256;
const WRITE_THROTTLE_MS = 2_000;

type CmuxDebugKind =
  | "route_none"
  | "nonzero_exit"
  | "timeout"
  | "not_found"
  | "spawn_error";

type CmuxDebugBreadcrumbV1 = {
  version: 1;
  kind: CmuxDebugKind;
  happenedAtMs: number;
  fingerprint: string;
  argv: string[];
  message?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  route?: "none";
  reason?: string;
  sessionId?: string;
};

export type WriteCmuxLastErrorArgs = {
  kind: "nonzero_exit" | "timeout" | "not_found" | "spawn_error";
  argv: string[];
  message?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
};

export type WriteCmuxRouteDecisionArgs = {
  route: "none";
  reason: string;
  sessionId?: string;
  argv?: string[];
};

let nowProvider: () => number = () => Date.now();
const lastWriteAtByFingerprint = new Map<string, number>();

function isDebugEnabled(): boolean {
  return process.env[CMUX_DEBUG_ENV]?.trim() === "1";
}

function cmuxDebugStatePath(): string {
  return path.join(getPaiDir(), "MEMORY", "STATE", CMUX_LAST_ERROR_FILE);
}

function redactSecrets(input: string): string {
  return input
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(\bapi[_-]?key\s*=\s*)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/(\btoken\s*=\s*)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/(\bpassword\s*=\s*)[^\s&]+/gi, "$1[REDACTED]");
}

function extractSensitiveArgValues(argv: string[]): string[] {
  const values: string[] = [];
  let redactNextFor: "--body" | "--subtitle" | null = null;

  for (const raw of argv.map((value) => String(value))) {
    if (redactNextFor) {
      values.push(raw);
      redactNextFor = null;
      continue;
    }

    const lower = raw.toLowerCase();
    if (lower === "--body" || lower === "--subtitle") {
      redactNextFor = lower as "--body" | "--subtitle";
      continue;
    }

    if (lower.startsWith("--body=")) {
      values.push(raw.slice("--body=".length));
      continue;
    }

    if (lower.startsWith("--subtitle=")) {
      values.push(raw.slice("--subtitle=".length));
      continue;
    }
  }

  return values.filter((value) => value.trim().length > 0);
}

function hasSensitiveStdioFlags(argv: string[]): boolean {
  for (const raw of argv.map((value) => String(value))) {
    const lower = raw.toLowerCase();
    if (
      lower === "--body" ||
      lower === "--subtitle" ||
      lower.startsWith("--body=") ||
      lower.startsWith("--subtitle=")
    ) {
      return true;
    }
  }

  return false;
}

function buildSensitiveTextNeedles(values: string[]): string[] {
  const needles = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      continue;
    }

    needles.add(trimmed);
    needles.add(`"${trimmed}"`);
    needles.add(`'${trimmed}'`);
    needles.add(JSON.stringify(trimmed));

    const collapsedWhitespace = trimmed.replace(/\s+/g, " ");
    if (collapsedWhitespace !== trimmed) {
      needles.add(collapsedWhitespace);
      needles.add(`"${collapsedWhitespace}"`);
      needles.add(`'${collapsedWhitespace}'`);
      needles.add(JSON.stringify(collapsedWhitespace));
    }
  }

  return [...needles];
}

function redactCliArgPayloadsInText(input: string): string {
  // Defensive redaction if errors/logs echo CLI args.
  return input
    .replace(/(--body\s+)([^\n\r\t ]+)/gi, "$1[REDACTED]")
    .replace(/(--subtitle\s+)([^\n\r\t ]+)/gi, "$1[REDACTED]")
    .replace(/--body=([^\n\r\t ]+)/gi, "--body=[REDACTED]")
    .replace(/--subtitle=([^\n\r\t ]+)/gi, "--subtitle=[REDACTED]");
}

function redactLiteralMatches(input: string, needles: string[]): string {
  let out = input;

  for (const needle of needles) {
    const trimmed = needle.trim();
    if (trimmed.length < 3) {
      continue;
    }

    // Avoid regex injection by using split/join.
    out = out.split(trimmed).join("[REDACTED]");
  }

  return out;
}

function truncateByChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...[truncated]`;
}

function truncateByBytes(value: string, maxBytes: number): string {
  const input = Buffer.from(value, "utf8");
  if (input.byteLength <= maxBytes) {
    return value;
  }

  return `${input.subarray(0, maxBytes).toString("utf8")}...[truncated]`;
}

function sanitizeStdio(value: string, extraSensitiveValues: string[]): string {
  const sensitiveNeedles = buildSensitiveTextNeedles(extraSensitiveValues);
  const redacted = redactLiteralMatches(
    redactCliArgPayloadsInText(redactSecrets(value)),
    sensitiveNeedles,
  );
  return truncateByBytes(redacted, STDIO_MAX_BYTES);
}

function sanitizeMessage(value: string, extraSensitiveValues: string[]): string {
  const sensitiveNeedles = buildSensitiveTextNeedles(extraSensitiveValues);
  return truncateByChars(
    redactLiteralMatches(redactCliArgPayloadsInText(redactSecrets(value)), sensitiveNeedles),
    ARG_MAX_CHARS,
  );
}

function sanitizeArgv(argv: string[]): string[] {
  const sanitized: string[] = [];
  let redactNext = false;

  for (const rawArg of argv.map((value) => String(value))) {
    if (redactNext) {
      sanitized.push("[REDACTED]");
      redactNext = false;
      continue;
    }

    const lower = rawArg.toLowerCase();
    if (lower === "--body" || lower === "--subtitle") {
      sanitized.push(rawArg);
      redactNext = true;
      continue;
    }

    if (lower.startsWith("--body=")) {
      sanitized.push("--body=[REDACTED]");
      continue;
    }

    if (lower.startsWith("--subtitle=")) {
      sanitized.push("--subtitle=[REDACTED]");
      continue;
    }

    sanitized.push(truncateByChars(redactSecrets(rawArg), ARG_MAX_CHARS));
  }

  return sanitized;
}

function makeFingerprint(argv: string[], fallback: string): string {
  const source = argv.length > 0 ? `${fallback}\u001f${argv.join("\u001f")}` : fallback;
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function shouldSkipWrite(fingerprint: string, nowMs: number): boolean {
  const previousWriteAt = lastWriteAtByFingerprint.get(fingerprint);
  if (previousWriteAt == null) {
    return false;
  }

  return nowMs - previousWriteAt < WRITE_THROTTLE_MS;
}

function toTempPath(statePath: string): string {
  return path.join(
    path.dirname(statePath),
    `.${path.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

async function writeAtomic(statePath: string, breadcrumb: CmuxDebugBreadcrumbV1): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

  const tmpPath = toTempPath(statePath);
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(breadcrumb, null, 2)}\n`, "utf-8");

  try {
    await fs.promises.rename(tmpPath, statePath);
    return true;
  } catch {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
    return false;
  }
}

async function writeBreadcrumb(args: {
  kind: CmuxDebugKind;
  argv: string[];
  message?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  route?: "none";
  reason?: string;
  sessionId?: string;
}): Promise<void> {
  if (!isDebugEnabled()) {
    return;
  }

  const nowMs = nowProvider();
  const fingerprint = makeFingerprint(args.argv, `${args.kind}:${args.reason ?? ""}`);
  if (shouldSkipWrite(fingerprint, nowMs)) {
    return;
  }

  const breadcrumb: CmuxDebugBreadcrumbV1 = {
    version: 1,
    kind: args.kind,
    happenedAtMs: nowMs,
    fingerprint,
    argv: args.argv,
    message: args.message,
    exitCode: args.exitCode,
    signal: args.signal,
    stdout: args.stdout,
    stderr: args.stderr,
    route: args.route,
    reason: args.reason,
    sessionId: args.sessionId,
  };

  try {
    const didWrite = await writeAtomic(cmuxDebugStatePath(), breadcrumb);
    if (didWrite) {
      lastWriteAtByFingerprint.set(fingerprint, nowMs);
    }
  } catch {
    // Best-effort breadcrumb only.
  }
}

export async function writeCmuxLastError(args: WriteCmuxLastErrorArgs): Promise<void> {
  try {
    const extraSensitiveValues = extractSensitiveArgValues(args.argv);
    const hasSensitiveFlags = hasSensitiveStdioFlags(args.argv);
    const argv = sanitizeArgv(args.argv);
    await writeBreadcrumb({
      kind: args.kind,
      argv,
      message:
        hasSensitiveFlags || !args.message
          ? undefined
          : sanitizeMessage(args.message, extraSensitiveValues),
      exitCode: args.exitCode ?? null,
      signal: args.signal ?? null,
      stdout: hasSensitiveFlags ? "" : sanitizeStdio(args.stdout ?? "", extraSensitiveValues),
      stderr: hasSensitiveFlags ? "" : sanitizeStdio(args.stderr ?? "", extraSensitiveValues),
    });
  } catch {
    // Best effort only.
  }
}

export async function writeCmuxRouteDecision(args: WriteCmuxRouteDecisionArgs): Promise<void> {
  try {
    const argv = sanitizeArgv(args.argv ?? []);
    await writeBreadcrumb({
      kind: "route_none",
      route: args.route,
      reason: truncateByChars(redactSecrets(args.reason), ARG_MAX_CHARS),
      sessionId: args.sessionId ? truncateByChars(redactSecrets(args.sessionId), ARG_MAX_CHARS) : undefined,
      argv,
    });
  } catch {
    // Best effort only.
  }
}

export function __testOnlyResetCmuxDebugState(): void {
  lastWriteAtByFingerprint.clear();
  nowProvider = () => Date.now();
}

export function __testOnlyConfigureCmuxDebugNow(nowFn: () => number): void {
  nowProvider = nowFn;
}
