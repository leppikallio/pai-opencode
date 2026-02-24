import type { Plugin } from "@opencode-ai/plugin";
import { createPaiClaudeHooks } from "./pai-cc-hooks/hook";
import { createPaiTaskTool } from "./pai-cc-hooks/tools/task";

const PaiCcHooksPlugin: Plugin = async (ctx) => {
  const hooks = createPaiClaudeHooks({ ctx });

  return {
    tool: {
      task: createPaiTaskTool({ client: ctx.client, $: ctx.$ }),
    },
    event: hooks.event,
    "chat.message": hooks["chat.message"],
    "tool.execute.before": hooks["tool.execute.before"],
    "tool.execute.after": hooks["tool.execute.after"],
  };
};

export default PaiCcHooksPlugin;
