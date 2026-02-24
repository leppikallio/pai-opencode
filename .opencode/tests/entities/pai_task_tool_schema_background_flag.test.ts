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

    expect(taskTool.args.command.safeParse("/check-file path/to/file").success).toBe(true);
    expect(taskTool.args.command.safeParse(undefined).success).toBe(true);
    expect(taskTool.args.command.safeParse(42).success).toBe(false);
  });

  test("launches background task when run_in_background is true", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const launchRecords: Array<{ taskId: string; childSessionId: string; parentSessionId: string }> = [];

    const taskTool = createPaiTaskTool({
      client: {
        session: {
          create: async (payload: unknown) => {
            calls.push({ method: "create", payload });
            return { data: { id: "child-session-123" } };
          },
          prompt: async (payload: unknown) => {
            calls.push({ method: "prompt", payload });
            return { data: { parts: [{ type: "text", text: "unused" }] } };
          },
        },
      },
      $: (() => Promise.resolve(null)) as unknown,
      recordBackgroundTaskLaunch: async (args) => {
        launchRecords.push(args);
      },
    });

    const result = await taskTool.execute(
      {
        description: "Run subagent",
        prompt: "Do the thing",
        subagent_type: "Engineer",
        run_in_background: true,
      },
      {
        sessionID: "parent-session-456",
        directory: "/tmp/workspace",
      } as any,
    );

    const backgroundResult = result as unknown as {
      task_id: string;
      session_id: string;
    };

    expect(backgroundResult).toEqual({
      task_id: "child-session-123",
      session_id: "child-session-123",
    });
    expect(calls.map((entry) => entry.method)).toEqual(["create", "prompt"]);
    expect(launchRecords).toEqual([
      {
        taskId: "child-session-123",
        childSessionId: "child-session-123",
        parentSessionId: "parent-session-456",
      },
    ]);
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

  test("resumes task_id via session.get and skips create", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];

    const taskTool = createPaiTaskTool({
      client: {
        session: {
          get: async (payload: unknown) => {
            calls.push({ method: "get", payload });
            return { data: { id: "existing-child-456" } };
          },
          create: async (payload: unknown) => {
            calls.push({ method: "create", payload });
            return { data: { id: "new-child-should-not-be-used" } };
          },
          prompt: async (payload: unknown) => {
            calls.push({ method: "prompt", payload });
            return { data: { parts: [{ type: "text", text: "resumed reply" }] } };
          },
        },
      },
      $: (() => Promise.resolve(null)) as unknown,
    });

    const result = await taskTool.execute(
      {
        description: "Resume subagent",
        prompt: "Continue",
        subagent_type: "Engineer",
        task_id: "requested-task-id",
      },
      {
        ask: async (payload: unknown) => {
          calls.push({ method: "ask", payload });
          return { decision: "allow" };
        },
      } as any,
    );

    expect(result).toContain("task_id: existing-child-456");
    expect(result).toContain("<task_result>resumed reply</task_result>");
    expect(calls.map((entry) => entry.method)).toEqual(["ask", "get", "prompt"]);
  });
});
