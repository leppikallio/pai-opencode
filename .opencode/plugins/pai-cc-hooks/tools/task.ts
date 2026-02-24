import { tool, type ToolContext } from "@opencode-ai/plugin";

import {
  recordBackgroundTaskLaunch as recordBackgroundTaskLaunchDefault,
  recordBackgroundTaskLaunchError as recordBackgroundTaskLaunchErrorDefault,
  type RecordBackgroundTaskLaunchArgs,
  type RecordBackgroundTaskLaunchErrorArgs,
} from "./background-task-state";

type CarrierClient = {
  session?: {
    get?: (options: unknown) => Promise<unknown>;
    create?: (options?: unknown) => Promise<unknown>;
    prompt?: (options: unknown) => Promise<unknown>;
  };
};

type TaskToolArgs = {
  description: string;
  prompt: string;
  subagent_type: string;
  command?: string;
  task_id?: string;
  run_in_background?: boolean;
};

type RecordBackgroundTaskLaunchFn = (args: RecordBackgroundTaskLaunchArgs) => Promise<void>;
type RecordBackgroundTaskLaunchErrorFn = (args: RecordBackgroundTaskLaunchErrorArgs) => Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAnyProp(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function resultHasError(result: unknown): boolean {
  return isRecord(result) && getAnyProp(result, "error") != null;
}

function extractSessionId(result: unknown): string {
  const data = getAnyProp(result, "data");
  const fromData = getStringProp(data, "id");
  if (fromData) return fromData;
  return getStringProp(result, "id") ?? "";
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part) =>
        isRecord(part) &&
        (part.type === "text" || part.type === "reasoning") &&
        typeof part.text === "string",
    )
    .map((part) => String((part as { text: string }).text))
    .join("")
    .trim();
}

async function extractAssistantText(promptResult: unknown): Promise<string> {
  const data = getAnyProp(promptResult, "data");
  const fromData = extractTextFromParts(getAnyProp(data, "parts"));
  if (fromData) return fromData;

  const fromRoot = extractTextFromParts(getAnyProp(promptResult, "parts"));
  if (fromRoot) return fromRoot;

  const response = getAnyProp(promptResult, "response");
  if (!isRecord(response)) return "";
  const responseText = response.text;
  if (typeof responseText !== "function") return "";

  try {
    const raw = await responseText.call(response);
    if (typeof raw !== "string" || !raw.trim()) return "";
    const parsed = JSON.parse(raw);
    const fromParsedData = extractTextFromParts(getAnyProp(getAnyProp(parsed, "data"), "parts"));
    if (fromParsedData) return fromParsedData;
    return extractTextFromParts(getAnyProp(parsed, "parts"));
  } catch {
    return "";
  }
}

async function resolveChildSessionId(args: TaskToolArgs, client: CarrierClient): Promise<string> {
  const session = client.session;
  if (!session?.create) {
    throw new Error("PAI task override: client.session.create is unavailable");
  }

  const requestedTaskId = args.task_id?.trim();
  if (requestedTaskId) {
    if (typeof session.get === "function") {
      try {
        const getResult = await session.get({ path: { id: requestedTaskId } });
        if (!resultHasError(getResult)) {
          return extractSessionId(getResult) || requestedTaskId;
        }
      } catch {
        // Fall through to create for best-effort behavior.
      }
    } else {
      return requestedTaskId;
    }
  }

  const createResult = await session.create({ body: { title: args.description } });
  const createdId = extractSessionId(createResult);
  if (!createdId) {
    throw new Error("PAI task override: child session creation returned no id");
  }
  return createdId;
}

function formatTaskResult(taskId: string, text: string): string {
  return `task_id: ${taskId}\n<task_result>${text}</task_result>`;
}

function getContextSessionId(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown }).sessionID ??
    (ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : "";
}

function getContextDirectory(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { directory?: unknown }).directory;
  return typeof value === "string" ? value : process.cwd();
}

export function createPaiTaskTool(input: {
  client: unknown;
  $: unknown;
  recordBackgroundTaskLaunch?: RecordBackgroundTaskLaunchFn;
  recordBackgroundTaskLaunchError?: RecordBackgroundTaskLaunchErrorFn;
}) {
  const client = (input.client ?? {}) as CarrierClient;
  const recordBackgroundTaskLaunch = input.recordBackgroundTaskLaunch ?? recordBackgroundTaskLaunchDefault;
  const recordBackgroundTaskLaunchError =
    input.recordBackgroundTaskLaunchError ?? recordBackgroundTaskLaunchErrorDefault;

  return tool({
    description: "Run a subagent task (supports run_in_background)",
    args: {
      description: tool.schema.string(),
      prompt: tool.schema.string(),
      subagent_type: tool.schema.string(),
      command: tool.schema.string().optional(),
      task_id: tool.schema.string().optional(),
      run_in_background: tool.schema.boolean().optional(),
    },
    async execute(args: TaskToolArgs, ctx: ToolContext): Promise<string> {
      if (args.run_in_background === true) {
        const parentSessionId = getContextSessionId(ctx);
        if (!parentSessionId) {
          throw new Error("PAI task override: ctx.sessionID is required for run_in_background=true");
        }

        const session = client.session;
        if (!session?.create) {
          throw new Error("PAI task override: client.session.create is unavailable");
        }
        if (!session.prompt) {
          throw new Error("PAI task override: client.session.prompt is unavailable");
        }

        const childCreateResult = await session.create({
          body: {
            parentID: parentSessionId,
            title: args.description,
          },
          query: {
            directory: getContextDirectory(ctx),
          },
        });

        const childSessionId = extractSessionId(childCreateResult);
        if (!childSessionId) {
          throw new Error("PAI task override: child session creation returned no id");
        }

        await recordBackgroundTaskLaunch({
          taskId: childSessionId,
          childSessionId,
          parentSessionId,
        });

        void session
          .prompt({
            path: { id: childSessionId },
            body: {
              agent: args.subagent_type,
              parts: [{ type: "text", text: args.prompt }],
            },
          })
          .catch(async (promptError) => {
            const errorMessage =
              promptError instanceof Error
                ? promptError.message
                : typeof promptError === "string"
                  ? promptError
                  : String(promptError);
            const normalizedMessage = errorMessage.trim() || "Unknown background prompt launch error";

            try {
              await recordBackgroundTaskLaunchError({
                taskId: childSessionId,
                errorMessage: normalizedMessage,
              });
            } catch {
              // Best effort error marker persistence.
            }
          });

        return { task_id: childSessionId, session_id: childSessionId } as unknown as string;
      }

      const ask = (ctx as ToolContext & { ask?: (request: unknown) => Promise<unknown> }).ask;
      if (typeof ask !== "function") {
        throw new Error("PAI task override: ctx.ask is unavailable");
      }

      await ask({
        permission: "task",
        patterns: [args.subagent_type],
        always: ["*"],
        metadata: {
          description: args.description,
          subagent_type: args.subagent_type,
        },
      });

      const childSessionId = await resolveChildSessionId(args, client);
      const session = client.session;
      if (!session?.prompt) {
        throw new Error("PAI task override: client.session.prompt is unavailable");
      }

      const promptResult = await session.prompt({
        path: { id: childSessionId },
        body: {
          agent: args.subagent_type,
          parts: [{ type: "text", text: args.prompt }],
        },
      });

      const assistantText = await extractAssistantText(promptResult);
      return formatTaskResult(childSessionId, assistantText);
    },
  });
}
