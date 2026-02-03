import * as fs from "node:fs";
import * as path from "node:path";
import { fileLogError } from "../lib/file-logger";
import { ensureDir, getLearningDir, getStateDir, getYearMonth, getTimestamp, slugify } from "../lib/paths";
import { getLearningCategory } from "../lib/learning-utils";
import { detectRating } from "./rating-capture";

export type SentimentPolarity = "positive" | "negative" | "neutral";

export type ImplicitSentimentEntry = {
  timestamp: string;
  rating: number;
  // Compatibility field (older code used score)
  score?: number;
  session_id: string;
  source: "implicit";
  sentiment_summary: string;
  confidence: number;
  user_message_id?: string;
};

type SentimentResult = {
  rating: number | null;
  sentiment: SentimentPolarity;
  confidence: number;
  summary: string;
  detailed_context?: string;
};

const DEFAULT_MIN_CONFIDENCE = 0.5;
const ENABLE_FALLBACK = process.env.PAI_IMPLICIT_SENTIMENT_FALLBACK !== "0";

function getMinConfidence(): number {
  const raw = process.env.PAI_IMPLICIT_SENTIMENT_MIN_CONFIDENCE;
  if (!raw) return DEFAULT_MIN_CONFIDENCE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MIN_CONFIDENCE;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function writeImplicitSentimentDebug(record: Record<string, unknown>): Promise<void> {
  if (process.env.PAI_DEBUG !== "1") return;
  try {
    const stateDir = getStateDir();
    await ensureDir(stateDir);
    const filePath = path.join(stateDir, "implicit-sentiment-last.json");
    await fs.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  } catch {
    // ignore debug write failures
  }
}

type OpenCodeSessionCreateResponse = { id?: string };
type OpenCodePromptResponse = { parts?: Array<{ type?: string; text?: string }> };

type CarrierClient = {
  session?: {
    create?: (options?: unknown) => Promise<unknown>;
    prompt?: (options: unknown) => Promise<unknown>;
    delete?: (options: unknown) => Promise<unknown>;
    messages?: (options?: unknown) => Promise<unknown>;
  };
  event?: {
    subscribe?: (options?: unknown) => Promise<{ stream: AsyncIterable<unknown> }>;
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

function startEventCollector(
  client: CarrierClient,
  sessionId: string,
  timeoutMs = 2000
): { promise: Promise<string>; abort: () => void } {
  const controller = new AbortController();
  const promise = (async () => {
    if (!client.event?.subscribe) return "";
    try {
      const events = await client.event.subscribe({ signal: controller.signal });
      const collected = new Map<string, string>();
      const started = Date.now();
      for await (const event of events.stream) {
        if (Date.now() - started > timeoutMs) break;
        const e = event as { type?: string; properties?: { part?: { sessionID?: string; id?: string; type?: string; text?: string; time?: { end?: number } } } };
        if (e?.type !== "message.part.updated") continue;
        const part = e.properties?.part;
        if (!part || part.sessionID !== sessionId) continue;
        if ((part.type === "text" || part.type === "reasoning") && part.text) {
          collected.set(part.id ?? `${part.type}:${collected.size}`, part.text);
          if (part.time?.end) {
            break;
          }
        }
      }
      return Array.from(collected.values()).join("");
    } catch {
      return "";
    }
  })();

  const abort = () => controller.abort();
  return { promise, abort };
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

function shouldAnalyzeImplicitSentiment(message: string): boolean {
  const s = message.trim();
  if (s.length < 3) return false;
  if (s.length > 600) return false;

  // Skip if explicit rating.
  if (detectRating(s)) return false;

  const lower = s.toLowerCase();

  // High-signal affect / evaluation markers.
  const markers = [
    "thanks",
    "thank you",
    "perfect",
    "amazing",
    "incredible",
    "great",
    "awesome",
    "excellent",
    "love",
    "nailed",
    "works now",
    "this is wrong",
    "not right",
    "doesn't work",
    "doesnt work",
    "broken",
    "wtf",
    "what the fuck",
    "fuck",
    "frustr",
    "annoy",
    "disappoint",
    "bad",
    "terrible",
    "horrible",
  ];

  for (const m of markers) {
    if (lower.includes(m)) return true;
  }

  // Strong punctuation often correlates with affect.
  if (/[!?]{2,}/.test(s)) return true;

  return false;
}

function classifyHeuristic(message: string): { rating: number; summary: string } | null {
  const lower = message.toLowerCase();
  const positive = [
    "thanks",
    "thank you",
    "perfect",
    "amazing",
    "incredible",
    "great",
    "awesome",
    "excellent",
    "love",
    "nailed",
    "works now",
    "fixed",
  ];
  const negative = [
    "this is wrong",
    "not right",
    "doesn't work",
    "doesnt work",
    "broken",
    "wtf",
    "what the fuck",
    "fuck",
    "frustr",
    "annoy",
    "disappoint",
    "bad",
    "terrible",
    "horrible",
  ];

  let score = 0;
  for (const m of positive) if (lower.includes(m)) score += 1;
  for (const m of negative) if (lower.includes(m)) score -= 1;

  if (score === 0) {
    if (/[!?]{2,}/.test(message)) score = 1;
  }

  if (score === 0) return null;
  const rating = score > 0 ? 8 : 3;
  return {
    rating,
    summary: score > 0 ? "positive heuristic" : "negative heuristic",
  };
}

async function runCarrierJson(args: {
  serverUrl: string;
  systemPrompt: string;
  userPrompt: string;
  client?: CarrierClient;
  directory?: string;
  ignoreSession?: (sid: string) => void;
  unignoreSession?: (sid: string) => void;
}): Promise<unknown> {
  const { serverUrl, systemPrompt, userPrompt } = args;
  const timeoutMs = 2500;
  const start = Date.now();

  const directory = args.directory;
  if (args.client?.session?.create && args.client?.session?.prompt && args.client?.session?.delete) {
    const createRes = await args.client.session.create({
      query: directory ? { directory } : undefined,
      body: {
        title: "[PAI INTERNAL] ImplicitSentiment",
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      },
    });

    const createErr = getAnyProp(createRes, "error");
    if (createErr) {
      throw new Error(`carrier session create error: ${JSON.stringify(createErr).slice(0, 500)}`);
    }

    const sid = getStringProp(getRecordProp(createRes, "data"), "id");
    if (!sid) throw new Error("carrier session create returned no id");
    args.ignoreSession?.(sid);

    let collector: { promise: Promise<string>; abort: () => void } | null = null;
    try {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 250) throw new Error("carrier timed out before prompt");

      collector = startEventCollector(args.client, sid, remaining + 500);

      const promptRes = await args.client.session.prompt({
        path: { id: sid },
        query: directory ? { directory } : undefined,
        body: {
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: false,
          variant: "minimal",
          system: systemPrompt,
          parts: [{ type: "text", text: userPrompt }],
          tools: {},
        },
      });

      const promptErr = getAnyProp(promptRes, "error");
      if (promptErr) {
        throw new Error(`carrier prompt error: ${JSON.stringify(promptErr).slice(0, 800)}`);
      }

      const data = getRecordProp(promptRes, "data") as unknown;
      const resp = (isRecord(data) ? (data as OpenCodePromptResponse) : undefined);
      let text = resp ? extractAssistantText(resp) : "";
      if (!text) {
        const fallback = await tryParseResponseBody(getAnyProp(promptRes, "response"));
        if (fallback) {
          text = extractAssistantText(fallback);
        }
      }
      if (!text) {
        text = await pollForAssistantText(args.client, sid, directory);
      }
      if (!text && collector) {
        text = await collector.promise;
      }
      if (!text) {
        const parts = resp && Array.isArray(resp.parts) ? resp.parts : [];
        const types = parts.map((p) => (p && typeof p.type === "string" ? p.type : "?")).slice(0, 10);
        throw new Error(`carrier returned empty output (parts=${parts.length} types=${types.join(",")})`);
      }
      const candidate = findJsonCandidate(text);
      if (!candidate) throw new Error("carrier returned non-JSON output");
      return JSON.parse(candidate);
    } finally {
      collector?.abort();
      void args.client.session
        .delete({
          path: { id: sid },
          query: directory ? { directory } : undefined,
        })
        .catch(() => {});
      args.unignoreSession?.(sid);
    }
  }

  // Network fallback.
  const base = serverUrl.replace(/\/$/, "");
  const auth = basicAuthHeader();

  const createRes = await fetchWithTimeout(
    `${base}/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({
        title: "[PAI INTERNAL] ImplicitSentiment",
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      }),
    },
    timeoutMs
  );

  if (!createRes.ok) {
    throw new Error(`carrier session create failed (${createRes.status})`);
  }

  const createJson = (await createRes.json().catch(() => ({}))) as OpenCodeSessionCreateResponse;
  const sid = typeof createJson.id === "string" ? createJson.id : null;
  if (!sid) throw new Error("carrier session create returned no id");

  try {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 250) throw new Error("carrier timed out before prompt");

    const promptRes = await fetchWithTimeout(
      `${base}/session/${sid}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({
          model: { providerID: "openai", modelID: "gpt-5.2" },
          system: systemPrompt,
          parts: [{ type: "text", text: userPrompt }],
          tools: {},
        }),
      },
      remaining
    );

    if (!promptRes.ok) {
      throw new Error(`carrier prompt failed (${promptRes.status})`);
    }

    const resp = (await promptRes.json().catch(() => ({}))) as OpenCodePromptResponse;
    const text = extractAssistantText(resp);
    if (!text) throw new Error("carrier returned empty output");
    const candidate = findJsonCandidate(text);
    if (!candidate) throw new Error("carrier returned non-JSON output");
    return JSON.parse(candidate);
  } finally {
    void fetch(`${base}/session/${sid}`, {
      method: "DELETE",
      headers: { ...(auth ? { Authorization: auth } : {}) },
    }).catch(() => {});
  }
}

function clampRating(n: number): number {
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.round(n);
}

async function writeImplicitSentiment(entry: ImplicitSentimentEntry): Promise<void> {
  const learningDir = getLearningDir();
  const signalsDir = path.join(learningDir, "SIGNALS");
  await ensureDir(signalsDir);
  const ratingsFile = path.join(signalsDir, "ratings.jsonl");
  await fs.promises.appendFile(ratingsFile, `${JSON.stringify(entry)}\n`);
}

async function captureLowSentimentLearning(
  rating: number,
  summary: string,
  detailedContext: string,
  sessionId: string
): Promise<void> {
  // Keep this conservative; avoid spamming learnings for mild negativity.
  if (rating >= 6) return;

  const category = getLearningCategory(detailedContext, summary);
  const learningDir = getLearningDir();
  const yearMonth = getYearMonth();
  const timestamp = getTimestamp();
  const targetDir = path.join(learningDir, category, yearMonth);
  await ensureDir(targetDir);

  const slug = slugify(summary.slice(0, 60));
  const filename = `${timestamp}_sentiment_${slug}.md`;
  const filepath = path.join(targetDir, filename);

  const content = `---
capture_type: LEARNING
timestamp: ${new Date().toISOString()}
rating: ${rating}
source: implicit-sentiment
session_id: ${sessionId}
tags: [implicit-sentiment, improvement-opportunity]
---

# Implicit Sentiment Learning: ${rating}/10

## Summary

${summary}

## Detailed Context

${detailedContext}
`;

  await fs.promises.writeFile(filepath, content);
}

export async function maybeCaptureImplicitSentiment(opts: {
  sessionId: string;
  userMessageId: string;
  userText: string;
  serverUrl: string;
  assistantContext?: string;
  client?: CarrierClient;
  directory?: string;
  ignoreSession?: (sid: string) => void;
  unignoreSession?: (sid: string) => void;
}): Promise<void> {
  try {
    const { sessionId, userMessageId, userText, serverUrl, assistantContext } = opts;
    const trimmed = userText.trim();

    if (!shouldAnalyzeImplicitSentiment(trimmed)) {
      await writeImplicitSentimentDebug({
        ts: new Date().toISOString(),
        sessionId,
        userMessageId,
        step: "skipped:heuristic",
        text: trimmed,
      });
      return;
    }

    const systemPrompt = [
      "You are a sentiment classifier for a personal AI system.",
      "Analyze the user's message for sentiment towards the assistant's work.",
      "Return ONLY valid JSON:",
      "{",
      '  "rating": <1-10 or null>,',
      '  "sentiment": "positive"|"negative"|"neutral",',
      '  "confidence": <0.0-1.0>,',
      '  "summary": "<10 words max>",',
      '  "detailed_context": "<80-200 words>"',
      "}",
      "If there is no clear evaluation/affect towards the assistant, return rating=null and sentiment=neutral.",
    ].join("\n");

    const userPrompt = assistantContext
      ? `ASSISTANT_CONTEXT:\n${assistantContext}\n\nUSER_MESSAGE:\n${trimmed}`
      : trimmed;

    const parsed = (await runCarrierJson({
      serverUrl,
      systemPrompt,
      userPrompt,
      client: opts.client,
      directory: opts.directory,
      ignoreSession: opts.ignoreSession,
      unignoreSession: opts.unignoreSession,
    })) as Partial<SentimentResult>;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const ratingRaw = typeof parsed.rating === "number" ? parsed.rating : null;
    const sentiment =
      parsed.sentiment === "positive" || parsed.sentiment === "negative" || parsed.sentiment === "neutral"
        ? parsed.sentiment
        : "neutral";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const detailedContext = typeof parsed.detailed_context === "string" ? parsed.detailed_context.trim() : "";

    await writeImplicitSentimentDebug({
      ts: new Date().toISOString(),
      sessionId,
      userMessageId,
      step: "parsed",
      confidence,
      ratingRaw,
      sentiment,
      summary,
    });

    // Require a minimum confidence and a concrete rating.
    const minConfidence = getMinConfidence();
    if (confidence < minConfidence) {
      await writeImplicitSentimentDebug({
        ts: new Date().toISOString(),
        sessionId,
        userMessageId,
        step: "skipped:low_confidence",
        confidence,
        minConfidence,
        ratingRaw,
        sentiment,
      });
      return;
    }
    if (ratingRaw === null) {
      await writeImplicitSentimentDebug({
        ts: new Date().toISOString(),
        sessionId,
        userMessageId,
        step: "skipped:null_rating",
        confidence,
        minConfidence,
        sentiment,
      });
      return;
    }
    const rating = clampRating(ratingRaw);

    const entry: ImplicitSentimentEntry = {
      timestamp: new Date().toISOString(),
      rating,
      score: rating,
      session_id: sessionId,
      source: "implicit",
      sentiment_summary: summary || `${sentiment} sentiment`,
      confidence,
      user_message_id: userMessageId,
    };

    await writeImplicitSentiment(entry);
    await captureLowSentimentLearning(rating, entry.sentiment_summary, detailedContext, sessionId);

    await writeImplicitSentimentDebug({
      ts: new Date().toISOString(),
      sessionId,
      userMessageId,
      step: "written",
      entry,
    });
  } catch (error) {
    if (ENABLE_FALLBACK) {
      const fallback = classifyHeuristic(opts.userText);
      if (fallback) {
        const rating = clampRating(fallback.rating);
        const entry: ImplicitSentimentEntry = {
          timestamp: new Date().toISOString(),
          rating,
          score: rating,
          session_id: opts.sessionId,
          source: "implicit",
          sentiment_summary: fallback.summary,
          confidence: Math.max(getMinConfidence(), 0.7),
          user_message_id: opts.userMessageId,
        };
        await writeImplicitSentiment(entry);
        await writeImplicitSentimentDebug({
          ts: new Date().toISOString(),
          sessionId: opts.sessionId,
          userMessageId: opts.userMessageId,
          step: "fallback_written",
          entry,
        });
        return;
      }
    }
    await writeImplicitSentimentDebug({
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      userMessageId: opts.userMessageId,
      step: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    fileLogError("Implicit sentiment capture failed", error);
  }
}

export async function runImplicitSentimentSelftest(): Promise<ImplicitSentimentEntry> {
  const entry: ImplicitSentimentEntry = {
    timestamp: new Date().toISOString(),
    rating: 8,
    score: 8,
    session_id: "selftest",
    source: "implicit",
    sentiment_summary: "selftest implicit sentiment",
    confidence: 1,
    user_message_id: "selftest",
  };
  await writeImplicitSentiment(entry);
  return entry;
}
