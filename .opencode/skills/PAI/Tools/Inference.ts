#!/usr/bin/env bun
/**
 * ==========================================================================
 * INFERENCE - Unified inference tool with three run levels
 * ==========================================================================
 *
 * OpenCode-only carrier using the official OpenCode JS SDK.
 */

import {
  boolean,
  command,
  flag,
  number,
  oneOf,
  option,
  optional,
  positional,
  runSafely,
  string,
} from "cmd-ts";

import { createServerConnection } from "./opencode-server-connection";

export type InferenceLevel = "fast" | "standard" | "smart";

export interface InferenceOptions {
  systemPrompt: string;
  userPrompt: string;
  level?: InferenceLevel;
  expectJson?: boolean;
  timeout?: number;
  signal?: AbortSignal;

  /** Optional override. Default: openai/gpt-5.2 */
  model?: string;

  /** Optional override. Default: http://localhost:4096 */
  serverUrl?: string;

  /** Auto mode only: attach to verified loopback instead of starting owned. */
  reuseVerifiedLoopback?: boolean;

  /** Explicit attach mode: allow auth probing/client auth when requested. */
  trustServer?: boolean;

  /** Explicit non-loopback attach: allow sending auth on verified server. */
  allowNonLoopbackAuth?: boolean;

  /** Explicit non-loopback attach: allow auth over http. */
  allowInsecureHttpAuth?: boolean;

  /** Optional project directory forwarded to OpenCode */
  directory?: string;

  /** Probe timeout override in milliseconds. */
  probeTimeoutMs?: number;

  /** Probe body cap override in bytes. */
  probeMaxBytes?: number;

  /** Owned server startup timeout override in milliseconds. */
  startTimeoutMs?: number;
}

type InferenceDeps = {
  createServerConnection?: (opts: any) => Promise<{
    client: any;
    cleanup: () => Promise<void>;
  }>;
};

export interface InferenceResult {
  success: boolean;
  output: string;
  parsed?: unknown;
  error?: string;
  latencyMs: number;
  level: InferenceLevel;

  // Best-effort metadata (may be undefined)
  statusCode?: number;
  requestId?: string;
}

const LEVEL_CONFIG: Record<
  InferenceLevel,
  {
    nickname: "haiku" | "sonnet" | "opus";
    defaultModel: string;
    reasoningEffort: "low" | "high" | "xhigh";
    textVerbosity: "low" | "medium" | "high";
    steps: number;
    defaultTimeout: number;
    profileSystem: string;
  }
> = {
  fast: {
    nickname: "haiku",
    defaultModel: "openai/gpt-5.3-codex-spark",
    reasoningEffort: "low",
    textVerbosity: "low",
    steps: 5,
    defaultTimeout: 15000,
    profileSystem:
      "Be maximally concise. Prefer direct answers. No extra exposition.",
  },
  standard: {
    nickname: "sonnet",
    defaultModel: "openai/gpt-5.2",
    reasoningEffort: "high",
    textVerbosity: "medium",
    steps: 20,
    defaultTimeout: 30000,
    profileSystem:
      "Be clear and appropriately detailed. Prioritize correctness.",
  },
  smart: {
    nickname: "opus",
    defaultModel: "openai/gpt-5.2",
    reasoningEffort: "xhigh",
    textVerbosity: "high",
    steps: 40,
    defaultTimeout: 90000,
    profileSystem:
      "Think carefully. Provide the best answer. Do not reveal chain-of-thought.",
  },
};

function parseProviderModel(
  model: string | undefined,
): { providerID: string; modelID: string } {
  const m = (model || "openai/gpt-5.2").trim();
  const parts = m.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") };
  }
  return { providerID: "openai", modelID: m };
}

function basicAuthHeader(): string | null {
  const serverPass = process.env.OPENCODE_SERVER_PASSWORD;
  if (!serverPass) return null;
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  return `Basic ${Buffer.from(`${username}:${serverPass}`, "utf-8").toString("base64")}`;
}

function isLoopbackUrl(serverUrl: string | null): boolean {
  if (!serverUrl) return false;
  try {
    const parsed = new URL(serverUrl);
    return (
      parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

type OpenCodePromptResponse = {
  parts?: Array<{ type?: string; text?: string }>;
};

function extractAssistantTextFromOpenCode(resp: OpenCodePromptResponse): string {
  const parts = Array.isArray(resp.parts) ? resp.parts : [];
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
    .trim();
}

function buildSystemPrompt(
  base: string,
  level: InferenceLevel,
  expectJson: boolean,
): string {
  const parts = [LEVEL_CONFIG[level].profileSystem, base.trim()];
  if (expectJson) {
    parts.push("Return ONLY valid JSON. No markdown. No commentary.");
  }
  return parts.filter(Boolean).join("\n\n");
}

function findJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) return obj[0];
  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) return arr[0];

  return null;
}

function describeSdkError(error: unknown): string {
  if (!error) return "Unknown OpenCode SDK error";
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }

    const data = record.data;
    if (data && typeof data === "object") {
      const msg = (data as Record<string, unknown>).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }

    if (typeof record.name === "string" && record.name.trim()) {
      return record.name;
    }
  }
  return String(error);
}

function remainingTimeout(startMs: number, timeoutMs: number): number {
  return Math.max(0, timeoutMs - (Date.now() - startMs));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error
    && (error.name === "AbortError" || /abort(ed|ing)?/i.test(error.message))
  );
}

async function withAbortableTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  externalSignal?: AbortSignal,
  abortMessage = "Operation aborted",
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new Error(timeoutMessage);
  }

  const controller = new AbortController();
  let didTimeout = false;
  let didExternalAbort = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    didExternalAbort = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort);
    }
  }

  try {
    return await run(controller.signal);
  } catch (error: unknown) {
    if (didTimeout) {
      throw new Error(timeoutMessage);
    }

    if (didExternalAbort || isAbortError(error)) {
      throw new Error(abortMessage);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

type CarrierSuccess = {
  ok: true;
  output: string;
  statusCode?: number;
  requestId?: string;
};

type CarrierFailure = {
  ok: false;
  error: string;
  statusCode?: number;
  requestId?: string;
};

async function tryOpenCodeCarrier(
  options: InferenceOptions,
  level: InferenceLevel,
  deps?: InferenceDeps,
): Promise<CarrierSuccess | CarrierFailure> {
  return tryOpenCodeCarrierWithTimeout(
    options,
    level,
    options.timeout || LEVEL_CONFIG[level].defaultTimeout,
    deps,
  );
}

async function tryOpenCodeCarrierWithTimeout(
  options: InferenceOptions,
  level: InferenceLevel,
  timeoutMs: number,
  deps?: InferenceDeps,
): Promise<CarrierSuccess | CarrierFailure> {
  const explicitServerUrl = options.serverUrl ?? process.env.OPENCODE_SERVER_URL ?? null;
  const auth = basicAuthHeader();
  const startedAt = Date.now();

  const { providerID, modelID } = parseProviderModel(
    options.model ?? LEVEL_CONFIG[level].defaultModel,
  );
  const system = buildSystemPrompt(options.systemPrompt, level, !!options.expectJson);

  const createServerConnectionFn =
    deps?.createServerConnection ?? createServerConnection;

  const inferredLoopbackTrust = isLoopbackUrl(explicitServerUrl);

  let cleanup: (() => Promise<void>) | null = null;
  let client: any;
  try {
    const conn = await withAbortableTimeout(
      (signal) =>
        createServerConnectionFn({
          signal,
          explicitServerUrl,
          reuseVerifiedLoopback: options.reuseVerifiedLoopback,
          directory: options.directory,
          authHeader: auth,
          trustServer: options.trustServer ?? inferredLoopbackTrust,
          allowNonLoopbackAuth: options.allowNonLoopbackAuth,
          allowInsecureHttpAuth: options.allowInsecureHttpAuth,
          probeTimeoutMs: options.probeTimeoutMs,
          probeMaxBytes: options.probeMaxBytes,
          startTimeoutMs: options.startTimeoutMs,
        }),
      remainingTimeout(startedAt, timeoutMs),
      "OpenCode server connection timed out",
      options.signal,
      "Inference aborted while connecting to OpenCode server",
    );

    cleanup = conn.cleanup;
    client = conn.client;
  } catch (err: unknown) {
    return { ok: false, error: describeSdkError(err) };
  }

  let sessionId = "";
  try {
    const createResult = (await withAbortableTimeout(
      (signal) =>
        client.session.create(
          {
            title: "[PAI INTERNAL] Inference",
            permission: [{ permission: "*", pattern: "*", action: "deny" }],
          },
          { signal },
        ),
      remainingTimeout(startedAt, timeoutMs),
      "OpenCode carrier session create timed out",
      options.signal,
      "Inference aborted during OpenCode session creation",
    )) as {
      data?: { id?: string };
      error?: unknown;
      response?: Response;
    };

    if (createResult.error || !createResult.data?.id) {
      return {
        ok: false,
        error: createResult.error
          ? `OpenCode carrier session create failed: ${describeSdkError(createResult.error)}`
          : "OpenCode carrier session create returned no id",
        statusCode: createResult.response?.status,
      };
    }

    sessionId = createResult.data.id;

    const promptResult = (await withAbortableTimeout(
      (signal) =>
        client.session.prompt(
          {
            sessionID: sessionId,
            model: { providerID, modelID },
            system,
            parts: [{ type: "text", text: options.userPrompt }],
            tools: {},
          },
          { signal },
        ),
      remainingTimeout(startedAt, timeoutMs),
      "OpenCode carrier prompt timed out",
      options.signal,
      "Inference aborted during OpenCode prompt",
    )) as {
      data?: OpenCodePromptResponse;
      error?: unknown;
      response?: Response;
    };

    const requestId = promptResult.response?.headers.get("x-request-id") || undefined;
    if (promptResult.error || !promptResult.data) {
      return {
        ok: false,
        error: promptResult.error
          ? `OpenCode carrier prompt failed: ${describeSdkError(promptResult.error)}`
          : "OpenCode carrier prompt returned no data",
        statusCode: promptResult.response?.status,
        requestId,
      };
    }

    const output = extractAssistantTextFromOpenCode(promptResult.data);
    if (!output) {
      return {
        ok: false,
        error: "OpenCode carrier returned empty output",
        statusCode: promptResult.response?.status,
        requestId,
      };
    }

    return {
      ok: true,
      output,
      statusCode: promptResult.response?.status,
      requestId,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: describeSdkError(err),
    };
  } finally {
    if (sessionId) {
      const deleteTimeout = Math.max(250, remainingTimeout(startedAt, timeoutMs));
      try {
        await withAbortableTimeout(
          (signal) => client.session.delete({ sessionID: sessionId }, { signal }),
          deleteTimeout,
          "OpenCode carrier session delete timed out",
          options.signal,
          "Inference aborted during OpenCode session cleanup",
        );
      } catch {
        // best-effort cleanup
      }
    }

    try {
      await cleanup?.();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Run inference with configurable level
 */
export async function inference(
  options: InferenceOptions,
  deps?: InferenceDeps,
): Promise<InferenceResult> {
  const level = options.level || "standard";
  const startTime = Date.now();

  const carrier = await tryOpenCodeCarrier(options, level, deps);
  const latencyMs = Date.now() - startTime;

  if (!carrier.ok) {
    return {
      success: false,
      output: "",
      error: carrier.error,
      latencyMs,
      level,
      statusCode: carrier.statusCode,
      requestId: carrier.requestId,
    };
  }

  const output = carrier.output.trim();
  if (options.expectJson) {
    const candidate = findJsonCandidate(output);
    if (!candidate) {
      return {
        success: false,
        output,
        error: "No JSON found in response",
        latencyMs,
        level,
        statusCode: carrier.statusCode,
        requestId: carrier.requestId,
      };
    }
    try {
      const parsed = JSON.parse(candidate);
      if (!isJsonObject(parsed)) {
        return {
          success: false,
          output,
          error: "JSON response must be an object",
          latencyMs,
          level,
          statusCode: carrier.statusCode,
          requestId: carrier.requestId,
        };
      }
      return {
        success: true,
        output,
        parsed,
        latencyMs,
        level,
        statusCode: carrier.statusCode,
        requestId: carrier.requestId,
      };
    } catch {
      return {
        success: false,
        output,
        error: "Failed to parse JSON response",
        latencyMs,
        level,
        statusCode: carrier.statusCode,
        requestId: carrier.requestId,
      };
    }
  }

  return {
    success: true,
    output,
    latencyMs,
    level,
    statusCode: carrier.statusCode,
    requestId: carrier.requestId,
  };
}

/**
 * CLI entry point
 */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type InferenceCliArgs = {
  systemPrompt: string;
  userPrompt: string;
  level?: InferenceLevel;
  fast: boolean;
  standard: boolean;
  smart: boolean;
  json: boolean;
  timeout?: number;
  model?: string;
  serverUrl?: string;
  reuseVerifiedLoopback: boolean;
  trustServer: boolean;
  allowNonLoopbackAuth: boolean;
  allowInsecureHttpAuth: boolean;
  directory?: string;
  probeTimeoutMs?: number;
  probeMaxBytes?: number;
  startTimeoutMs?: number;
};

const INFERENCE_HELP_DESCRIPTION = [
  "Unified inference runner for OpenCode with typed CLI contracts.",
  "",
  "Inference level presets:",
  "| level | nickname | model | reasoningEffort | textVerbosity | steps |",
  "| fast | haiku | openai/gpt-5.3-codex-spark | low | low | 5 |",
  "| standard | sonnet | openai/gpt-5.2 | high | medium | 20 |",
  "| smart | opus | openai/gpt-5.2 | xhigh | high | 40 |",
  "",
  "Precedence and conflict rules:",
  "- Select exactly one level selector: --level OR one alias (--fast|--standard|--smart).",
  "- If none is provided, level defaults to standard.",
  "- Preset defaults apply first; --model overrides model only; --timeout overrides timeout only.",
  "",
  "I/O and exit code contract:",
  "- stdout text mode: assistant text only.",
  "- stdout --json mode: exactly one JSON object only.",
  "- stderr: diagnostics and errors only.",
  "- exit codes: 0 success, 1 runtime/model/signal failure, 2 usage error.",
].join("\n");

function createInferenceCliCommand() {
  return command({
    name: "Inference.ts",
    description: INFERENCE_HELP_DESCRIPTION,
    args: {
      level: option({
        long: "level",
        type: optional(oneOf<InferenceLevel>(["fast", "standard", "smart"])),
        description: "Inference level preset selector (default: standard).",
      }),
      fast: flag({
        long: "fast",
        type: boolean,
        description: "Alias for --level fast (default: off).",
      }),
      standard: flag({
        long: "standard",
        type: boolean,
        description: "Alias for --level standard (default: off).",
      }),
      smart: flag({
        long: "smart",
        type: boolean,
        description: "Alias for --level smart (default: off).",
      }),
      json: flag({
        long: "json",
        type: boolean,
        description: "Emit parsed JSON only on stdout (default: off).",
      }),
      timeout: option({
        long: "timeout",
        type: optional(number),
        description: "Request timeout in ms (default: level timeout).",
      }),
      model: option({
        long: "model",
        type: optional(string),
        description: "Override model provider/model (default: level preset model).",
      }),
      serverUrl: option({
        long: "server-url",
        type: optional(string),
        description: "Explicit OpenCode server URL (default: env/auto).",
      }),
      reuseVerifiedLoopback: flag({
        long: "reuse-verified-loopback",
        type: boolean,
        description: "Auto mode: reuse verified loopback server on port 4096 (default: off).",
      }),
      trustServer: flag({
        long: "trust-server",
        type: boolean,
        description: "Allow auth probing/attach when server requests auth (default: off).",
      }),
      allowNonLoopbackAuth: flag({
        long: "allow-non-loopback-auth",
        type: boolean,
        description: "Allow auth to non-loopback explicit server URLs (default: off).",
      }),
      allowInsecureHttpAuth: flag({
        long: "allow-insecure-http-auth",
        type: boolean,
        description: "Allow non-loopback auth over http (default: off).",
      }),
      directory: option({
        long: "directory",
        type: optional(string),
        description: "Override OpenCode directory header value (default: policy-derived).",
      }),
      probeTimeoutMs: option({
        long: "probe-timeout-ms",
        type: optional(number),
        description: "Probe timeout in ms (default: 750 loopback, 2000 non-loopback).",
      }),
      probeMaxBytes: option({
        long: "probe-max-bytes",
        type: optional(number),
        description: "Probe response byte cap (default: 16384).",
      }),
      startTimeoutMs: option({
        long: "start-timeout-ms",
        type: optional(number),
        description: "Owned server startup timeout in ms (default: 8000).",
      }),
      systemPrompt: positional({
        type: string,
        displayName: "system_prompt",
      }),
      userPrompt: positional({
        type: string,
        displayName: "user_prompt",
      }),
    },
    handler: (args) => args,
  });
}

function resolveLevel(args: InferenceCliArgs): InferenceLevel {
  const selectors: InferenceLevel[] = [];

  if (args.level) selectors.push(args.level);
  if (args.fast) selectors.push("fast");
  if (args.standard) selectors.push("standard");
  if (args.smart) selectors.push("smart");

  if (selectors.length > 1) {
    throw new UsageError(
      "Level selector conflict: choose exactly one of --level, --fast, --standard, or --smart.",
    );
  }

  return selectors[0] ?? "standard";
}

function writeUsageMessage(message: string, toStdout: boolean): void {
  if (toStdout) {
    writeStdoutLine(message);
    return;
  }

  writeStderrLine(message);
}

function hasJsonFlag(argv: string[]): boolean {
  for (const token of argv) {
    if (token === "--") return false;
    if (token === "--json") return true;
  }
  return false;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REDACTED_SECRET = "[REDACTED]";
const REDACTED_PATH = "[REDACTED_PATH]";
const REDACTED_USERINFO = "[REDACTED_USERINFO]";

function redactSensitiveText(message: string): string {
  return message
    .replace(
      /(\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|PASSWORD)\b\s*=\s*)([^\s,;]+)/gi,
      `$1${REDACTED_SECRET}`,
    )
    .replace(
      /((["]|')(?:authorization|proxy-authorization)\2\s*:\s*(["]))(?:[^"\\]|\\.)*\3/gi,
      `$1${REDACTED_SECRET}$3`,
    )
    .replace(
      /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)([^,;\r\n]+)/gi,
      `$1${REDACTED_SECRET}`,
    )
    .replace(
      /(\b(?:access_token|id_token|refresh_token|api[_-]?key|password|passwd|secret)\b\s*[:=]\s*)([^\s,;]+)/gi,
      `$1${REDACTED_SECRET}`,
    )
    .replace(/(https?:\/\/)([^\s/@]+(?::[^\s/@]*)?@)/gi, `$1${REDACTED_USERINFO}@`)
    .replace(/\/Users\/[^\s"'`),;]+/g, REDACTED_PATH);
}

function writeStderrLine(message: string): void {
  process.stderr.write(`${redactSensitiveText(message)}\n`);
}

function writeStdoutLine(message: string): void {
  process.stdout.write(`${redactSensitiveText(message)}\n`);
}

function writeErrorToStderr(message: string): void {
  writeStderrLine(`Error: ${message}`);
}

function writeJsonObjectToStdout(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload));
}

function writeJsonErrorToStdout(message: string, code: "usage" | "runtime" | "abort"): void {
  writeJsonObjectToStdout({ success: false, code, error: message });
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const cli = createInferenceCliCommand();
  const jsonMode = hasJsonFlag(argv);
  let parsed;

  try {
    parsed = await runSafely(cli, argv);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode) {
      writeJsonErrorToStdout("Invalid command-line arguments", "usage");
      return 2;
    }

    writeErrorToStderr(`Invalid command-line arguments: ${message}`);
    return 2;
  }

  if (parsed._tag === "error") {
    const { message, into, exitCode } = parsed.error.config;
    if (jsonMode) {
      if (exitCode === 0) {
        writeJsonObjectToStdout({ success: true, message: "Help requested" });
        return 0;
      }
      writeJsonErrorToStdout("Invalid command-line arguments", "usage");
      return 2;
    }

    writeUsageMessage(message, into === "stdout");
    return exitCode === 0 ? 0 : 2;
  }

  const args = parsed.value as InferenceCliArgs;
  let level: InferenceLevel;
  try {
    level = resolveLevel(args);
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      if (jsonMode) {
        writeJsonErrorToStdout("Invalid command-line arguments", "usage");
        return 2;
      }
      writeStderrLine(error.message);
      return 2;
    }

    if (jsonMode) {
      writeJsonErrorToStdout("Inference failed", "runtime");
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeErrorToStderr(message);
    return 1;
  }

  const abortController = new AbortController();
  let signalName: NodeJS.Signals | null = null;

  const onSignal = (signal: NodeJS.Signals) => {
    if (signalName) return;
    signalName = signal;
    abortController.abort();
  };

  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const result = await inference({
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      level,
      expectJson: args.json,
      timeout: args.timeout,
      model: args.model,
      serverUrl: args.serverUrl,
      reuseVerifiedLoopback: args.reuseVerifiedLoopback,
      trustServer: args.trustServer ? true : undefined,
      allowNonLoopbackAuth: args.allowNonLoopbackAuth ? true : undefined,
      allowInsecureHttpAuth: args.allowInsecureHttpAuth ? true : undefined,
      directory: args.directory,
      probeTimeoutMs: args.probeTimeoutMs,
      probeMaxBytes: args.probeMaxBytes,
      startTimeoutMs: args.startTimeoutMs,
      signal: abortController.signal,
    });

    if (signalName) {
      if (jsonMode) {
        writeJsonErrorToStdout("Inference aborted by signal", "abort");
        return 1;
      }
      writeErrorToStderr(`Aborted by ${signalName}`);
      return 1;
    }

    if (!result.success) {
      if (jsonMode) {
        writeJsonErrorToStdout("Inference request failed", "runtime");
        return 1;
      }
      writeErrorToStderr(result.error ?? "Unknown inference failure");
      return 1;
    }

    if (args.json) {
      if (!isJsonObject(result.parsed)) {
        writeJsonErrorToStdout("Inference JSON mode requires an object response", "runtime");
        return 1;
      }
      writeJsonObjectToStdout(result.parsed);
      return 0;
    }

    process.stdout.write(result.output);
    return 0;
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      if (jsonMode) {
        writeJsonErrorToStdout("Invalid command-line arguments", "usage");
        return 2;
      }
      writeStderrLine(error.message);
      return 2;
    }

    if (signalName || abortController.signal.aborted || isAbortError(error)) {
      if (jsonMode) {
        writeJsonErrorToStdout("Inference aborted by signal", "abort");
        return 1;
      }
      writeErrorToStderr(`Aborted by ${signalName ?? "signal"}`);
      return 1;
    }

    if (jsonMode) {
      writeJsonErrorToStdout("Inference failed", "runtime");
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeErrorToStderr(message);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      if (hasJsonFlag(process.argv.slice(2))) {
        writeJsonErrorToStdout("Inference failed", "runtime");
        process.exit(1);
      }

      const message = error instanceof Error ? error.message : String(error);
      writeErrorToStderr(message);
      process.exit(1);
    });
}
