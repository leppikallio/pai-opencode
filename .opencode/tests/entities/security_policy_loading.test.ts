import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createSecurityValidator,
} from "../../plugins/handlers/security-validator";

type TestValidator = ReturnType<typeof createSecurityValidator>;

function writePatterns(root: string, systemYaml: string, userYaml?: string): void {
  const systemDir = path.join(root, "PAISECURITYSYSTEM");
  mkdirSync(systemDir, { recursive: true });
  writeFileSync(path.join(systemDir, "patterns.example.yaml"), `${systemYaml.trim()}\n`, "utf-8");

  if (userYaml !== undefined) {
    const userDir = path.join(root, "skills", "PAI", "USER", "PAISECURITYSYSTEM");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(path.join(userDir, "patterns.yaml"), `${userYaml}\n`, "utf-8");
  }
}

async function withRuntimeRoot<T>(
  setup: { systemYaml: string; userYaml?: string },
  run: (validator: TestValidator) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-security-policy-"));

  try {
    writePatterns(root, setup.systemYaml, setup.userYaml);

    const validator = createSecurityValidator({
      paiDir: root,
      appendAuditLog: async () => {
        // disabled in tests
      },
    });

    return await run(validator);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SYSTEM_ONLY_YAML = `
bash:
  blocked:
    - pattern: "echo system-only-block"
      reason: "system block"
  confirm:
  alert:
paths:
  zeroAccess:
  readOnly:
  confirmWrite:
  noDelete:
`;

describe("security policy loading", () => {
  test("uses SYSTEM fallback when USER override is missing", async () => {
    await withRuntimeRoot({ systemYaml: SYSTEM_ONLY_YAML }, async (validator) => {
      const result = await validator.validateSecurity({
        tool: "bash",
        args: { command: "echo system-only-block" },
        sessionID: "ses_policy",
        callID: "call_system_fallback",
      });

      expect(result.action).toBe("block");
      expect(result.reason).toContain("echo system-only-block");
    });
  });

  test("prefers USER override when present", async () => {
    const userYaml = `
bash:
  blocked:
    - pattern: "echo user-only-block"
      reason: "user block"
  confirm:
  alert:
paths:
  zeroAccess:
  readOnly:
  confirmWrite:
  noDelete:
`;

    await withRuntimeRoot({ systemYaml: SYSTEM_ONLY_YAML, userYaml }, async (validator) => {
      const userMatch = await validator.validateSecurity({
        tool: "bash",
        args: { command: "echo user-only-block" },
        sessionID: "ses_policy",
        callID: "call_user_match",
      });

      const systemMatch = await validator.validateSecurity({
        tool: "bash",
        args: { command: "echo system-only-block" },
        sessionID: "ses_policy",
        callID: "call_system_should_not_match",
      });

      expect(userMatch.action).toBe("block");
      expect(systemMatch.action).toBe("allow");
    });
  });

  test("retains USER rules-only override and keeps SYSTEM patterns", async () => {
    const userYaml = `
bash:
  blocked:
  confirm:
  alert:
paths:
  zeroAccess:
  readOnly:
  confirmWrite:
  noDelete:
security_rules:
  enabled: false
`;

    await withRuntimeRoot({ systemYaml: SYSTEM_ONLY_YAML, userYaml }, async (validator) => {
      const result = await validator.validateSecurity({
        tool: "bash",
        args: { command: "echo system-only-block" },
        sessionID: "ses_policy",
        callID: "call_rules_only_override",
      });

      expect(result.action).toBe("allow");
      expect(result.reason).toBe("Security rules disabled");
    });
  });

  test("falls back to SYSTEM when USER override is empty", async () => {
    await withRuntimeRoot({ systemYaml: SYSTEM_ONLY_YAML, userYaml: "" }, async (validator) => {
      const result = await validator.validateSecurity({
        tool: "bash",
        args: { command: "echo system-only-block" },
        sessionID: "ses_policy",
        callID: "call_empty_override",
      });

      expect(result.action).toBe("block");
      expect(result.reason).toContain("echo system-only-block");
    });
  });

  test("falls back to SYSTEM when USER override is invalid", async () => {
    await withRuntimeRoot(
      { systemYaml: SYSTEM_ONLY_YAML, userYaml: "this is not valid rules" },
      async (validator) => {
        const result = await validator.validateSecurity({
          tool: "bash",
          args: { command: "echo system-only-block" },
          sessionID: "ses_policy",
          callID: "call_invalid_override",
        });

        expect(result.action).toBe("block");
        expect(result.reason).toContain("echo system-only-block");
      },
    );
  });
});
