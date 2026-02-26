import { describe, expect, test } from "bun:test";

import PaiHistoryPlugin from "../../plugins/pai-history";

describe("pai-history plugin", () => {
  test("exports event + tool hook handlers", async () => {
    const plugin = await PaiHistoryPlugin({ client: {}, $: {}, config: {} } as any);
    expect(typeof plugin.event).toBe("function");
    expect(typeof (plugin as any)["tool.execute.before"]).toBe("function");
    expect(typeof (plugin as any)["tool.execute.after"]).toBe("function");
  });
});
