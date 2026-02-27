#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

import { runCmuxCli, type CmuxCliRunResult } from "../.opencode/plugins/pai-cc-hooks/shared/cmux-cli";
import { getPaiDir } from "../.opencode/plugins/lib/pai-runtime";

const DEFAULT_TIMEOUT_MS = 1_000;
const CMUX_ENV_KEYS = [
  "CMUX_SOCKET_PATH",
  "CMUX_WORKSPACE_ID",
  "CMUX_SURFACE_ID",
  "CMUX_TAB_ID",
  "CMUX_PANEL_ID",
];

type RunCmuxHealthOptions = {
  writeLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

type CommandCheckResult = {
  result: CmuxCliRunResult;
  parsedJson?: unknown;
  parseError?: string;
};

function safeWriteLine(writeLine: (line: string) => void, line: string): void {
  try {
    writeLine(line);
  } catch {
    // Best-effort output only.
  }
}

function normalizedEnvValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatEnvValue(value: string | null): string {
  return value ?? "(unset)";
}

function summarizeResult(writeLine: (line: string) => void, result: CmuxCliRunResult): void {
  safeWriteLine(writeLine, `kind=${result.kind}`);
  if (result.exitCode !== null) {
    safeWriteLine(writeLine, `exitCode=${result.exitCode}`);
  }
  if (result.signal) {
    safeWriteLine(writeLine, `signal=${result.signal}`);
  }
  if (result.message) {
    safeWriteLine(writeLine, `message=${result.message}`);
  }

  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    safeWriteLine(writeLine, `stdout=${stdout}`);
  }

  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    safeWriteLine(writeLine, `stderr=${stderr}`);
  }
}

async function runCommand(args: {
  label: string;
  cmuxArgs: string[];
  env: NodeJS.ProcessEnv;
  writeLine: (line: string) => void;
  parseJson?: boolean;
}): Promise<CommandCheckResult> {
  safeWriteLine(args.writeLine, `${args.label}:`);

  let result: CmuxCliRunResult;
  try {
    result = await runCmuxCli({
      args: args.cmuxArgs,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      env: args.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      kind: "spawn_error",
      exitCode: null,
      signal: null,
      durationMs: 0,
      argv: ["cmux", ...args.cmuxArgs],
      stdout: "",
      stderr: "",
      message,
    };
  }

  summarizeResult(args.writeLine, result);

  if (!args.parseJson) {
    safeWriteLine(args.writeLine, "");
    return { result };
  }

  if (result.kind !== "ok") {
    safeWriteLine(args.writeLine, "");
    return { result };
  }

  const raw = result.stdout.trim();
  if (raw.length === 0) {
    safeWriteLine(args.writeLine, "capabilities_json=(empty)");
    safeWriteLine(args.writeLine, "");
    return { result, parseError: "empty" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const accessMode =
      parsed && typeof parsed === "object" && "access_mode" in parsed
        ? String((parsed as Record<string, unknown>).access_mode)
        : "(missing)";

    safeWriteLine(args.writeLine, `access_mode=${accessMode}`);
    safeWriteLine(args.writeLine, "");
    return { result, parsedJson: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    safeWriteLine(args.writeLine, `capabilities_parse_error=${message}`);
    safeWriteLine(args.writeLine, "");
    return { result, parseError: message };
  }
}

function readBreadcrumb(writeLine: (line: string) => void): { exists: boolean; path: string } {
  let breadcrumbPath = "(unavailable)";

  try {
    breadcrumbPath = path.join(getPaiDir(), "MEMORY", "STATE", "cmux-last-error.json");
    safeWriteLine(writeLine, `cmux_last_error_path=${breadcrumbPath}`);

    if (!fs.existsSync(breadcrumbPath)) {
      safeWriteLine(writeLine, "cmux_last_error=not_found");
      safeWriteLine(writeLine, "");
      return { exists: false, path: breadcrumbPath };
    }

    const raw = fs.readFileSync(breadcrumbPath, "utf-8").trim();
    if (raw.length === 0) {
      safeWriteLine(writeLine, "cmux_last_error=empty_file");
      safeWriteLine(writeLine, "");
      return { exists: true, path: breadcrumbPath };
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const kind = typeof parsed.kind === "string" ? parsed.kind : "(unknown)";
      const reason = typeof parsed.reason === "string" ? parsed.reason : "";
      safeWriteLine(writeLine, `cmux_last_error_kind=${kind}`);
      if (reason) {
        safeWriteLine(writeLine, `cmux_last_error_reason=${reason}`);
      }
    } catch {
      safeWriteLine(writeLine, `cmux_last_error_raw=${raw}`);
    }

    safeWriteLine(writeLine, "");
    return { exists: true, path: breadcrumbPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    safeWriteLine(writeLine, `cmux_last_error_read_failed=${message}`);
    safeWriteLine(writeLine, "");
    return { exists: false, path: breadcrumbPath };
  }
}

export async function runCmuxHealth(options: RunCmuxHealthOptions = {}): Promise<void> {
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;

  safeWriteLine(writeLine, "cmux health check");
  safeWriteLine(writeLine, "");

  const version = await runCommand({
    label: "cmux version",
    cmuxArgs: ["version"],
    env,
    writeLine,
  });

  safeWriteLine(writeLine, "CMUX environment:");
  for (const key of CMUX_ENV_KEYS) {
    safeWriteLine(writeLine, `${key}=${formatEnvValue(normalizedEnvValue(env, key))}`);
  }
  safeWriteLine(writeLine, "");

  const ping = await runCommand({
    label: "cmux ping",
    cmuxArgs: ["ping"],
    env,
    writeLine,
  });

  const capabilities = await runCommand({
    label: "cmux capabilities --json",
    cmuxArgs: ["capabilities", "--json"],
    env,
    writeLine,
    parseJson: true,
  });

  const sidebar = await runCommand({
    label: "cmux sidebar-state",
    cmuxArgs: ["sidebar-state"],
    env,
    writeLine,
  });

  const breadcrumb = readBreadcrumb(writeLine);

  safeWriteLine(writeLine, "diagnosis:");
  let emittedDiagnosis = false;
  if (version.result.kind === "not_found") {
    safeWriteLine(writeLine, "- cmux binary is not available; set PATH or PAI_CMUX_BIN.");
    emittedDiagnosis = true;
  }
  if (ping.result.kind !== "ok") {
    safeWriteLine(writeLine, "- cmux ping failed; verify cmux target/session auth.");
    emittedDiagnosis = true;
  }
  if (capabilities.result.kind === "ok" && capabilities.parseError) {
    safeWriteLine(writeLine, "- capabilities JSON is malformed; check cmux CLI/version.");
    emittedDiagnosis = true;
  }
  if (capabilities.result.kind !== "ok") {
    safeWriteLine(writeLine, "- capabilities check failed; cmux may be unavailable or unauthenticated.");
    emittedDiagnosis = true;
  }

  const workspaceSet = normalizedEnvValue(env, "CMUX_WORKSPACE_ID") !== null;
  const surfaceSet = normalizedEnvValue(env, "CMUX_SURFACE_ID") !== null;
  if (!workspaceSet && !surfaceSet) {
    safeWriteLine(writeLine, "- CMUX_WORKSPACE_ID and CMUX_SURFACE_ID are unset in this process.");
    emittedDiagnosis = true;
  }
  if (sidebar.result.kind !== "ok") {
    safeWriteLine(writeLine, "- sidebar-state failed; sidebar/read APIs may not be reachable.");
    emittedDiagnosis = true;
  }
  if (breadcrumb.exists) {
    safeWriteLine(writeLine, `- inspect breadcrumb at ${breadcrumb.path}`);
    emittedDiagnosis = true;
  }
  if (!emittedDiagnosis) {
    safeWriteLine(writeLine, "- no obvious issues detected.");
  }
}

if (import.meta.main) {
  runCmuxHealth({
    writeLine: (line) => console.log(line),
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`cmux-health: unexpected failure (suppressed): ${message}`);
  });
}
