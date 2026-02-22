import type { Plugin } from "@opencode-ai/plugin";
import { createPaiClaudeHooks } from "./pai-cc-hooks/hook";

const PaiCcHooksPlugin: Plugin = async (ctx) => {
  const hooks = createPaiClaudeHooks({ ctx });

  return {
    event: hooks.event,
    "chat.message": hooks["chat.message"],
    "tool.execute.before": hooks["tool.execute.before"],
    "tool.execute.after": hooks["tool.execute.after"],
  };
};

export default PaiCcHooksPlugin;
