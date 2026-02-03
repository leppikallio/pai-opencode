export type PromptDepth = "MINIMAL" | "ITERATION" | "FULL";
export type ReasoningProfile = "light" | "standard" | "deep";
export type Verbosity = "minimal" | "standard" | "detailed";

export type PromptHint = {
  v: "0.1";
  ts: string;
  userMessageId: string;

  depth: PromptDepth;
  reasoning_profile: ReasoningProfile;
  verbosity: Verbosity;
  capabilities: string[];
  thinking_tools: string[];
  confidence: number;
  source: "openai" | "heuristic";

  toast?: {
    message: string;
    variant: "info" | "warning";
    durationMs?: number;
  };
};

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

function basicAuthHeader(): string | null {
  const serverPass = process.env.OPENCODE_SERVER_PASSWORD;
  if (!serverPass) return null;
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  return `Basic ${Buffer.from(`${username}:${serverPass}`, 'utf-8').toString('base64')}`;
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
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
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

function isGreeting(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "hi" || t === "hello" || t === "hey" || t.startsWith("hello ") || t.startsWith("hi ");
}

function heuristic(prompt: string, userMessageId: string): PromptHint {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  let depth: PromptDepth = "FULL";
  if (p.length <= 40 && isGreeting(p)) depth = "MINIMAL";
  else if (/\b(continue|please continue|next step|keep going)\b/i.test(p)) depth = "ITERATION";

  let reasoning_profile: ReasoningProfile = "standard";
  if (depth === "MINIMAL") reasoning_profile = "light";
  if (/\b(thorough|very thorough|deep|architecture|system design|detailed plan)\b/i.test(p)) {
    reasoning_profile = "deep";
  }

  let verbosity: Verbosity = "standard";
  if (depth === "MINIMAL") verbosity = "minimal";
  if (/\b(detailed|very detailed|exhaustive)\b/i.test(p)) verbosity = "detailed";

  const capabilities: string[] = [];
  if (/\b(ui|ux|design|layout)\b/i.test(lower)) capabilities.push("Designer");
  if (/\b(test|tests|qa|verify)\b/i.test(lower)) capabilities.push("QATester");
  if (/\b(security|pentest|vuln|threat model)\b/i.test(lower)) capabilities.push("Pentester");
  if (/\b(research|sources|citations)\b/i.test(lower)) capabilities.push("researcher");
  if (/\b(implement|fix|refactor|code)\b/i.test(lower)) capabilities.push("Engineer");
  if (capabilities.length === 0) capabilities.push("Engineer");

  const thinking_tools: string[] = [];
  if (depth === "FULL") {
    thinking_tools.push("FirstPrinciples", "RedTeam");
    if (/\b(options|ideas|brainstorm)\b/i.test(lower)) thinking_tools.push("BeCreative");
  }

  const toastBits: string[] = [];
  toastBits.push(`depth=${depth}`);
  if (reasoning_profile !== "standard") toastBits.push(`reasoning=${reasoning_profile}`);
  if (thinking_tools.length) toastBits.push(`tools=${thinking_tools.slice(0, 2).join("+")}`);

  return {
    v: "0.1",
    ts: new Date().toISOString(),
    userMessageId,
    depth,
    reasoning_profile,
    verbosity,
    capabilities,
    thinking_tools,
    confidence: 0.55,
    source: "heuristic",
    toast: {
      message: `Hint: ${toastBits.join(" ")}`,
      variant: "info",
      durationMs: 5000,
    },
  };
}

async function openAiClassify(_prompt: string, _userMessageId: string): Promise<PromptHint | null> {
  // NOTE: despite the name, this does NOT call OpenAI directly.
  // It uses OpenCode's server as carrier (so it can use OpenCode auth).
  return null;
}

function extractAssistantText(resp: OpenCodePromptResponse): string {
  const parts = Array.isArray(resp.parts) ? resp.parts : [];
  return parts
    .filter(
      (p) =>
        p &&
        (p.type === 'text' || p.type === 'reasoning') &&
        typeof p.text === 'string'
    )
    .map((p) => p.text as string)
    .join('')
    .trim();
}

async function openCodeClassify(
  serverUrl: string,
  prompt: string,
  userMessageId: string,
  opts: {
    ignoreSession?: (sessionId: string) => void;
    unignoreSession?: (sessionId: string) => void;
    client?: CarrierClient;
    directory?: string;
  }
): Promise<PromptHint | null> {
  const start = Date.now();
  const timeoutMs = 1500;

  const systemPrompt = [
    "You are a classifier for an OpenCode-based Personal AI Infrastructure.",
    "Return ONLY valid JSON.",
    "Schema:",
    "{",
    '  "depth": "MINIMAL"|"ITERATION"|"FULL",',
    '  "reasoning_profile": "light"|"standard"|"deep",',
    '  "verbosity": "minimal"|"standard"|"detailed",',
    '  "capabilities": ["Engineer"|"Designer"|"QATester"|"Pentester"|"researcher"|"Explore"],',
    '  "thinking_tools": ["FirstPrinciples"|"RedTeam"|"BeCreative"|"Council"|"Research"|"Evals"],',
    '  "confidence": 0.0',
    "}",
    "Do not use tools.",
    "Use conservative defaults when uncertain.",
  ].join("\n");

  const directory = opts.directory;

  // Prefer in-process client (no network) when available.
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
      const resp = (isRecord(data) ? (data as OpenCodePromptResponse) : undefined);
      let text = resp ? extractAssistantText(resp) : "";
      if (!text) {
        const fallback = await tryParseResponseBody(getAnyProp(promptRes, "response"));
        if (fallback) {
          text = extractAssistantText(fallback);
        }
      }
      if (!text) return null;
      if (!text) {
        text = await pollForAssistantText(opts.client, sid, directory);
      }
      if (!text) return null;

      const candidate = findJsonCandidate(text);
      if (!candidate) return null;
      const obj = JSON.parse(candidate) as {
        depth?: unknown;
        reasoning_profile?: unknown;
        verbosity?: unknown;
        capabilities?: unknown;
        thinking_tools?: unknown;
        confidence?: unknown;
      };

      const depthRaw = obj.depth;
      const reasoningRaw = obj.reasoning_profile;
      const verbosityRaw = obj.verbosity;

      const depth: PromptDepth =
        depthRaw === "MINIMAL" || depthRaw === "ITERATION" || depthRaw === "FULL" ? depthRaw : "FULL";
      const reasoning_profile: ReasoningProfile =
        reasoningRaw === "light" || reasoningRaw === "standard" || reasoningRaw === "deep"
          ? reasoningRaw
          : "standard";
      const verbosity: Verbosity =
        verbosityRaw === "minimal" || verbosityRaw === "standard" || verbosityRaw === "detailed"
          ? verbosityRaw
          : "standard";

      const capabilities = Array.isArray(obj.capabilities)
        ? (obj.capabilities.filter((x) => typeof x === "string") as string[])
        : [];
      const thinking_tools = Array.isArray(obj.thinking_tools)
        ? (obj.thinking_tools.filter((x) => typeof x === "string") as string[])
        : [];
      const confidence = typeof obj.confidence === "number" ? obj.confidence : 0.5;

      const toastBits: string[] = [];
      toastBits.push(`depth=${depth}`);
      if (reasoning_profile !== "standard") toastBits.push(`reasoning=${reasoning_profile}`);
      if (thinking_tools.length) toastBits.push(`tools=${thinking_tools.slice(0, 2).join("+")}`);

      return {
        v: "0.1",
        ts: new Date().toISOString(),
        userMessageId,
        depth,
        reasoning_profile,
        verbosity,
        capabilities: capabilities.length ? capabilities : ["Engineer"],
        thinking_tools,
        confidence,
        source: "openai",
        toast: {
          message: `Hint: ${toastBits.join(" ")}`,
          variant: "info",
          durationMs: 5000,
        },
      };
    } catch {
      return null;
    } finally {
      void opts.client.session
        .delete({
          path: { id: sid },
          query: directory ? { directory } : undefined,
        })
        .catch(() => {});
      opts.unignoreSession?.(sid);
    }
  }

  // Fallback: network carrier.
  const auth = basicAuthHeader();

  // Create an internal session that we ignore in our own capture.
  const base = serverUrl.replace(/\/$/, '');
  const createRes = await fetchWithTimeout(`${base}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({
      title: '[PAI INTERNAL] PromptHint',
      // Deny all permissions to prevent tool execution.
      permission: [{ permission: '*', pattern: '*', action: 'deny' }],
    }),
  }, timeoutMs);

  if (!createRes.ok) return null;

  const createJson = (await createRes.json().catch(() => ({}))) as OpenCodeSessionCreateResponse;
  const sid = typeof createJson.id === 'string' ? createJson.id : null;
  if (!sid) return null;
  opts.ignoreSession?.(sid);

  try {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 250) return null;

    const promptRes = await fetchWithTimeout(`${base}/session/${sid}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        model: { providerID: 'openai', modelID: 'gpt-5.2' },
        system: systemPrompt,
        parts: [{ type: 'text', text: prompt }],
        // Deprecated in OpenCode, but helps discourage tool usage.
        tools: {},
      }),
    }, remaining);

    if (!promptRes.ok) return null;

    const resp = (await promptRes.json().catch(() => ({}))) as OpenCodePromptResponse;
    const text = extractAssistantText(resp);
    if (!text) return null;

    let obj: Record<string, unknown> | null = null;
    try {
      const candidate = findJsonCandidate(text);
      if (!candidate) return null;
      obj = JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }

  const depth = (obj.depth as PromptDepth) || "FULL";
  const reasoning_profile = (obj.reasoning_profile as ReasoningProfile) || "standard";
  const verbosity = (obj.verbosity as Verbosity) || "standard";
  const capabilities = Array.isArray(obj.capabilities) ? (obj.capabilities as string[]) : ["Engineer"];
  const thinking_tools = Array.isArray(obj.thinking_tools) ? (obj.thinking_tools as string[]) : [];
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0.6;

  const toastBits: string[] = [];
  toastBits.push(`depth=${depth}`);
  if (reasoning_profile !== "standard") toastBits.push(`reasoning=${reasoning_profile}`);
  if (thinking_tools.length) toastBits.push(`tools=${thinking_tools.slice(0, 2).join("+")}`);

  return {
    v: "0.1",
    ts: new Date().toISOString(),
    userMessageId,
    depth,
    reasoning_profile,
    verbosity,
    capabilities,
    thinking_tools,
    confidence,
    source: "openai",
    toast: {
      message: `Hint: ${toastBits.join(" ")}`,
      variant: "info",
      durationMs: 5000,
    },
  };
  } finally {
    // Best-effort cleanup.
    void fetch(`${base}/session/${sid}`, {
      method: 'DELETE',
      headers: { ...(auth ? { Authorization: auth } : {}) },
    }).catch(() => {});
    opts.unignoreSession?.(sid);
  }
}

export async function classifyPromptHint(
  prompt: string,
  userMessageId: string,
  opts?: {
    serverUrl?: string;
    ignoreSession?: (sessionId: string) => void;
    unignoreSession?: (sessionId: string) => void;
    client?: CarrierClient;
    directory?: string;
  }
): Promise<PromptHint> {
  // Always provide a fast heuristic hint immediately.
  const base = heuristic(prompt, userMessageId);
  try {
    if (opts?.serverUrl) {
      const refined = await openCodeClassify(opts.serverUrl, prompt, userMessageId, {
        ignoreSession: opts.ignoreSession,
        unignoreSession: opts.unignoreSession,
        client: opts.client,
        directory: opts.directory,
      });
      return refined ?? base;
    }
    const refined = await openAiClassify(prompt, userMessageId);
    return refined ?? base;
  } catch {
    return base;
  }
}
