import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createSecurityValidator,
} from "../../plugins/handlers/security-validator";

type TestValidator = ReturnType<typeof createSecurityValidator>;

function writePatterns(root: string, userYaml: string): void {
  const systemDir = path.join(root, "PAISECURITYSYSTEM");
  const userDir = path.join(root, "skills", "PAI", "USER", "PAISECURITYSYSTEM");

  mkdirSync(systemDir, { recursive: true });
  mkdirSync(userDir, { recursive: true });

  writeFileSync(
    path.join(systemDir, "patterns.example.yaml"),
    [
      "bash:",
      "  blocked:",
      "  confirm:",
      "  alert:",
      "paths:",
      "  zeroAccess:",
      "  readOnly:",
      "  confirmWrite:",
      "  noDelete:",
      "",
    ].join("\n"),
    "utf-8",
  );

  writeFileSync(path.join(userDir, "patterns.yaml"), `${userYaml.trim()}\n`, "utf-8");
}

async function withRuntimeRoot<T>(userYaml: string, run: (validator: TestValidator) => Promise<T>): Promise<T> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-security-projects-"));

  try {
    writePatterns(root, userYaml);

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

const PROJECT_RULES_YAML = `
bash:
  blocked:
  confirm:
  alert:
paths:
  zeroAccess:
  readOnly:
  confirmWrite:
  noDelete:
projects:
  parity_project:
    cwd:
      - "/tmp/security-parity-target"
    bash:
      blocked:
        - pattern: "echo project-block"
          reason: "project-only block"
      confirm:
      alert:
    paths:
      zeroAccess:
      readOnly:
      confirmWrite:
      noDelete:
`;

describe("security project rules", () => {
  test("applies project-scoped rules when cwd matches", async () => {
    await withRuntimeRoot(PROJECT_RULES_YAML, async (validator) => {
      const result = await validator.validateSecurity({
        tool: "bash",
        args: {
          command: "echo project-block",
          cwd: "/tmp/security-parity-target/subdir",
        },
        sessionID: "ses_projects",
        callID: "call_project_match",
      });

      expect(result.action).toBe("block");
      expect(result.reason).toContain("echo project-block");
    });
  });

  test("does not apply project-scoped rules when cwd does not match", async () => {
    await withRuntimeRoot(PROJECT_RULES_YAML, async (validator) => {
      const result = await validator.validateSecurity({
        tool: "bash",
        args: {
          command: "echo project-block",
          cwd: "/tmp/security-parity-other/subdir",
        },
        sessionID: "ses_projects",
        callID: "call_project_miss",
      });

      expect(result.action).toBe("allow");
    });
  });
});
