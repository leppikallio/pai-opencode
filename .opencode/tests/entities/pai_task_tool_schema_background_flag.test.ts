import { describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

describe("PAI task tool override", () => {
  test("exposes run_in_background boolean zod schema", () => {
    const taskTool = createPaiTaskTool({
      client: {},
      $: (() => Promise.resolve(null)) as unknown,
    });

    expect(taskTool.args.run_in_background.safeParse(true).success).toBe(true);
    expect(taskTool.args.run_in_background.safeParse(false).success).toBe(true);
    expect(taskTool.args.run_in_background.safeParse("true").success).toBe(false);
  });

  test("runs foreground task when run_in_background is absent or false", async () => {
    for (const runInBackground of [undefined, false] as const) {
      const calls: Array<{ method: string; payload: unknown }> = [];

      const taskTool = createPaiTaskTool({
        client: {
          session: {
            create: async (payload: unknown) => {
              calls.push({ method: "create", payload });
              return { data: { id: "child-session-123" } };
            },
            prompt: async (payload: unknown) => {
              calls.push({ method: "prompt", payload });
              return { data: { parts: [{ type: "text", text: "assistant reply" }] } };
            },
          },
        },
        $: (() => Promise.resolve(null)) as unknown,
      });

      const args: {
        description: string;
        prompt: string;
        subagent_type: string;
        run_in_background?: boolean;
      } = {
        description: "Run subagent",
        prompt: "Do the thing",
        subagent_type: "Engineer",
      };

      if (runInBackground !== undefined) {
        args.run_in_background = runInBackground;
      }

      const result = await taskTool.execute(args, {
        ask: async (payload: unknown) => {
          calls.push({ method: "ask", payload });
          return { decision: "allow" };
        },
      } as any);

      expect(result).toContain("task_id: child-session-123");
      expect(result).toContain("<task_result>assistant reply</task_result>");
      expect(result).not.toContain("NOT IMPLEMENTED");

      expect(calls.map((entry) => entry.method)).toEqual(["ask", "create", "prompt"]);
    }
  });
});
