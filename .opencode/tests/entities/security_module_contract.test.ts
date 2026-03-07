import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateSecurity as facadeValidateSecurity } from "../../plugins/handlers/security-validator";
import { createSecurityValidator } from "../../plugins/security";
import {
  createAllChecksPassedDecision,
  createBlockedPatchPathDecision,
  createBypassDecision,
  createDangerousPatternDecision,
} from "../../plugins/security/decision";

function writeLegacyPatterns(root: string, blockDangerous: boolean): void {
  const securityDir = path.join(root, "PAISECURITYSYSTEM");
  mkdirSync(securityDir, { recursive: true });

  const yaml = [
    "SECURITY_RULES:",
    `  blockDangerous: ${blockDangerous ? "true" : "false"}`,
    "DANGEROUS_PATTERNS:",
    '  - pattern: "rm -rf /"',
    "WARNING_PATTERNS:",
    '  - pattern: "git push --force"',
    "ALLOWED_PATTERNS:",
    "",
  ].join("\n");

  writeFileSync(path.join(securityDir, "patterns.example.yaml"), yaml, "utf-8");
}

describe("security module extraction contract", () => {
  test("canonical validator preserves facade behavior for baseline matrix", async () => {
    const canonical = createSecurityValidator({
      appendAuditLog: async () => {
        // disabled in tests
      },
    });

    const matrix = [
      {
        name: "safe bash allow",
        input: { tool: "bash", args: { command: "echo hello" }, sessionID: "ses_contract", callID: "allow" },
      },
      {
        name: "dangerous bash block",
        input: { tool: "bash", args: { command: "rm -rf /" }, sessionID: "ses_contract", callID: "block" },
      },
      {
        name: "warning bash confirm",
        input: {
          tool: "bash",
          args: { command: "git push --force" },
          sessionID: "ses_contract",
          callID: "confirm",
        },
      },
      {
        name: "blocked read path",
        input: {
          tool: "Read",
          args: { filePath: "~/.ssh/id_fixture" },
          sessionID: "ses_contract",
          callID: "read-block",
        },
      },
      {
        name: "protected write path",
        input: {
          tool: "Write",
          args: { filePath: "/etc/hosts" },
          sessionID: "ses_contract",
          callID: "write-block",
        },
      },
    ] as const;

    for (const entry of matrix) {
      const [facade, canonicalResult] = await Promise.all([
        facadeValidateSecurity(entry.input),
        canonical.validateSecurity(entry.input),
      ]);

      expect(canonicalResult.action, `${entry.name} action`).toBe(facade.action);
      expect(canonicalResult.reason, `${entry.name} reason`).toBe(facade.reason);
      expect(canonicalResult.message, `${entry.name} message`).toBe(facade.message);
    }
  });

  test("bypass confirm action uses confirm-oriented message", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pai-security-contract-"));

    try {
      writeLegacyPatterns(root, false);

      const validator = createSecurityValidator({
        paiDir: root,
        appendAuditLog: async () => {
          // disabled in tests
        },
      });

      const result = await validator.validateSecurity({
        tool: "bash",
        args: {
          command: "printf 'cm0gLXJmIC90bXAvcGFpLXNlYy1maXh0dXJlCg==' | base64 -d | bash",
        },
        sessionID: "ses_contract",
        callID: "bypass-confirm",
      });

      expect(result.action).toBe("confirm");
      expect(result.message ?? "").toContain("Please confirm");
      expect(result.message ?? "").not.toContain("has been blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("decision module assembles allow/confirm/block payloads", () => {
    expect(createBypassDecision("confirm", "bypass reason")).toEqual({
      action: "confirm",
      reason: "bypass reason",
      message:
        "This command appears to hide destructive intent via shell indirection. Please confirm before proceeding.",
    });

    expect(createDangerousPatternDecision("block", "rm -rf /")).toEqual({
      action: "block",
      reason: "Dangerous command pattern detected: rm -rf /",
      message: "This command has been blocked for security reasons. It matches a known dangerous pattern.",
    });

    expect(createBlockedPatchPathDecision("Path blocked")).toEqual({
      action: "block",
      reason: "Path blocked",
      message: "This patch targets a blocked file path.",
    });

    expect(createAllChecksPassedDecision()).toEqual({
      action: "allow",
      reason: "All security checks passed",
    });
  });
});
