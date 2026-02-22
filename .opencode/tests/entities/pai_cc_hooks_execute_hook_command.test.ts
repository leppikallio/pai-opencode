import { describe, expect, test } from "bun:test";

import { expandHookCommand } from "../../plugins/pai-cc-hooks/shared/execute-hook-command";

describe("expandHookCommand", () => {
  test("expands ${PAI_DIR} from settings env", () => {
    const expanded = expandHookCommand("bun ${PAI_DIR}/Tools/Inference.ts", "/tmp/project", {
      PAI_DIR: "/Users/example/.config/opencode/skills/PAI",
    });

    expect(expanded).toBe("bun /Users/example/.config/opencode/skills/PAI/Tools/Inference.ts");
  });
});
