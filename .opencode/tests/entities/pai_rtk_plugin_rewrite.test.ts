import { describe, expect, test } from "bun:test";

import PaiRtkPlugin from "../../plugins/pai-rtk";

describe("pai-rtk plugin", () => {
  test("rewrites bash git status to rtk git status", async () => {
    const plugin = await PaiRtkPlugin({ client: {}, $: {}, config: {} } as any);

    const input = {
      tool: "bash",
      sessionID: "ses_test",
      callID: "call_test",
    };

    const output: Record<string, unknown> = {
      args: {
        command: "git status",
        workdir: "/Users/zuul/Projects/pai-opencode",
        description: "Shows git status",
      },
    };

    await (plugin as any)["tool.execute.before"](input, output);

    expect((output.args as Record<string, unknown>).command).toBe("rtk git status");
  });
});
