import { describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

describe("PAI task tool override", () => {
  test("exposes run_in_background boolean arg", () => {
    const tool = createPaiTaskTool({
      client: {} as any,
      $: (() => Promise.resolve(null)) as any,
    });

    expect(tool.args.run_in_background.type).toBe("boolean");
  });
});
