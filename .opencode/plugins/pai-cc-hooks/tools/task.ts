type ToolArgSchema = {
  type: string;
};

type ToolDefinition = {
  description: string;
  args: Record<string, ToolArgSchema>;
  execute: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
};

export function createPaiTaskTool(_input: {
  client: unknown;
  $: unknown;
}): ToolDefinition {
  return {
    description: "Run a subagent task (supports run_in_background)",
    args: {
      description: { type: "string" },
      prompt: { type: "string" },
      subagent_type: { type: "string" },
      run_in_background: { type: "boolean" },
    },
    execute: async (_args: Record<string, unknown>, _ctx: unknown) => {
      return { ok: false, error: "not implemented" };
    },
  };
}
