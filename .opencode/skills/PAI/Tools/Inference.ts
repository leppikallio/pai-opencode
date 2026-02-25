#!/usr/bin/env bun
/**
 * ==========================================================================
 * INFERENCE - Unified inference tool with three run levels
 * ==========================================================================
 *
 * OpenCode-only carrier using the official OpenCode JS SDK.
 */

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export type InferenceLevel = "fast" | "standard" | "smart";

export interface InferenceOptions {
  systemPrompt: string;
  userPrompt: string;
  level?: InferenceLevel;
  expectJson?: boolean;
  timeout?: number;

  /** Optional override. Default: openai/gpt-5.2 */
  model?: string;

  /** Optional override. Default: http://localhost:4096 */
  serverUrl?: string;

  /** Optional project directory forwarded to OpenCode */
  directory?: string;
}

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
  { defaultTimeout: number; profileSystem: string }
> = {
  fast: {
    defaultTimeout: 15000,
    profileSystem:
      "Be maximally concise. Prefer direct answers. No extra exposition.",
  },
  standard: {
    defaultTimeout: 30000,
    profileSystem:
      "Be clear and appropriately detailed. Prioritize correctness.",
  },
  smart: {
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

async function withAbortableTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new Error(timeoutMessage);
  }

  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await run(controller.signal);
  } catch (error: unknown) {
    if (
      didTimeout ||
      (error instanceof Error &&
        (error.name === "AbortError" || /abort(ed|ing)?/i.test(error.message)))
    ) {
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
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
): Promise<CarrierSuccess | CarrierFailure> {
  return tryOpenCodeCarrierWithTimeout(
    options,
    level,
    options.timeout || LEVEL_CONFIG[level].defaultTimeout,
  );
}

async function tryOpenCodeCarrierWithTimeout(
  options: InferenceOptions,
  level: InferenceLevel,
  timeoutMs: number,
): Promise<CarrierSuccess | CarrierFailure> {
  const serverUrl = (options.serverUrl || process.env.OPENCODE_SERVER_URL || "http://localhost:4096").replace(/\/$/, "");
  const auth = basicAuthHeader();
  const directory = options.directory || process.env.OPENCODE_DIRECTORY;
  const startedAt = Date.now();

  const { providerID, modelID } = parseProviderModel(options.model);
  const system = buildSystemPrompt(options.systemPrompt, level, !!options.expectJson);

  const client = createOpencodeClient({
    baseUrl: serverUrl,
    responseStyle: "fields",
    ...(auth ? { headers: { Authorization: auth } } : {}),
    ...(directory ? { directory } : {}),
  });

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
        );
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Run inference with configurable level
 */
export async function inference(options: InferenceOptions): Promise<InferenceResult> {
  const level = options.level || "standard";
  const startTime = Date.now();

  const carrier = await tryOpenCodeCarrier(options, level);
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
async function main() {
  const args = process.argv.slice(2);

  let expectJson = false;
  let timeout: number | undefined;
  let level: InferenceLevel = "standard";
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      expectJson = true;
    } else if (args[i] === "--level" && args[i + 1]) {
      const requestedLevel = args[i + 1].toLowerCase();
      if (["fast", "standard", "smart"].includes(requestedLevel)) {
        level = requestedLevel as InferenceLevel;
      } else {
        console.error(`Invalid level: ${args[i + 1]}. Use fast, standard, or smart.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      i++;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  if (positionalArgs.length < 2) {
    console.error(
      "Usage: bun Inference.ts [--level fast|standard|smart] [--json] [--timeout <ms>] <system_prompt> <user_prompt>",
    );
    process.exit(1);
  }

  const [systemPrompt, userPrompt] = positionalArgs;

  const result = await inference({
    systemPrompt,
    userPrompt,
    level,
    expectJson,
    timeout,
  });

  if (result.success) {
    if (expectJson && result.parsed) {
      console.log(JSON.stringify(result.parsed));
    } else {
      console.log(result.output);
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
