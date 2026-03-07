import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createResearchShellSecurityAdapter } from "../../mcp/research-shell/security-adapter";

describe("research-shell security adapter", () => {
  test("allows session_dir under approved prefixes", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "research-shell-security-"));
    const events: unknown[] = [];

    try {
      const allowedPrefix = path.join(root, "allowed");
      const sessionDir = path.join(allowedPrefix, "ses_allowed");
      mkdirSync(sessionDir, { recursive: true });

      const adapter = createResearchShellSecurityAdapter({
        allowedSessionDirPrefixes: [allowedPrefix],
        appendAuditLog: async (entry: unknown) => {
          events.push(entry);
        },
      });

      const resolved = await adapter.validateSessionDirOrThrow({
        toolName: "perplexity_search",
        sessionDirRaw: sessionDir,
        sourceCallId: "allow-1",
        query: "latest AI safety report",
      });

      expect(resolved).toBe(realpathSync(sessionDir));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "allow",
        tool: "perplexity_search",
        ruleId: "research_shell.session_dir.allow",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks session_dir outside approved prefixes", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "research-shell-security-"));
    const events: unknown[] = [];

    try {
      const allowedPrefix = path.join(root, "allowed");
      const blockedDir = path.join(root, "outside", "ses_blocked");
      mkdirSync(allowedPrefix, { recursive: true });
      mkdirSync(blockedDir, { recursive: true });

      const adapter = createResearchShellSecurityAdapter({
        allowedSessionDirPrefixes: [allowedPrefix],
        appendAuditLog: async (entry: unknown) => {
          events.push(entry);
        },
      });

      await expect(
        adapter.validateSessionDirOrThrow({
          toolName: "gemini_search",
          sessionDirRaw: blockedDir,
          sourceCallId: "block-1",
          query: "latest model releases",
        }),
      ).rejects.toThrow("session_dir is not allowed");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "block",
        tool: "gemini_search",
        ruleId: "research_shell.session_dir.allowlist",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("emits shared audit event shape with redacted request preview", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "research-shell-security-"));
    const events: Array<Record<string, unknown>> = [];

    try {
      const allowedPrefix = path.join(root, "allowed");
      const sessionDir = path.join(allowedPrefix, "ses_redaction");
      mkdirSync(sessionDir, { recursive: true });

      const adapter = createResearchShellSecurityAdapter({
        allowedSessionDirPrefixes: [allowedPrefix],
        appendAuditLog: async (entry: unknown) => {
          events.push(entry as Record<string, unknown>);
        },
      });

      await adapter.validateSessionDirOrThrow({
        toolName: "grok_search",
        sessionDirRaw: sessionDir,
        sourceCallId: "shape-1",
        query: "Authorization: Bearer placeholder-token-value-for-redaction",
      });

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event).toHaveProperty("v", "0.1");
      expect(event).toHaveProperty("ts");
      expect(event).toHaveProperty("sessionId");
      expect(event).toHaveProperty("tool", "grok_search");
      expect(event).toHaveProperty("sourceEventId");
      expect(event).toHaveProperty("action", "allow");
      expect(event).toHaveProperty("category", "path_access");
      expect(event).toHaveProperty("requestCategory", "research_query");
      expect(event).toHaveProperty("provider", "grok");
      expect(event).toHaveProperty("targetPreview");
      expect(String(event.targetPreview)).toContain("Authorization: Bearer [REDACTED]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses import composition only (no internal shell spawning)", () => {
    const adapterPath = path.join(
      process.cwd(),
      ".opencode",
      "mcp",
      "research-shell",
      "security-adapter.ts",
    );
    const indexPath = path.join(
      process.cwd(),
      ".opencode",
      "mcp",
      "research-shell",
      "index.ts",
    );
    const adapterSource = readFileSync(adapterPath, "utf8");
    const indexSource = readFileSync(indexPath, "utf8");

    expect(adapterSource).not.toMatch(/spawn\(/);
    expect(adapterSource).not.toMatch(/exec\(/);
    expect(adapterSource).not.toMatch(/execFile\(/);
    expect(adapterSource).not.toMatch(/fork\(/);
    expect(adapterSource).not.toMatch(/Bun\.spawn\(/);

    expect(indexSource).not.toMatch(/spawn\(/);
    expect(indexSource).not.toMatch(/exec\(/);
    expect(indexSource).not.toMatch(/execFile\(/);
    expect(indexSource).not.toMatch(/fork\(/);
    expect(indexSource).not.toMatch(/Bun\.spawn\(/);
  });
});
