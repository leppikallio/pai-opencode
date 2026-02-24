#!/usr/bin/env bun

export {};

const COMMAND_TIMEOUT_MS = 1200;
const COMMAND_TIMEOUT_SENTINEL = Symbol("command_timeout");

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function isVersionCheckDisabled(): boolean {
  return process.env.PAI_DISABLE_VERSION_CHECK === "1" || process.env.PAI_NO_NETWORK === "1";
}

function isSubagent(): boolean {
  const claudeAgentType = process.env.CLAUDE_AGENT_TYPE ?? "";
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR ?? "";
  return claudeProjectDir.includes("/.claude/Agents/") || claudeAgentType.trim().length > 0;
}

async function readCommandStdout(command: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof COMMAND_TIMEOUT_SENTINEL>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(COMMAND_TIMEOUT_SENTINEL), COMMAND_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        Promise.all([new Response(proc.stdout).text(), proc.exited]).then(([output]) => output.trim()),
        timeout,
      ]);

      if (result === COMMAND_TIMEOUT_SENTINEL) {
        try {
          proc.kill("SIGKILL");
        } catch {
          try {
            proc.kill();
          } catch {
            // Ignore kill failures.
          }
        }

        return "";
      }

      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  } catch {
    return "";
  }
}

function extractVersion(raw: string): string | undefined {
  const match = raw.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1];
}

async function getCurrentVersion(): Promise<string | undefined> {
  const output = await readCommandStdout(["claude", "--version"]);
  return extractVersion(output);
}

async function getLatestVersion(): Promise<string | undefined> {
  const output = await readCommandStdout(["npm", "view", "@anthropic-ai/claude-code", "version"]);
  return extractVersion(output);
}

async function main(): Promise<void> {
  try {
    if (isVersionCheckDisabled()) {
      return;
    }

    if (isSubagent()) {
      return;
    }

    const [currentVersion, latestVersion] = await Promise.all([
      getCurrentVersion(),
      getLatestVersion(),
    ]);

    if (currentVersion && latestVersion && currentVersion !== latestVersion) {
      console.error(`Update available: CC ${currentVersion} -> ${latestVersion}`);
    }
  } catch {
    // Always exit cleanly.
  }
}

await main();
process.exit(0);
