import { tool, type ToolContext } from "@opencode-ai/plugin";

import {
  findBackgroundTaskByTaskId,
  markBackgroundTaskCancelled,
} from "./background-task-state";
import { getBackgroundConcurrencyManager } from "../background/concurrency";
import { resolvePaiOrchestrationFeatureFlags } from "../feature-flags";

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

      const flags = resolvePaiOrchestrationFeatureFlags();
      const concurrencyEnabled = flags.paiOrchestrationConcurrencyEnabled;
      const cancelledPending = concurrencyEnabled
        ? getBackgroundConcurrencyManager().cancelPendingTask(
            taskId,
            record.concurrency_group,
          )
        : false;

      const session = client.session;

      let abortSucceeded = false;
      let abortFailureMessage: string | undefined;
      if (session?.abort) {
        try {
          await session.abort({
            path: { id: record.child_session_id },
            query: {
              directory: getContextDirectory(ctx),
            },
          });
          abortSucceeded = true;
        } catch (error) {
          abortFailureMessage = error instanceof Error ? error.message : String(error);
        }
      }

      if (!abortSucceeded && !cancelledPending) {
        if (!session?.abort) {
          return `Task ID: ${record.task_id}\nSession ID: ${record.child_session_id}\n\n(no client.session.abort available)`;
        }

        return `Task ID: ${record.task_id}\nSession ID: ${record.child_session_id}\n\nCancel failed: ${abortFailureMessage ?? "unknown error"}`;
      }

      await markBackgroundTaskCancelled({ taskId, reason: "cancelled" });
      const queueNote = cancelledPending
        ? "\nPending concurrency waiter removed."
        : "";
      return `Cancelled.\n\nTask ID: ${record.task_id}\nSession ID: ${record.child_session_id}${queueNote}`;
    },
  });
}
