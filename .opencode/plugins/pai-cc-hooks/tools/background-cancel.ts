import { tool, type ToolContext } from "@opencode-ai/plugin";

import {
  findBackgroundTaskByTaskId,
  markBackgroundTaskCancelled,
} from "./background-task-state";

type CarrierClient = {
  session?: {
    abort?: (options: unknown) => Promise<unknown>;
  };
};

type BackgroundCancelArgs = {
  task_id: string;
};

function getContextDirectory(ctx: ToolContext): string {
  const value = (ctx as ToolContext & { directory?: unknown }).directory;
  return typeof value === "string" ? value : process.cwd();
}

export function createPaiBackgroundCancelTool(input: { client: unknown }) {
  const client = (input.client ?? {}) as CarrierClient;

  return tool({
    description: "Cancel a background task (PAI)",
    args: {
      task_id: tool.schema.string(),
    },
    async execute(args: BackgroundCancelArgs, ctx: ToolContext): Promise<string> {
      const taskId = args.task_id.trim();
      if (!taskId) {
        return "Task not found: ";
      }

      const record = await findBackgroundTaskByTaskId({ taskId });
      if (!record) {
        return `Task not found: ${taskId}`;
      }

      const session = client.session;
      if (!session?.abort) {
        return `Task ID: ${record.task_id}\nSession ID: ${record.child_session_id}\n\n(no client.session.abort available)`;
      }

      try {
        await session.abort({
          path: { id: record.child_session_id },
          query: {
            directory: getContextDirectory(ctx),
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Task ID: ${record.task_id}\nSession ID: ${record.child_session_id}\n\nCancel failed: ${msg}`;
      }

      await markBackgroundTaskCancelled({ taskId, reason: "cancelled" });
      return `Cancelled.\n\nTask ID: ${record.task_id}\nSession ID: ${record.child_session_id}`;
    },
  });
}
