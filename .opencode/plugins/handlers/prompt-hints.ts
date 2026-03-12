import {
  type AdvisoryHintCandidate,
  type AdvisoryHintEnvelope,
  type CarrierHintMode,
  type PromptDepth,
  type ReasoningProfile,
  type Verbosity,
  createAdvisoryHintCandidate,
  reduceAdvisoryHintCandidates,
  resolveCarrierHintMode,
} from "../shared/hint-envelope";
import {
  PROMPT_CLASSIFIER_SYSTEM_PROMPT,
  createHeuristicPromptHintCandidate,
} from "../shared/prompt-classifier-contract";

export type { PromptDepth, ReasoningProfile, Verbosity, CarrierHintMode };
export type PromptHint = AdvisoryHintEnvelope;

type OpenCodeSessionCreateResponse = {
  id?: string;
};

type OpenCodePromptResponse = {
  info?: { id?: string };
  parts?: Array<{ type?: string; text?: string }>;
};

type CarrierClient = {
  session?: {
    create?: (options?: unknown) => Promise<unknown>;
    prompt?: (options: unknown) => Promise<unknown>;
    delete?: (options: unknown) => Promise<unknown>;
    messages?: (options?: unknown) => Promise<unknown>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordProp(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return isRecord(v) ? v : undefined;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function getAnyProp(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

function parseCarrierCandidateObject(text: string): Record<string, unknown> | null {
  const candidate = findJsonCandidate(text);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function tryParseResponseBody(response: unknown): Promise<OpenCodePromptResponse | null> {
  if (!response || typeof response !== "object") return null;
  const maybeText = (response as { text?: () => Promise<string> }).text;
  if (typeof maybeText !== "function") return null;
  try {
    const raw = await maybeText.call(response);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OpenCodePromptResponse;
    return parsed;
  } catch {
    return null;
  }
}

async function tryFetchLatestAssistantText(
  client: CarrierClient,
  sessionId: string,
  directory?: string
): Promise<string> {
  if (!client.session?.messages) return "";
  try {
    const messagesRes = await client.session.messages({
      path: { id: sessionId },
      query: directory ? { directory, limit: 20 } : { limit: 20 },
    });
    const data = getAnyProp(messagesRes, "data");
    const messages = Array.isArray(data) ? data : Array.isArray(messagesRes) ? messagesRes : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> };
      if (msg?.info?.role === "assistant") {
        return extractAssistantText({ parts: msg.parts ?? [] });
      }
    }
  } catch {
    return "";
  }
  return "";
}

async function pollForAssistantText(
  client: CarrierClient,
  sessionId: string,
  directory?: string,
  timeoutMs = 1500
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await tryFetchLatestAssistantText(client, sessionId, directory);
    if (text) return text;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return "";
}

async function bestEffortDeleteCarrierSession(args: {
  client: CarrierClient;
  sessionId: string;
  directory?: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 500;
  if (!args.client.session?.delete) return;
  try {
    await Promise.race([
      args.client.session.delete({
        path: { id: args.sessionId },
        query: args.directory ? { directory: args.directory } : undefined,
      }) as unknown as Promise<unknown>,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // best-effort
  }
}

function basicAuthHeader(): string | null {
  const serverPass = process.env.OPENCODE_SERVER_PASSWORD;
  if (!serverPass) return null;
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  return `Basic ${Buffer.from(`${username}:${serverPass}`, "utf-8").toString("base64")}`;
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

function extractAssistantText(resp: OpenCodePromptResponse): string {
  const parts = Array.isArray(resp.parts) ? resp.parts : [];
  return parts
    .filter(
      (p) =>
        p &&
        (p.type === "text" || p.type === "reasoning") &&
        typeof p.text === "string"
    )
    .map((p) => p.text as string)
    .join("")
    .trim();
}

function createCarrierCandidate(
  parsed: Record<string, unknown>,
  carrierMode: CarrierHintMode,
): AdvisoryHintCandidate {
  return createAdvisoryHintCandidate({
    producer: "runtime_carrier_openai",
    mode: carrierMode === "shadow" ? "runtime_shadow" : "utility",
    advisory: {
      depth: parsed.depth as PromptDepth,
      reasoning_profile: parsed.reasoning_profile as ReasoningProfile,
      verbosity: parsed.verbosity as Verbosity,
      capabilities: Array.isArray(parsed.capabilities)
        ? (parsed.capabilities.filter((value) => typeof value === "string") as string[])
        : [],
      thinking_tools: Array.isArray(parsed.thinking_tools)
        ? (parsed.thinking_tools.filter((value) => typeof value === "string") as string[])
        : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
    },
  });
}

async function openCodeClassify(
  serverUrl: string,
  prompt: string,
  opts: {
    carrierMode: CarrierHintMode;
    ignoreSession?: (sessionId: string) => void;
    unignoreSession?: (sessionId: string) => void;
    client?: CarrierClient;
    directory?: string;
  }
): Promise<AdvisoryHintCandidate | null> {
  const start = Date.now();
  const timeoutMs = 1500;

  const systemPrompt = PROMPT_CLASSIFIER_SYSTEM_PROMPT;

  const directory = opts.directory;

  if (opts.client?.session?.create && opts.client?.session?.prompt && opts.client?.session?.delete) {
    const createRes = await opts.client.session.create({
      query: directory ? { directory } : undefined,
      body: {
        title: "[PAI INTERNAL] PromptHint",
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      },
    });

    const sid = getStringProp(getRecordProp(createRes, "data"), "id");
    if (!sid) return null;
    opts.ignoreSession?.(sid);

    try {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 250) return null;

      const promptRes = await opts.client.session.prompt({
        path: { id: sid },
        query: directory ? { directory } : undefined,
        body: {
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: false,
          variant: "minimal",
          system: systemPrompt,
          parts: [{ type: "text", text: prompt }],
          tools: {},
        },
      });

      const data = getRecordProp(promptRes, "data") as unknown;
      const resp = isRecord(data) ? (data as OpenCodePromptResponse) : undefined;
      let text = resp ? extractAssistantText(resp) : "";
      if (!text) {
        const fallback = await tryParseResponseBody(getAnyProp(promptRes, "response"));
        if (fallback) {
          text = extractAssistantText(fallback);
        }
      }
      if (!text) {
        text = await pollForAssistantText(opts.client, sid, directory);
      }
      if (!text) return null;

      const parsed = parseCarrierCandidateObject(text);
      if (!parsed) return null;
      return createCarrierCandidate(parsed, opts.carrierMode);
    } catch {
      return null;
    } finally {
      await bestEffortDeleteCarrierSession({ client: opts.client, sessionId: sid, directory });
      opts.unignoreSession?.(sid);
    }
  }

  const auth = basicAuthHeader();
  const base = serverUrl.replace(/\/$/, "");
  const createRes = await fetchWithTimeout(`${base}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({
      title: "[PAI INTERNAL] PromptHint",
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    }),
  }, timeoutMs);

  if (!createRes.ok) return null;

  const createJson = (await createRes.json().catch(() => ({}))) as OpenCodeSessionCreateResponse;
  const sid = typeof createJson.id === "string" ? createJson.id : null;
  if (!sid) return null;
  opts.ignoreSession?.(sid);

  try {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 250) return null;

    const promptRes = await fetchWithTimeout(`${base}/session/${sid}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        model: { providerID: "openai", modelID: "gpt-5.2" },
        system: systemPrompt,
        parts: [{ type: "text", text: prompt }],
        tools: {},
      }),
    }, remaining);

    if (!promptRes.ok) return null;

    const resp = (await promptRes.json().catch(() => ({}))) as OpenCodePromptResponse;
    const text = extractAssistantText(resp);
    if (!text) return null;

    const parsed = parseCarrierCandidateObject(text);
    if (!parsed) return null;
    return createCarrierCandidate(parsed, opts.carrierMode);
  } finally {
    try {
      await fetchWithTimeout(
        `${base}/session/${sid}`,
        {
          method: "DELETE",
          headers: { ...(auth ? { Authorization: auth } : {}) },
        },
        500,
      );
    } catch {
      // best-effort
    }
    opts.unignoreSession?.(sid);
  }
}

export function resolvePromptHintCarrierMode(
  env: Record<string, string | undefined> = process.env,
): CarrierHintMode {
  return resolveCarrierHintMode(env);
}

export async function classifyPromptHint(
  prompt: string,
  userMessageId: string,
  opts?: {
    serverUrl?: string;
    carrierMode?: CarrierHintMode;
    ignoreSession?: (sessionId: string) => void;
    unignoreSession?: (sessionId: string) => void;
    client?: CarrierClient;
    directory?: string;
  }
): Promise<PromptHint> {
  const baseCandidate = createHeuristicPromptHintCandidate(prompt, "runtime_default");
  const carrierMode = opts?.carrierMode ?? resolvePromptHintCarrierMode();
  const candidates: AdvisoryHintCandidate[] = [baseCandidate];

  try {
    if (opts?.serverUrl && carrierMode !== "disabled") {
      const carrierCandidate = await openCodeClassify(opts.serverUrl, prompt, {
        carrierMode,
        ignoreSession: opts.ignoreSession,
        unignoreSession: opts.unignoreSession,
        client: opts.client,
        directory: opts.directory,
      });
      if (carrierCandidate) {
        candidates.push(carrierCandidate);
      }
    }
  } catch {
    // Fail-open to deterministic baseline hint.
  }

  return reduceAdvisoryHintCandidates({
    userMessageId,
    candidates,
    carrierMode,
    forceProducer: carrierMode === "shadow" ? "runtime_heuristic" : undefined,
  });
}
