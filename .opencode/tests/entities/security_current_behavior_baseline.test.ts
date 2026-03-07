import { describe, expect, test } from "bun:test";

import {
  createSecurityValidator,
  extractApplyPatchPaths,
} from "../../plugins/handlers/security-validator";

describe("security-validator current behavior baseline", () => {
  function createTestValidator() {
    return createSecurityValidator({
      appendAuditLog: async () => {
        // disabled in tests
      },
    });
  }

  test("safe bash command returns allow", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "echo hello" },
      sessionID: "ses_baseline",
      callID: "call_allow",
    });

    expect(result.action).toBe("allow");
  });

  test("blocked bash pattern returns block", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "rm -rf /" },
      sessionID: "ses_baseline",
      callID: "call_block",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("rm -rf /");
  });

  test("confirm bash pattern returns confirm", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "git push --force" },
      sessionID: "ses_baseline",
      callID: "call_confirm",
    });

    expect(result.action).toBe("confirm");
    expect(result.reason).toContain("git push --force");
  });

  test("read on blocked path returns block", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "Read",
      args: { filePath: "~/.ssh/id_fixture" },
      sessionID: "ses_baseline",
      callID: "call_read_block",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Zero access path");
  });

  test("write on protected path returns block", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "Write",
      args: { filePath: "/etc/hosts" },
      sessionID: "ses_baseline",
      callID: "call_write_protected",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Read-only path");
  });

  test("apply_patch path extraction still works", () => {
    const patchText = [
      "*** Begin Patch",
      '*** Update File: "MEMORY\\WORK\\2026-03\\session-1\\PRD-20260304-old.md"',
      '*** Move to: "MEMORY\\WORK\\2026-03\\session-1\\PRD-20260304-new.md"',
      "*** End Patch",
      "",
    ].join("\n");

    expect(extractApplyPatchPaths(patchText)).toEqual([
      { action: "delete", filePath: "MEMORY/WORK/2026-03/session-1/PRD-20260304-old.md" },
      { action: "write", filePath: "MEMORY/WORK/2026-03/session-1/PRD-20260304-new.md" },
    ]);
  });
});
