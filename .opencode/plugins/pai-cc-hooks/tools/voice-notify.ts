import { tool, type ToolContext } from "@opencode-ai/plugin";

import { getIdentity } from "../../lib/identity";

type CarrierClient = {
  session?: {
    get?: (options: unknown) => Promise<unknown>;
  };
};

type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

type VoiceNotifyArgs = {
  message: string;
  title?: string;
  voice_id?: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function getString(obj: UnknownRecord, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function getContextSessionId(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown }).sessionID ??
    (ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : "";
}

function getVoiceNotifyUrl(): string | null {
  const notifyUrl = process.env.PAI_VOICE_NOTIFY_URL?.trim();
  if (notifyUrl) {
    return notifyUrl;
  }

  const serverUrl = process.env.PAI_VOICE_SERVER_URL?.trim();
  if (!serverUrl) {
    return null;
  }

  return serverUrl.endsWith("/notify") ? serverUrl : `${serverUrl.replace(/\/$/, "")}/notify`;
}

function extractParentSessionId(sessionGetResult: unknown): string | undefined {
  const session = asRecord(sessionGetResult);
  const info = asRecord(session.info);

  return (
    getString(info, "parentID") ??
    getString(info, "parentId") ??
    getString(session, "parentID") ??
    getString(session, "parentId")
  );
}

async function isSubagentSession(sessionId: string, client: CarrierClient): Promise<boolean> {
  const get = client.session?.get;
  if (typeof get !== "function") {
    return true; // fail closed
  }

  try {
    const session = await get({ path: { id: sessionId } });
    return Boolean(extractParentSessionId(session));
  } catch {
    return true; // fail closed
  }
}

export function createPaiVoiceNotifyTool(input: { client: unknown; fetchImpl?: FetchLike }) {
  const client = (input.client ?? {}) as CarrierClient;
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));

  return tool({
    description: "Send a voice notification (PAI)",
    args: {
      message: tool.schema.string(),
      title: tool.schema.string().optional(),
      voice_id: tool.schema.string().optional(),
    },
    async execute(args: VoiceNotifyArgs, ctx: ToolContext): Promise<string> {
      if (process.env.PAI_DISABLE_VOICE === "1") {
        return JSON.stringify({ ok: true });
      }

      if (process.env.PAI_NO_NETWORK === "1") {
        return JSON.stringify({ ok: true });
      }

      const sessionId = getContextSessionId(ctx);
      if (!sessionId) {
        return JSON.stringify({ ok: true });
      }

      if (await isSubagentSession(sessionId, client)) {
        return JSON.stringify({ ok: true });
      }

      const url = getVoiceNotifyUrl();
      if (!url) {
        return JSON.stringify({ ok: true });
      }

      const message = args.message?.trim();
      if (!message) {
        return JSON.stringify({ ok: true });
      }

      const identity = getIdentity();
      const title = args.title?.trim() || `${identity.name} says`;
      const voiceId = args.voice_id?.trim() || identity.voiceId || undefined;

      const payload: Record<string, unknown> = {
        message,
        title,
      };
      if (voiceId) {
        payload.voice_id = voiceId;
      }

      const abortController = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = setTimeout(() => abortController?.abort(), 1_000);

      try {
        await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: abortController?.signal,
        });
      } catch {
        // Best-effort by design.
      } finally {
        clearTimeout(timeout);
      }

      return JSON.stringify({ ok: true });
    },
  });
}
