import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface CommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface ExecuteHookOptions {
  forceZsh?: boolean;
  zshPath?: string;
  env?: Record<string, string>;
}

const DEFAULT_ZSH_PATHS = ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"];
const DEFAULT_BASH_PATHS = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"];

function getHomeDirectory(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function findShellPath(defaultPaths: string[], customPath?: string): string | null {
  if (customPath && existsSync(customPath)) {
    return customPath;
  }
  for (const shellPath of defaultPaths) {
    if (existsSync(shellPath)) {
      return shellPath;
    }
  }
  return null;
}

function findZshPath(customZshPath?: string): string | null {
  return findShellPath(DEFAULT_ZSH_PATHS, customZshPath);
}

function findBashPath(): string | null {
  return findShellPath(DEFAULT_BASH_PATHS);
}

function expandEnvironmentVariables(command: string, env: NodeJS.ProcessEnv): string {
  return command.replace(/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/g, (match, bracedName, bareName) => {
    const variableName = (bracedName || bareName) as string;
    const value = env[variableName];
    return value === undefined ? match : value;
  });
}

export function expandHookCommand(command: string, cwd: string, settingsEnv?: Record<string, string>): string {
  const home = getHomeDirectory();
  const expansionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(settingsEnv ?? {}),
    HOME: home,
    CLAUDE_PROJECT_DIR: cwd,
  };

  return expandEnvironmentVariables(
    command.replace(/^~(?=\/|$)/g, home).replace(/\s~(?=\/)/g, ` ${home}`),
    expansionEnv,
  );
}

export async function executeHookCommand(
  command: string,
  stdin: string,
  cwd: string,
  options?: ExecuteHookOptions,
): Promise<CommandResult> {
  const home = getHomeDirectory();
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options?.env ?? {}),
    HOME: home,
    CLAUDE_PROJECT_DIR: cwd,
  };

  const expandedCommand = expandHookCommand(command, cwd, options?.env);

  let finalCommand = expandedCommand;

  if (options?.forceZsh) {
    const zshPath = findZshPath(options.zshPath);
    const escapedCommand = expandedCommand.replace(/'/g, "'\\''");
    if (zshPath) {
      finalCommand = `${zshPath} -lc '${escapedCommand}'`;
    } else {
      const bashPath = findBashPath();
      if (bashPath) {
        finalCommand = `${bashPath} -lc '${escapedCommand}'`;
      }
    }

  }

  if (mergedEnv.PAI_CC_HOOKS_DEBUG === "1") {
    console.warn(`[pai-cc-hooks] Expanded command: ${finalCommand}`);
  }

  return new Promise((resolve) => {
    const proc = spawn(finalCommand, {
      cwd,
      shell: true,
      env: mergedEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.stdin?.write(stdin);
    proc.stdin?.end();

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", (err) => {
      resolve({ exitCode: 1, stderr: err.message });
    });
  });
}
