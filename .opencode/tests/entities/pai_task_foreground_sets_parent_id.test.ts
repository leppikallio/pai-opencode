import { describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

describe("PAI task tool foreground session parenting", () => {
  test("creates child session with parentID when running in foreground", async () => {
    const createCalls: unknown[] = [];
    const promptCalls: unknown[] = [];

    const toolDef = createPaiTaskTool({
      client: {
        session: {
          create: async (options: unknown) => {
            createCalls.push(options);
            return { data: { id: "child-session-123" } };
          },
          prompt: async (options: unknown) => {
            promptCalls.push(options);
            return {
              data: {
                parts: [{ type: "text", text: "ok" }],
              },
            };
          },
        },
      },
      $: {},
    });

    const out = await toolDef.execute(
      {
        description: "implementation task",
        prompt: "do the thing",
        subagent_type: "Engineer",
      },
      {
        sessionID: "parent-session-456",
        directory: "/tmp",
        ask: async () => ({ ok: true }),
      } as any,
    );

    expect(out).toContain("task_id: child-session-123");
    expect(out).toContain("<task_result>ok</task_result>");

    expect(createCalls).toHaveLength(1);
    const createArgs = createCalls[0] as any;
    expect(createArgs?.body?.parentID).toBe("parent-session-456");
    expect(createArgs?.body?.title).toBe("implementation task");

    expect(promptCalls).toHaveLength(1);
    const promptArgs = promptCalls[0] as any;
    expect(promptArgs?.path?.id).toBe("child-session-123");
  });
});
