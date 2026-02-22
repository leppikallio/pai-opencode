type HookHandler = (input: unknown, output: unknown) => Promise<void>;

export function createPaiClaudeHooks({ ctx }: { ctx: unknown }): {
  event: HookHandler;
  "chat.message": HookHandler;
  "tool.execute.before": HookHandler;
  "tool.execute.after": HookHandler;
} {
  void ctx;

  return {
    event: async (_input, _output) => {},
    "chat.message": async (_input, _output) => {},
    "tool.execute.before": async (_input, _output) => {},
    "tool.execute.after": async (_input, _output) => {},
  };
}
