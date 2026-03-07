import { describe, expect, test } from "bun:test";

import {
  createSecurityValidator,
} from "../../plugins/handlers/security-validator";

describe("security-validator bash bypass regressions", () => {
  function createTestValidator() {
    return createSecurityValidator({
      appendAuditLog: async () => {
        // disabled in tests
      },
    });
  }

  test("blocks env-prefixed destructive rm command", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "LANG=C rm -rf /tmp/pai-sec-fixture" },
      sessionID: "ses_bypass",
      callID: "call_env_prefix",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Dangerous command pattern detected");
  });

  test("blocks multi-env-prefixed destructive rm command", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "A=1 B=2 rm -rf /tmp/pai-sec-fixture" },
      sessionID: "ses_bypass",
      callID: "call_multi_env_prefix",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Dangerous command pattern detected");
  });

  test("blocks wrapper-decoded destructive payload command", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: {
        command: "printf 'cm0gLXJmIC90bXAvcGFpLXNlYy1maXh0dXJlCg==' | base64 -d | bash",
      },
      sessionID: "ses_bypass",
      callID: "call_wrapper_dropper",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Wrapper/script-dropper decodes destructive payload");
  });

  test("blocks command-substitution destructive rm form", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "$(printf 'rm') -rf /tmp/pai-sec-fixture" },
      sessionID: "ses_bypass",
      callID: "call_subshell",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Command substitution hides destructive rm intent");
  });

  test("blocks xargs-driven destructive rm chain", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "printf '/tmp/pai-sec-fixture\\n' | xargs rm -rf" },
      sessionID: "ses_bypass",
      callID: "call_xargs",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("xargs-driven destructive rm chain detected");
  });

  test("blocks traversal-shaped destructive rm intent", async () => {
    const result = await createTestValidator().validateSecurity({
      tool: "bash",
      args: { command: "rm -rf ../../tmp/pai-sec-fixture" },
      sessionID: "ses_bypass",
      callID: "call_traversal",
    });

    expect(result.action).toBe("block");
    expect(result.reason).toContain("Traversal-shaped destructive rm intent detected");
  });
});
