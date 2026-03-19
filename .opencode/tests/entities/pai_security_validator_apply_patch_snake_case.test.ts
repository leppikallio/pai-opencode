import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import { validateSecurity } from "../../plugins/handlers/security-validator";

describe("security-validator apply_patch snake_case args", () => {
  test("blocks protected paths when patch_text is provided", async () => {
    const blockedPath = path.join(os.homedir(), ".ssh", "id_rsa");
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${blockedPath}`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");

    const result = await validateSecurity({
      tool: "apply_patch",
      args: { patch_text: patch },
      sessionID: "s1",
      callID: "c1",
    });

    expect(result.action).toBe("block");
    expect(result.message ?? "").toContain("blocked file path");
  });
});
