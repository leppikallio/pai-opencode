import { tool, type ToolContext } from "@opencode-ai/plugin";

import {
  findBackgroundTaskByTaskId,
  type BackgroundTaskRecord,
} from "./background-task-state";
import {
  normalizeBackgroundTaskLifecycle,
  isBackgroundTaskTerminal,
} from "../background/lifecycle-normalizer";

type CarrierClient = {
  session?: {
    messages?: (options: unknown) => Promise<unknown>;
  };
};

type BackgroundOutputArgs = {
  task_id: string;
  block?: boolean;
  timeout?: number;
  full_session?: boolean;
  include_thinking?: boolean;
  message_limit?: number;
  since_message_id?: string;
  include_tool_results?: boolean;
  thinking_max_chars?: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getAnyProp(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getContextDirectory(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { directory?: unknown }).directory;
  return typeof value === "string" ? value : process.cwd();
}

function extractMessages(response: unknown): Array<{ info: JsonRecord; parts: unknown[] }> {
  const data = getAnyProp(response, "data");
  const payload = Array.isArray(data) ? data : Array.isArray(response) ? response : [];

  return payload
    .filter((item): item is JsonRecord => isRecord(item))
    .map((item) => {
      const info = (getAnyProp(item, "info") as JsonRecord) ?? {};
      const partsRaw = getAnyProp(item, "parts");
      const parts = Array.isArray(partsRaw) ? partsRaw : [];
      return { info, parts };
    });
}

function formatParts(parts: unknown[], opts: {
  includeThinking: boolean;
  includeToolResults: boolean;
  thinkingMaxChars: number;
}): string {
  const out: string[] = [];

  for (const part of parts) {
    if (!isRecord(part)) continue;
    const type = asString(part.type);

    if (type === "text") {
      const text = asString(part.text);
      if (text) out.push(text);
      continue;
    }

    if (type === "reasoning" && opts.includeThinking) {
      let text = asString(part.text);
      if (!text) continue;
      if (text.length > opts.thinkingMaxChars) {
        text = `${text.slice(0, opts.thinkingMaxChars)}…`;
      }
      out.push(text);
      continue;
    }

    if ((type === "tool_result" || type === "tool_use") && opts.includeToolResults) {
      const text = asString(part.text);
      if (text) out.push(text);
    }
  }

  return out.join("").trim();
}

function roleLabel(info: JsonRecord): string {
  const role = asString(info.role).trim();
  if (role === "user" || role === "assistant" || role === "system") return role;
  return role || "unknown";
}

function sliceSinceMessageId(
  messages: Array<{ info: JsonRecord; parts: unknown[] }>,
  sinceMessageId?: string,
): { sliced: Array<{ info: JsonRecord; parts: unknown[] }>; found: boolean } {
  const marker = sinceMessageId?.trim();
  if (!marker) return { sliced: messages, found: true };

  const idx = messages.findIndex((m) => asString(m.info.id) === marker);
  if (idx === -1) return { sliced: messages, found: false };
  return { sliced: messages.slice(idx + 1), found: true };
}

async function waitForCompletion(args: { taskId: string; timeoutMs: number }): Promise<BackgroundTaskRecord | null> {
  const start = Date.now();
  while (Date.now() - start < args.timeoutMs) {
    const record = await findBackgroundTaskByTaskId({ taskId: args.taskId });
    if (!record) return null;
    if (isBackgroundTaskTerminal(record)) return record;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return findBackgroundTaskByTaskId({ taskId: args.taskId });
}

export function createPaiBackgroundOutputTool(input: { client: unknown }) {
  const client = (input.client ?? {}) as CarrierClient;

  return tool({
    description: "Retrieve output from a background task (PAI)",
    args: {
      task_id: tool.schema.string(),
      block: tool.schema.boolean().optional(),
      timeout: tool.schema.number().optional(),
      full_session: tool.schema.boolean().optional(),
      include_thinking: tool.schema.boolean().optional(),
      message_limit: tool.schema.number().optional(),
      since_message_id: tool.schema.string().optional(),
      include_tool_results: tool.schema.boolean().optional(),
      thinking_max_chars: tool.schema.number().optional(),
    },
    async execute(args: BackgroundOutputArgs, ctx: ToolContext): Promise<string> {
      const taskId = args.task_id.trim();
      if (!taskId) {
        return "Task not found: ";
      }

      const shouldBlock = args.block === true;
      const timeoutMs = Math.min(Math.max(asNumber(args.timeout) ?? 60_000, 1_000), 600_000);
      const record = shouldBlock
        ? await waitForCompletion({ taskId, timeoutMs })
        : await findBackgroundTaskByTaskId({ taskId });

      if (!record) {
        return `Task not found: ${taskId}`;
      }

      const lifecycle = normalizeBackgroundTaskLifecycle(record);
      const status = lifecycle.status;
      const fullSession = args.full_session ?? true;
      const messageLimit = Math.min(Math.max(asNumber(args.message_limit) ?? 50, 1), 100);
      const taskActive = !lifecycle.isTerminal;
      const includeThinking = typeof args.include_thinking === "boolean" ? args.include_thinking : taskActive;
      const includeToolResults =
        typeof args.include_tool_results === "boolean" ? args.include_tool_results : taskActive;
      const thinkingMaxChars = Math.min(Math.max(asNumber(args.thinking_max_chars) ?? 2000, 200), 10_000);

      const headerLines = [
        `Task ID: ${record.task_id}`,
        `Session ID: ${record.child_session_id}`,
        `Status: ${status}`,
      ];
      if (lifecycle.terminalReason) {
        headerLines.push(`Terminal reason: ${lifecycle.terminalReason}`);
      }
      if (record.concurrency_group) {
        headerLines.push(`Concurrency group: ${record.concurrency_group}`);
      }
      if (record.launch_error) {
        headerLines.push(`Launch error: ${record.launch_error}`);
      }

      const session = client.session;
      if (!session?.messages) {
        return `${headerLines.join("\n")}\n\n(no client.session.messages available)`;
      }

      let messagesResult: unknown;
      try {
        messagesResult = await session.messages({
          path: { id: record.child_session_id },
          query: {
            directory: getContextDirectory(ctx),
            limit: messageLimit,
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `${headerLines.join("\n")}\n\nError fetching messages: ${msg}`;
      }

      let messages = extractMessages(messagesResult);
      const sliced = sliceSinceMessageId(messages, args.since_message_id);
      if (!sliced.found) {
        const marker = args.since_message_id?.trim() ?? "";
        return `${headerLines.join("\n")}\n\nError: since_message_id not found in fetched messages: ${marker}`;
      }
      messages = sliced.sliced;

      if (!fullSession) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (asString(messages[i]?.info.role) !== "assistant") continue;
          const text = formatParts(messages[i]?.parts ?? [], {
            includeThinking,
            includeToolResults,
            thinkingMaxChars,
          });
          if (text) {
            return `${headerLines.join("\n")}\n\n${text}`;
          }
        }

        return `${headerLines.join("\n")}\n\n(no assistant text yet)`;
      }

      const rendered = messages
        .map((m) => {
          const label = roleLabel(m.info);
          const text = formatParts(m.parts, {
            includeThinking,
            includeToolResults,
            thinkingMaxChars,
          });
          if (!text) return null;
          return `[${label}]\n${text}`;
        })
        .filter((x): x is string => Boolean(x))
        .join("\n\n");

      const body = rendered || "(no message text yet)";
      return `${headerLines.join("\n")}\n\n--- Messages (${messages.length}) ---\n\n${body}`;
    },
  });
}
