import { tool, type ToolContext } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

import { getIdentity } from "../../lib/identity";
import { getPaiDir } from "../../lib/pai-runtime";

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

type VoiceNotifyResult = {
  ok: true;
  sent?: true;
  skipped?: string;
  status?: number;
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

function getContextDirectory(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { directory?: unknown }).directory;
  return typeof value === "string" ? value : "";
}

function getBackgroundTaskStatePath(): string {
  return path.join(getPaiDir(), "MEMORY", "STATE", "background-tasks.json");
}

function isKnownBackgroundChildSession(sessionId: string): boolean {
  try {
    const statePath = getBackgroundTaskStatePath();
    if (!fs.existsSync(statePath)) {
      return false;
    }

    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = asRecord(JSON.parse(raw));
    const tasks = asRecord(parsed.backgroundTasks);
    for (const record of Object.values(tasks)) {
      const task = asRecord(record);
      if (getString(task, "child_session_id") === sessionId || getString(task, "childSessionId") === sessionId) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function getVoiceNotifyUrl(): string | null {
  const notifyUrl = process.env.PAI_VOICE_NOTIFY_URL?.trim();
  if (notifyUrl) {
    return notifyUrl;
  }

  const serverUrl = process.env.PAI_VOICE_SERVER_URL?.trim();
  if (serverUrl) {
    return serverUrl.endsWith("/notify") ? serverUrl : `${serverUrl.replace(/\/$/, "")}/notify`;
  }

  // Backward-compatible default used by the local VoiceServer.
  return "http://localhost:8888/notify";
}

function extractParentSessionId(sessionGetResult: unknown): string | undefined {
  const result = asRecord(sessionGetResult);
  const data = asRecord(result.data);
  const info = asRecord(data.info ?? result.info);

  return (
    getString(info, "parentID") ??
    getString(info, "parentId") ??
    getString(data, "parentID") ??
    getString(data, "parentId") ??
    getString(result, "parentID") ??
    getString(result, "parentId")
  );
}

type SessionGateResult = {
  isSubagent: boolean;
  reason?: string;
};

async function classifySession(sessionId: string, directory: string, client: CarrierClient): Promise<SessionGateResult> {
  const get = client.session?.get;
  if (typeof get !== "function") {
    return isKnownBackgroundChildSession(sessionId)
      ? { isSubagent: true, reason: "known_background_child" }
      : { isSubagent: false, reason: "session_get_unavailable_root_assumed" };
  }

  try {
    const options: Record<string, unknown> = {
      path: { id: sessionId },
    };
    if (directory) {
      options.query = { directory };
    }
    const session = await get(options);

    const resultRecord = asRecord(session);
    const hasError = resultRecord.error != null;
    const dataRecord = asRecord(resultRecord.data);
    const hasData = Object.keys(dataRecord).length > 0;
    if (hasError && !hasData) {
      return isKnownBackgroundChildSession(sessionId)
        ? { isSubagent: true, reason: "known_background_child" }
        : { isSubagent: false, reason: "session_lookup_failed_root_assumed" };
    }

    if (extractParentSessionId(session)) {
      return { isSubagent: true, reason: "session_has_parent" };
    }
    return { isSubagent: false };
  } catch {
    return isKnownBackgroundChildSession(sessionId)
      ? { isSubagent: true, reason: "known_background_child" }
      : { isSubagent: false, reason: "session_lookup_failed_root_assumed" };
  }
}

function result(value: VoiceNotifyResult): string {
  return JSON.stringify(value);
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
        return result({ ok: true, skipped: "voice_disabled" });
      }

      if (process.env.PAI_NO_NETWORK === "1") {
        return result({ ok: true, skipped: "no_network" });
      }

      const sessionId = getContextSessionId(ctx);
      if (!sessionId) {
        return result({ ok: true, skipped: "missing_session_id" });
      }

      const directory = getContextDirectory(ctx);

      const sessionGate = await classifySession(sessionId, directory, client);
      if (sessionGate.isSubagent) {
        return result({ ok: true, skipped: sessionGate.reason ?? "subagent_session" });
      }

      const url = getVoiceNotifyUrl();
      if (!url) {
        return result({ ok: true, skipped: "missing_notify_url" });
      }

      const message = args.message?.trim();
      if (!message) {
        return result({ ok: true, skipped: "empty_message" });
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
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: abortController?.signal,
        });

        const status =
          typeof (response as { status?: unknown })?.status === "number"
            ? Number((response as { status: number }).status)
            : undefined;
        if (status !== undefined && status >= 400) {
          return result({ ok: true, skipped: `notify_http_${status}`, status });
        }

        return status !== undefined ? result({ ok: true, sent: true, status }) : result({ ok: true, sent: true });
      } catch {
        // Best-effort by design.
        return result({ ok: true, skipped: "fetch_error" });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
