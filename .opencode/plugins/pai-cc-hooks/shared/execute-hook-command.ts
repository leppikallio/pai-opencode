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

function expandVariableReferences(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/g, (match, bracedName, bareName) => {
    const variableName = (bracedName || bareName) as string;
    const resolvedValue = env[variableName];
    return resolvedValue === undefined ? match : resolvedValue;
  });
}

function isSelfPlaceholder(value: string, key: string): boolean {
  return value === `\${${key}}` || value === `$${key}`;
}

function resolveSettingsEnv(settingsEnv?: Record<string, string>): Record<string, string> {
  if (!settingsEnv) {
    return {};
  }

  const resolvedSettingsEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(settingsEnv)) {
    const resolvedValue = expandVariableReferences(value, process.env);

    if (isSelfPlaceholder(resolvedValue, key)) {
      continue;
    }

    resolvedSettingsEnv[key] = resolvedValue;
  }

  return resolvedSettingsEnv;
}

function buildHookEnvironment(cwd: string, settingsEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const home = getHomeDirectory();
  const resolvedSettingsEnv = resolveSettingsEnv(settingsEnv);

  return {
    ...process.env,
    ...resolvedSettingsEnv,
    HOME: home,
    CLAUDE_PROJECT_DIR: cwd,
  };
}

function expandEnvironmentVariables(command: string, env: NodeJS.ProcessEnv): string {
  let output = "";
  let inSingleQuotes = false;

  for (let i = 0; i < command.length; i += 1) {
    const character = command[i];

    if (character === "'") {
      inSingleQuotes = !inSingleQuotes;
      output += character;
      continue;
    }

    if (!inSingleQuotes && character === "$") {
      const nextCharacter = command[i + 1];

      if (nextCharacter === "{") {
        let variableEnd = i + 2;

        while (variableEnd < command.length && /[A-Z0-9_]/.test(command[variableEnd] ?? "")) {
          variableEnd += 1;
        }

        if (variableEnd > i + 2 && command[variableEnd] === "}") {
          const variableName = command.slice(i + 2, variableEnd);
          const resolvedValue = env[variableName];
          output += resolvedValue === undefined ? command.slice(i, variableEnd + 1) : resolvedValue;
          i = variableEnd;
          continue;
        }
      } else {
        let variableEnd = i + 1;

        while (variableEnd < command.length && /[A-Z0-9_]/.test(command[variableEnd] ?? "")) {
          variableEnd += 1;
        }

        if (variableEnd > i + 1) {
          const variableName = command.slice(i + 1, variableEnd);
          const resolvedValue = env[variableName];
          output += resolvedValue === undefined ? command.slice(i, variableEnd) : resolvedValue;
          i = variableEnd - 1;
          continue;
        }
      }
    }

    output += character;
  }

  return output;
}

export function expandHookCommand(command: string, cwd: string, settingsEnv?: Record<string, string>): string {
  const expansionEnv = buildHookEnvironment(cwd, settingsEnv);
  const home = expansionEnv.HOME ?? getHomeDirectory();

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
  const mergedEnv = buildHookEnvironment(cwd, options?.env);

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
