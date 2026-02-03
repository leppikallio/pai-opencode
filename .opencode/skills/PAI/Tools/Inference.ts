#!/usr/bin/env bun
/**
 * ============================================================================
 * INFERENCE - Unified inference tool with three run levels
 * ============================================================================
 *
 * PURPOSE:
 * Single inference tool with configurable speed/capability trade-offs:
 * - Fast: light reasoning + short outputs
 * - Standard: balanced reasoning + typical outputs
 * - Smart: deeper reasoning + longer outputs
 *
 * USAGE:
 *   bun Inference.ts --level fast <system_prompt> <user_prompt>
 *   bun Inference.ts --level standard <system_prompt> <user_prompt>
 *   bun Inference.ts --level smart <system_prompt> <user_prompt>
 *   bun Inference.ts --json --level fast <system_prompt> <user_prompt>
 *
 * OPTIONS:
 *   --level <fast|standard|smart>  Run level (default: standard)
 *   --json                         Expect and parse JSON response
 *   --timeout <ms>                 Custom timeout (default varies by level)
 *
 * BACKENDS:
 * - Preferred: OpenCode server as carrier (reuses `opencode auth login` credentials)
 * - Fallback: Direct OpenAI API via OPENAI_API_KEY
 *
 * ============================================================================
 */

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type InferenceLevel = 'fast' | 'standard' | 'smart';

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

  /** Optional override. Default: https://api.openai.com */
  apiBaseUrl?: string;
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

// Level configurations (levels control strictness + output budget, not model)
const LEVEL_CONFIG: Record<InferenceLevel, { defaultTimeout: number; maxOutputTokens: number; profileSystem: string }> = {
  fast: {
    defaultTimeout: 15000,
    maxOutputTokens: 350,
    profileSystem:
      'Be maximally concise. Prefer direct answers. No extra exposition.',
  },
  standard: {
    defaultTimeout: 30000,
    maxOutputTokens: 900,
    profileSystem:
      'Be clear and appropriately detailed. Prioritize correctness.',
  },
  smart: {
    defaultTimeout: 90000,
    maxOutputTokens: 1800,
    profileSystem:
      'Think carefully. Provide the best answer. Do not reveal chain-of-thought.',
  },
};

function normalizeModelId(model: string): string {
  // OpenCode uses provider-prefixed model ids. OpenAI API uses bare ids.
  if (model.startsWith('openai/')) return model.slice('openai/'.length);
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function parseProviderModel(model: string | undefined): { providerID: string; modelID: string } {
  const m = (model || 'openai/gpt-5.2').trim();
  const parts = m.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join('/') };
  }
  // If caller passes bare model id, default provider to openai.
  return { providerID: 'openai', modelID: m };
}

function basicAuthHeader(): string | null {
  const serverPass = process.env.OPENCODE_SERVER_PASSWORD;
  if (!serverPass) return null;
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  return `Basic ${Buffer.from(`${username}:${serverPass}`, 'utf-8').toString('base64')}`;
}

type OpenCodeSessionCreate = { id?: string };
type OpenCodePromptResponse = {
  parts?: Array<{ type?: string; text?: string }>;
};

function extractAssistantTextFromOpenCode(resp: OpenCodePromptResponse): string {
  const parts = Array.isArray(resp.parts) ? resp.parts : [];
  return parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
    .trim();
}

async function tryOpenCodeCarrier(options: InferenceOptions, level: InferenceLevel): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  return tryOpenCodeCarrierWithTimeout(options, level, options.timeout || LEVEL_CONFIG[level].defaultTimeout);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function tryOpenCodeCarrierWithTimeout(
  options: InferenceOptions,
  level: InferenceLevel,
  timeoutMs: number
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const serverUrl = (options.serverUrl || process.env.OPENCODE_SERVER_URL || 'http://localhost:4096').replace(/\/$/, '');
  const auth = basicAuthHeader();
  const start = Date.now();

  const { providerID, modelID } = parseProviderModel(options.model);
  const system = buildSystemPrompt(options.systemPrompt, level, !!options.expectJson);

  // Create an internal session; deny all permissions to prevent tool execution.
  const createRes = await fetchWithTimeout(`${serverUrl}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({
      title: '[PAI INTERNAL] Inference',
      permission: [{ permission: '*', pattern: '*', action: 'deny' }],
    }),
  }, timeoutMs);

  if (!createRes.ok) {
    return { ok: false, error: `OpenCode carrier session create failed (${createRes.status})` };
  }

  const created = (await createRes.json().catch(() => ({}))) as OpenCodeSessionCreate;
  const sessionId = typeof created.id === 'string' ? created.id : '';
  if (!sessionId) {
    return { ok: false, error: 'OpenCode carrier session create returned no id' };
  }

  const remainingAfterCreate = timeoutMs - (Date.now() - start);
  if (remainingAfterCreate <= 250) {
    // Best-effort cleanup.
    void fetch(`${serverUrl}/session/${sessionId}`, {
      method: 'DELETE',
      headers: { ...(auth ? { Authorization: auth } : {}) },
    }).catch(() => {});
    return { ok: false, error: 'OpenCode carrier timed out before prompt' };
  }

  try {
    const promptRes = await fetchWithTimeout(`${serverUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        model: { providerID, modelID },
        system,
        parts: [{ type: 'text', text: options.userPrompt }],
        tools: {},
      }),
    }, remainingAfterCreate);

    if (!promptRes.ok) {
      return { ok: false, error: `OpenCode carrier prompt failed (${promptRes.status})` };
    }

    const resp = (await promptRes.json().catch(() => ({}))) as OpenCodePromptResponse;
    const output = extractAssistantTextFromOpenCode(resp);
    if (!output) {
      return { ok: false, error: 'OpenCode carrier returned empty output' };
    }
    return { ok: true, output };
  } finally {
    // Best-effort cleanup.
    void fetch(`${serverUrl}/session/${sessionId}`, {
      method: 'DELETE',
      headers: { ...(auth ? { Authorization: auth } : {}) },
    }).catch(() => {});
  }
}

function buildSystemPrompt(base: string, level: InferenceLevel, expectJson: boolean): string {
  const parts = [LEVEL_CONFIG[level].profileSystem, base.trim()];
  if (expectJson) {
    parts.push('Return ONLY valid JSON. No markdown. No commentary.');
  }
  return parts.filter(Boolean).join('\n\n');
}

function extractTextFromResponsesApi(payload: unknown): string {
  // Prefer output_text if present.
  const rec = payload as Record<string, unknown>;
  const outputText = rec.output_text;
  if (typeof outputText === 'string') return outputText;

  const out = rec.output;
  if (!Array.isArray(out)) return '';
  const chunks: string[] = [];
  for (const item of out) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const cRec = c as Record<string, unknown>;
      const text = cRec.text;
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.join('');
}

function findJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Direct JSON
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }

  // ```json fenced blocks
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  // Back-compat greedy match (matches previous behavior)
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) return obj[0];
  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) return arr[0];

  return null;
}

/**
 * Run inference with configurable level
 */
export async function inference(options: InferenceOptions): Promise<InferenceResult> {
  const level = options.level || 'standard';
  const config = LEVEL_CONFIG[level];
  const startTime = Date.now();
  const timeout = options.timeout || config.defaultTimeout;

  // Preferred: reuse OpenCode auth (no OPENAI_API_KEY required).
  try {
    const carrier = await tryOpenCodeCarrier(options, level);
    if (carrier.ok) {
      const latencyMs = Date.now() - startTime;
      const output = carrier.output.trim();

      if (options.expectJson) {
        const candidate = findJsonCandidate(output);
        if (!candidate) {
          return { success: false, output, error: 'No JSON found in response', latencyMs, level };
        }
        try {
          const parsed = JSON.parse(candidate);
          return { success: true, output, parsed, latencyMs, level };
        } catch {
          return { success: false, output, error: 'Failed to parse JSON response', latencyMs, level };
        }
      }

      return { success: true, output, latencyMs, level };
    }
  } catch {
    // Ignore carrier failures; fall back to direct OpenAI if key exists.
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      output: '',
      error: 'Inference failed: OpenCode carrier unavailable and OPENAI_API_KEY missing.',
      latencyMs: Date.now() - startTime,
      level,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const apiBaseUrl = (options.apiBaseUrl || 'https://api.openai.com').replace(/\/$/, '');
    const model = normalizeModelId(options.model || 'openai/gpt-5.2');
    const system = buildSystemPrompt(options.systemPrompt, level, !!options.expectJson);

    const body: Record<string, JsonValue> = {
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: options.userPrompt },
      ],
      max_output_tokens: config.maxOutputTokens,
      temperature: 0.2,
    };

    const res = await fetch(`${apiBaseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      // ignore
    }

    const requestId = res.headers.get('x-request-id') || undefined;
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      let msg = `OpenAI error ${res.status}: ${res.statusText}`;
      if (parsedJson && typeof parsedJson === 'object') {
        const err = (parsedJson as Record<string, unknown>).error;
        if (err && typeof err === 'object') {
          const message = (err as Record<string, unknown>).message;
          if (typeof message === 'string' && message.trim()) {
            msg = message;
          }
        }
      }

      return {
        success: false,
        output: '',
        error: msg,
        latencyMs,
        level,
        statusCode: res.status,
        requestId,
      };
    }

    const output = extractTextFromResponsesApi(parsedJson).trim();

    if (options.expectJson) {
      const candidate = findJsonCandidate(output);
      if (!candidate) {
        return {
          success: false,
          output,
          error: 'No JSON found in response',
          latencyMs,
          level,
          statusCode: res.status,
          requestId,
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
          statusCode: res.status,
          requestId,
        };
      } catch {
        return {
          success: false,
          output,
          error: 'Failed to parse JSON response',
          latencyMs,
          level,
          statusCode: res.status,
          requestId,
        };
      }
    }

    return {
      success: true,
      output,
      latencyMs,
      level,
      statusCode: res.status,
      requestId,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const isAbort = typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
    const msg =
      isAbort
        ? `Timeout after ${timeout}ms`
        : err instanceof Error
          ? err.message
          : String(err);

    return {
      success: false,
      output: '',
      error: msg,
      latencyMs,
      level,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let expectJson = false;
  let timeout: number | undefined;
  let level: InferenceLevel = 'standard';
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      expectJson = true;
    } else if (args[i] === '--level' && args[i + 1]) {
      const requestedLevel = args[i + 1].toLowerCase();
      if (['fast', 'standard', 'smart'].includes(requestedLevel)) {
        level = requestedLevel as InferenceLevel;
      } else {
        console.error(`Invalid level: ${args[i + 1]}. Use fast, standard, or smart.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      i++;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  if (positionalArgs.length < 2) {
    console.error('Usage: bun Inference.ts [--level fast|standard|smart] [--json] [--timeout <ms>] <system_prompt> <user_prompt>');
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

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
