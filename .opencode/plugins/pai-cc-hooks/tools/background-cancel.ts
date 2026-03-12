import { tool, type ToolContext } from "@opencode-ai/plugin";

import { findBackgroundTaskByTaskId } from "./background-task-state";
import {
	applyBackgroundCancellationPolicy,
	resolveCancellationNowMs,
} from "../background/cancellation-policy";
import { getBackgroundConcurrencyManager } from "../background/concurrency";
import { resolvePaiOrchestrationFeatureFlags } from "../feature-flags";

type CarrierClient = {
  session?: {
    abort?: (options: unknown) => Promise<unknown>;
  };
};

type BackgroundCancelArgs = {
  task_id: string;
	force?: boolean;
	reason?: string;
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
			force: tool.schema.boolean().optional(),
			reason: tool.schema.string().optional(),
    },
		async execute(
			args: BackgroundCancelArgs,
			ctx: ToolContext,
		): Promise<string> {
      const taskId = args.task_id.trim();
      if (!taskId) {
        return "Task not found: ";
      }

      const record = await findBackgroundTaskByTaskId({ taskId, nowMs: 0 });
      if (!record) {
        return `Task not found: ${taskId}`;
      }

		const nowMs = resolveCancellationNowMs({
			taskRecord: record,
			nowProvider: () => Date.now(),
		});

			const flags = resolvePaiOrchestrationFeatureFlags();
			const session = client.session;
			let pendingRemoved = false;

			const result = await applyBackgroundCancellationPolicy({
				taskRecord: record,
				source: "manual",
				nowMs,
				force: args.force,
				reason: args.reason,
				requestTaskCancellation: async ({ taskRecord }) => {
					if (flags.paiOrchestrationConcurrencyEnabled) {
						pendingRemoved =
							getBackgroundConcurrencyManager().cancelPendingTask(
								taskRecord.task_id,
								taskRecord.concurrency_group,
							);
					}

					if (typeof session?.abort !== "function") {
						return;
					}

					try {
						await session.abort({
							path: { id: taskRecord.child_session_id },
							query: {
								directory: getContextDirectory(ctx),
							},
						});
					} catch {
						// Best effort only. State contract remains authoritative.
					}
				},
			});

			const reasonProvided = typeof args.reason === "string" && args.reason.trim().length > 0;
			const wantsStructuredResponse = args.force === true || reasonProvided;
			if (wantsStructuredResponse) {
				return result as unknown as string;
			}

			if (result.outcome === "refused") {
				return `Task ID: ${record.task_id}\nSession ID: ${record.child_session_id}\n\nCancel refused: ${result.reasonText}`;
			}

			const queueNote = pendingRemoved
				? "\nPending concurrency waiter removed."
				: "";
			return `Cancelled.\n\nTask ID: ${record.task_id}\nSession ID: ${record.child_session_id}${queueNote}`;
    },
  });
}
