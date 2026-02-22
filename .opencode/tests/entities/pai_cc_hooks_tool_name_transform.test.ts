import { describe, expect, test } from "bun:test";

import { transformToolName } from "../../plugins/pai-cc-hooks/shared/tool-name";

describe("transformToolName", () => {
  test("maps question to AskUserQuestion", () => {
    expect(transformToolName("question")).toBe("AskUserQuestion");
  });

  test("maps apply_patch to ApplyPatch", () => {
    expect(transformToolName("apply_patch")).toBe("ApplyPatch");
  });
});
