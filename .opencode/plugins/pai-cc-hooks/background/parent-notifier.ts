import type { BackgroundTaskRecord } from "../tools/background-task-state";

type PromptAsyncFn = (args: {
  path: { id: string };
  body: {
    noReply: boolean;
    parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
  };
}) => Promise<unknown>;

type NotifyDeps = {
  promptAsync?: PromptAsyncFn;
  listBackgroundTasksByParent: (args: { parentSessionId: string; nowMs?: number }) => Promise<BackgroundTaskRecord[]>;
  shouldSuppressDuplicate: (args: { sessionId: string; title: string; body: string; nowMs?: number }) => Promise<boolean>;
  nowMs?: number;
};

function isCompleteForParent(task: BackgroundTaskRecord): boolean {
  return task.completed_at_ms != null || task.launch_error != null;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

function buildAllCompleteText(args: {
  completedTasks: BackgroundTaskRecord[];
  fallbackTaskId: string;
}): string {
  const completedTasksText = args.completedTasks
    .map((t) => `- \`${t.task_id}\``)
    .join("\n");

  return `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasksText || `- \`${args.fallbackTaskId}\``}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`;
}

function buildSingleCompleteText(args: {
  taskId: string;
  remainingCount: number;
}): string {
  return `<system-reminder>
[BACKGROUND TASK COMPLETED]
**ID:** \`${args.taskId}\`

**${args.remainingCount} ${pluralize(args.remainingCount, "task")} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${args.taskId}")\` to retrieve this result when ready.
</system-reminder>`;
}

export async function notifyParentSessionBackgroundCompletion(args: {
  taskRecord: BackgroundTaskRecord;
  deps: NotifyDeps;
}): Promise<void> {
  const parentSessionId = args.taskRecord.parent_session_id?.trim();
  if (!parentSessionId) return;

  const promptAsync = args.deps.promptAsync;
  if (!promptAsync) return;

  try {
    const tasks = await args.deps.listBackgroundTasksByParent({
      parentSessionId,
      nowMs: args.deps.nowMs,
    });
    if (tasks.length === 0) return;

    const allComplete = tasks.every(isCompleteForParent);
    const completedTasks = allComplete ? tasks.filter(isCompleteForParent) : [];
    const remainingCount = tasks.filter((t) => !isCompleteForParent(t)).length;

    const notificationText = allComplete
      ? buildAllCompleteText({
          completedTasks,
          fallbackTaskId: args.taskRecord.task_id,
        })
      : buildSingleCompleteText({
          taskId: args.taskRecord.task_id,
          remainingCount,
        });

    const shouldSuppress = await args.deps.shouldSuppressDuplicate({
      sessionId: parentSessionId,
      title: "OpenCode",
      body: notificationText,
      nowMs: args.deps.nowMs,
    });
    if (shouldSuppress) return;

    await promptAsync({
      path: { id: parentSessionId },
      body: {
        noReply: !allComplete,
        // Mark synthetic so OpenCode TUI can keep these reminders hidden.
        parts: [{ type: "text", text: notificationText, synthetic: true }],
      },
    });
  } catch {
    // Best effort by design.
  }
}
