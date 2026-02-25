import type { Plugin } from "@opencode-ai/plugin";
import { createPaiClaudeHooks } from "./pai-cc-hooks/hook";
import { recordBackgroundTaskLaunch } from "./pai-cc-hooks/tools/background-task-state";
import { createPaiBackgroundCancelTool } from "./pai-cc-hooks/tools/background-cancel";
import { createPaiBackgroundOutputTool } from "./pai-cc-hooks/tools/background-output";
import { createPaiTaskTool } from "./pai-cc-hooks/tools/task";
import { createPaiVoiceNotifyTool } from "./pai-cc-hooks/tools/voice-notify";

const PaiCcHooksPlugin: Plugin = async (ctx) => {
  const hooks = createPaiClaudeHooks({ ctx });

  return {
    tool: {
      task: createPaiTaskTool({
        client: ctx.client,
        $: ctx.$,
        recordBackgroundTaskLaunch,
      }),
      voice_notify: createPaiVoiceNotifyTool({
        client: ctx.client,
      }),
      background_output: createPaiBackgroundOutputTool({
        client: ctx.client,
      }),
      background_cancel: createPaiBackgroundCancelTool({
        client: ctx.client,
      }),
    },
    event: hooks.event,
    "chat.message": hooks["chat.message"],
    "tool.execute.before": hooks["tool.execute.before"],
    "tool.execute.after": hooks["tool.execute.after"],
  };
};

export default PaiCcHooksPlugin;
