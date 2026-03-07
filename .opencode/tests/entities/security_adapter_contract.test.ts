import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  __resetPaiCcHooksSettingsCacheForTests,
  createPreToolSecurityDecisionFromError,
  createPreToolSecurityDecisionFromResult,
  createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import type { SecurityResult } from "../../plugins/adapters/types";
import {
  createSecurityPermissionDecisionFromError,
  createSecurityPermissionDecisionFromResult,
} from "../../plugins/security/adapter-decision";
import { createSecurityHookProcessResult } from "../../hooks/SecurityValidator.hook";

type SecurityDecisionStatus = "allow" | "ask" | "deny";

type HookCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type DecisionResult = {
  status: SecurityDecisionStatus;
  reason?: string;
};

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = previousValue;
}

function quoteCommandArg(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function toDecision(result: HookCommandResult): DecisionResult {
  if (result.exitCode === 2) {
    return {
      status: "deny",
      reason: result.stderr || result.stdout || "Security validator denied",
    };
  }

  if (result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      if (parsed.decision === "ask") {
        return {
          status: "ask",
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }

      if (parsed.decision === "deny" || parsed.decision === "block") {
        return {
          status: "deny",
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }

      if (parsed.decision === "allow" || parsed.decision === "approve" || parsed.continue === true) {
        return {
          status: "allow",
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch {
      // Ignore parse errors and treat as allow-by-default compatibility.
    }
  }

  return {
    status: "allow",
    reason: result.stderr || undefined,
  };
}

function runScriptHook(args: {
  scriptPath: string;
  payload: Record<string, unknown>;
  cwd: string;
  env?: Record<string, string | undefined>;
}): Promise<HookCommandResult> {
  const mergedEnv: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };

  for (const [key, value] of Object.entries(args.env ?? {})) {
    if (typeof value === "string") {
      mergedEnv[key] = value;
    } else {
      delete mergedEnv[key];
    }
  }

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [args.scriptPath], {
      cwd: args.cwd,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.stdin.end(`${JSON.stringify(args.payload)}\n`);

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: String(error),
      });
    });
  });
}

async function runPluginPreToolDecision(args: {
  configRoot: string;
  input: {
    tool: string;
    args: Record<string, unknown>;
  };
}): Promise<DecisionResult> {
  const previousConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

  try {
    process.env.PAI_CC_HOOKS_CONFIG_ROOT = args.configRoot;
    __resetPaiCcHooksSettingsCacheForTests();

    const hooks = createPaiClaudeHooks({ ctx: {} });
    const output: Record<string, unknown> = {
      args: { ...args.input.args },
    };

    try {
      await hooks["tool.execute.before"](
        {
          tool: args.input.tool,
          sessionID: "ses_adapter_contract",
          callID: "call_adapter_contract",
          args: { ...args.input.args },
        },
        output,
      );

      return { status: "allow" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Blocked pending confirmation")) {
        return { status: "ask", reason: message };
      }

      return { status: "deny", reason: message };
    }
  } finally {
    restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousConfigRoot);
    __resetPaiCcHooksSettingsCacheForTests();
  }
}

describe("security adapter contract", () => {
  test("adapter-specific UX stays separated from canonical policy decisions", () => {
    const samples: SecurityResult[] = [
      {
        action: "allow",
        reason: "safe command",
      },
      {
        action: "confirm",
        reason: "warning",
        message: "Please confirm before proceeding.",
      },
      {
        action: "block",
        reason: "dangerous command",
        message: "Blocked by security policy.",
      },
    ];

    for (const sample of samples) {
      const canonical = createSecurityPermissionDecisionFromResult(sample);
      const hookProcess = createSecurityHookProcessResult(canonical);
      const preToolDecision = createPreToolSecurityDecisionFromResult(sample);

      if (canonical.status === "allow") {
        expect(hookProcess.exitCode).toBe(0);
        expect(hookProcess.stdout).toContain('"continue":true');
        expect(preToolDecision.decision).toBe("allow");
        continue;
      }

      if (canonical.status === "ask") {
        expect(hookProcess.exitCode).toBe(0);
        expect(hookProcess.stdout).toContain('"decision":"ask"');
        expect(preToolDecision.decision).toBe("ask");
        expect(preToolDecision.reason).toBe(canonical.reason);
        continue;
      }

      expect(hookProcess.exitCode).toBe(2);
      expect(hookProcess.stderr).toContain(canonical.reason as string);
      expect(preToolDecision.decision).toBe("deny");
      expect(preToolDecision.reason).toBe(canonical.reason);
    }

    const error = new Error("simulated adapter failure");
    const canonicalFallback = createSecurityPermissionDecisionFromError(error);
    const hookFallback = createSecurityHookProcessResult(canonicalFallback);
    const preToolFallback = createPreToolSecurityDecisionFromError(error);

    expect(canonicalFallback.status).toBe("ask");
    expect(canonicalFallback.reason).toContain("simulated adapter failure");
    expect(hookFallback.exitCode).toBe(0);
    expect(hookFallback.stdout).toContain('"decision":"ask"');
    expect(preToolFallback.decision).toBe("ask");
    expect(preToolFallback.reason).toContain("simulated adapter failure");
  });

  test("plugin pre-tool decisions stay equivalent to SecurityValidator hook decisions", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-security-adapter-contract-"));
    const paiDir = path.resolve(import.meta.dir, "..", "..");
    const securityHookPath = path.join(paiDir, "hooks", "SecurityValidator.hook.ts");
    const passthroughHookPath = path.join(tmpRoot, "passthrough-continue.hook.ts");
    const brokenSecurityHookPath = path.join(tmpRoot, "broken-security-validator.hook.ts");

    writeFileSync(
      passthroughHookPath,
      [
        "#!/usr/bin/env bun",
        'process.stdout.write(JSON.stringify({ continue: true }) + "\\n");',
      ].join("\n"),
      "utf8",
    );

    writeFileSync(
      brokenSecurityHookPath,
      [
        "#!/usr/bin/env bun",
        'const reason = "Security validator error: simulated validator failure";',
        'process.stderr.write("[SecurityValidator] simulated validator failure\\n");',
        'process.stdout.write(JSON.stringify({ decision: "ask", reason }) + "\\n");',
      ].join("\n"),
      "utf8",
    );

    const securityHookCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(securityHookPath)}`;
    const passthroughHookCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(passthroughHookPath)}`;
    const brokenSecurityHookCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(brokenSecurityHookPath)}`;

    const cases: Array<{
      name: string;
      matcher: "Bash" | "Read";
      pluginTool: string;
      hookToolName: "Bash" | "Read";
      toolInput: Record<string, unknown>;
      securityScriptPath: string;
      configuredSecurityCommand: string;
      expectedStatus: SecurityDecisionStatus;
    }> = [
      {
        name: "allow decision",
        matcher: "Bash",
        pluginTool: "bash",
        hookToolName: "Bash",
        toolInput: { command: "echo hello" },
        securityScriptPath: securityHookPath,
        configuredSecurityCommand: securityHookCommand,
        expectedStatus: "allow",
      },
      {
        name: "confirm decision",
        matcher: "Bash",
        pluginTool: "bash",
        hookToolName: "Bash",
        toolInput: { command: "git push --force" },
        securityScriptPath: securityHookPath,
        configuredSecurityCommand: securityHookCommand,
        expectedStatus: "ask",
      },
      {
        name: "block decision",
        matcher: "Bash",
        pluginTool: "bash",
        hookToolName: "Bash",
        toolInput: { command: "rm -rf /" },
        securityScriptPath: securityHookPath,
        configuredSecurityCommand: securityHookCommand,
        expectedStatus: "deny",
      },
      {
        name: "path-based decision",
        matcher: "Read",
        pluginTool: "Read",
        hookToolName: "Read",
        toolInput: { filePath: "~/.ssh/id_fixture" },
        securityScriptPath: securityHookPath,
        configuredSecurityCommand: securityHookCommand,
        expectedStatus: "deny",
      },
      {
        name: "validator failure fallback behavior",
        matcher: "Bash",
        pluginTool: "bash",
        hookToolName: "Bash",
        toolInput: { command: "echo fallback" },
        securityScriptPath: brokenSecurityHookPath,
        configuredSecurityCommand: brokenSecurityHookCommand,
        expectedStatus: "ask",
      },
    ];

    try {
      for (const testCase of cases) {
        writeJson(path.join(tmpRoot, "settings.json"), {
          env: {
            PAI_DIR: paiDir,
          },
          hooks: {
            PreToolUse: [
              {
                matcher: testCase.matcher,
                hooks: [{ type: "command", command: passthroughHookCommand }],
              },
              {
                matcher: testCase.matcher,
                hooks: [{ type: "command", command: testCase.configuredSecurityCommand }],
              },
            ],
          },
        });

        const directHookResult = toDecision(
          await runScriptHook({
            scriptPath: testCase.securityScriptPath,
            cwd: process.cwd(),
            env: {
              PAI_DIR: paiDir,
            },
            payload: {
              tool_name: testCase.hookToolName,
              tool_input: testCase.toolInput,
              cwd: process.cwd(),
              session_id: "ses_adapter_contract",
              tool_use_id: "call_adapter_contract",
            },
          }),
        );

        const pluginDecision = await runPluginPreToolDecision({
          configRoot: tmpRoot,
          input: {
            tool: testCase.pluginTool,
            args: testCase.toolInput,
          },
        });

        expect(directHookResult.status).toBe(testCase.expectedStatus);
        if (pluginDecision.status !== directHookResult.status) {
          throw new Error(
            `${testCase.name} mismatch: direct=${directHookResult.status}, plugin=${pluginDecision.status}`,
          );
        }
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
