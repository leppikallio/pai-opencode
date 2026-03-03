import { spawn } from "node:child_process";
import path from "node:path";

import { writeCmuxLastError } from "./cmux-debug";

const CMUX_DEFAULT_BIN = "cmux";
const CMUX_BIN_ENV = "PAI_CMUX_BIN";
const CMUX_NOT_FOUND_TTL_MS = 5_000;
const CMUX_TIMEOUT_SIGKILL_GRACE_MS = 100;
const CMUX_TIMEOUT_FINALIZE_WATCHDOG_MS = 300;
const CMUX_TIMEOUT_FINALIZE_NOTE = "cmux timeout finalized after SIGKILL grace without close event";

type CmuxCliResultKind = "ok" | "not_found" | "timeout" | "nonzero_exit" | "spawn_error";

type CmuxCliRunResultBase = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  argv: string[];
  stdout: string;
  stderr: string;
  message?: string;
};

export type CmuxCliRunResult =
  | (CmuxCliRunResultBase & { kind: "ok" })
  | (CmuxCliRunResultBase & { kind: "not_found" })
  | (CmuxCliRunResultBase & { kind: "timeout" })
  | (CmuxCliRunResultBase & { kind: "nonzero_exit" })
  | (CmuxCliRunResultBase & { kind: "spawn_error" });

export type CmuxCliExecRequest = {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
};

export type CmuxCliExecResponse = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

export type CmuxCliExec = (req: CmuxCliExecRequest) => Promise<CmuxCliExecResponse>;

export type RunCmuxCliArgs = {
  args: string[];
  timeoutMs: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  exec?: CmuxCliExec;
};

type ResolvedCmuxBin = {
  bin: string;
  identity: string;
};

let nowProvider: () => number = () => Date.now();
let testExecOverride: CmuxCliExec | null = null;
const unavailableUntilByBinIdentity = new Map<string, number>();

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function normalizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 1_000;
  }

  return Math.max(1, Math.round(timeoutMs));
}

function normalizeArgs(args: string[]): string[] {
  return args.map((arg) => String(arg));
}

function resolveCmuxBin(env: NodeJS.ProcessEnv): { ok: true; value: ResolvedCmuxBin } | { ok: false; message: string } {
  const configured = (env[CMUX_BIN_ENV] ?? "").trim();
  if (!configured) {
    return {
      ok: true,
      value: {
        bin: CMUX_DEFAULT_BIN,
        identity: CMUX_DEFAULT_BIN,
      },
    };
  }

  if (!path.isAbsolute(configured)) {
    return {
      ok: false,
      message: `${CMUX_BIN_ENV} must be an absolute path, received: ${JSON.stringify(configured)}`,
    };
  }

  return {
    ok: true,
    value: {
      bin: configured,
      identity: configured,
    },
  };
}

function makeResult(args: {
  kind: CmuxCliResultKind;
  startedAt: number;
  argv: string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  message?: string;
}): CmuxCliRunResult {
  return {
    kind: args.kind,
    exitCode: args.exitCode ?? null,
    signal: args.signal ?? null,
    durationMs: Math.max(0, nowProvider() - args.startedAt),
    argv: args.argv,
    stdout: args.stdout ?? "",
    stderr: args.stderr ?? "",
    message: args.message,
  };
}

const spawnCmuxCli: CmuxCliExec = async (req) => {
  return await new Promise<CmuxCliExecResponse>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let timedOut = false;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let forceKillHandle: ReturnType<typeof setTimeout> | null = null;
    let timeoutFinalizeHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanupTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
        forceKillHandle = null;
      }
      if (timeoutFinalizeHandle) {
        clearTimeout(timeoutFinalizeHandle);
        timeoutFinalizeHandle = null;
      }
    };

    const appendTimeoutFinalizeNote = () => {
      if (stderr.length > 0 && !stderr.endsWith("\n")) {
        stderr += "\n";
      }
      stderr += CMUX_TIMEOUT_FINALIZE_NOTE;
    };

    const settleResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();
      resolve({
        exitCode,
        stdout,
        stderr,
        signal,
        timedOut,
      });
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();
      reject(error);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(req.bin, req.args, {
        shell: false,
        env: req.env,
        stdio: "pipe",
        windowsHide: true,
      });
    } catch (error) {
      settleReject(error);
      return;
    }

    const killBestEffort = (killSignal: NodeJS.Signals) => {
      try {
        child.kill(killSignal);
      } catch {
        // Best-effort kill only.
      }
    };

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin?.on("error", () => {
      // Best-effort stdin write only.
    });

    child.on("error", (error) => {
      settleReject(error);
    });

    child.on("close", (code, closeSignal) => {
      exitCode = code;
      signal = closeSignal;
      settleResolve();
    });

    if (req.stdin !== undefined) {
      child.stdin?.end(req.stdin);
    } else {
      child.stdin?.end();
    }

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      killBestEffort("SIGTERM");
      forceKillHandle = setTimeout(() => {
        if (!settled) {
          killBestEffort("SIGKILL");
          timeoutFinalizeHandle = setTimeout(() => {
            if (!settled) {
              appendTimeoutFinalizeNote();
              settleResolve();
            }
          }, CMUX_TIMEOUT_FINALIZE_WATCHDOG_MS);
        }
      }, CMUX_TIMEOUT_SIGKILL_GRACE_MS);
    }, req.timeoutMs);
  });
};

function resolveExec(argsExec?: CmuxCliExec): CmuxCliExec {
  return argsExec ?? testExecOverride ?? spawnCmuxCli;
}

function getCachedNotFound(identity: string, nowMs: number): number | null {
  const unavailableUntil = unavailableUntilByBinIdentity.get(identity);
  if (!Number.isFinite(unavailableUntil)) {
    return null;
  }
  if ((unavailableUntil as number) <= nowMs) {
    unavailableUntilByBinIdentity.delete(identity);
    return null;
  }

  return unavailableUntil as number;
}

export async function runCmuxCli(args: RunCmuxCliArgs): Promise<CmuxCliRunResult> {
  const startedAt = nowProvider();
  const env = args.env ?? process.env;
  const resolvedBin = resolveCmuxBin(env);
  const normalizedArgs = normalizeArgs(args.args);

  if (!resolvedBin.ok) {
    const result = makeResult({
      kind: "spawn_error",
      startedAt,
      argv: [CMUX_DEFAULT_BIN, ...normalizedArgs],
      message: resolvedBin.message,
    });

    await writeCmuxLastError({
      kind: "spawn_error",
      argv: result.argv,
      message: result.message,
    });

    return result;
  }

  const argv = [resolvedBin.value.bin, ...normalizedArgs];
  const cachedNotFoundUntil = getCachedNotFound(resolvedBin.value.identity, startedAt);
  if (cachedNotFoundUntil !== null) {
    const remainingMs = Math.max(0, cachedNotFoundUntil - startedAt);
    const result = makeResult({
      kind: "not_found",
      startedAt,
      argv,
      message: `cmux binary unavailable (cached ENOENT, ${remainingMs}ms remaining): ${resolvedBin.value.bin}`,
    });

    await writeCmuxLastError({
      kind: "not_found",
      argv: result.argv,
      message: result.message,
    });

    return result;
  }

  const timeoutMs = normalizeTimeoutMs(args.timeoutMs);
  const exec = resolveExec(args.exec);

  try {
    const response = await exec({
      bin: resolvedBin.value.bin,
      args: normalizedArgs,
      env,
      stdin: args.stdin,
      timeoutMs,
    });

    unavailableUntilByBinIdentity.delete(resolvedBin.value.identity);

    if (response.timedOut) {
      const result = makeResult({
        kind: "timeout",
        startedAt,
        argv,
        exitCode: response.exitCode,
        signal: response.signal,
        stdout: response.stdout,
        stderr: response.stderr,
        message: `cmux command timed out after ${timeoutMs}ms`,
      });

      await writeCmuxLastError({
        kind: "timeout",
        argv: result.argv,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        message: result.message,
      });

      return result;
    }

    if (response.exitCode === 0) {
      return makeResult({
        kind: "ok",
        startedAt,
        argv,
        exitCode: response.exitCode,
        signal: response.signal,
        stdout: response.stdout,
        stderr: response.stderr,
      });
    }

    const result = makeResult({
      kind: "nonzero_exit",
      startedAt,
      argv,
      exitCode: response.exitCode,
      signal: response.signal,
      stdout: response.stdout,
      stderr: response.stderr,
      message: `cmux command exited with code ${response.exitCode ?? "null"}`,
    });

    await writeCmuxLastError({
      kind: "nonzero_exit",
      argv: result.argv,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      message: result.message,
    });

    return result;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      unavailableUntilByBinIdentity.set(resolvedBin.value.identity, nowProvider() + CMUX_NOT_FOUND_TTL_MS);
      const result = makeResult({
        kind: "not_found",
        startedAt,
        argv,
        message: `cmux binary not found: ${resolvedBin.value.bin}`,
      });

      await writeCmuxLastError({
        kind: "not_found",
        argv: result.argv,
        message: result.message,
      });

      return result;
    }

    const message = error instanceof Error ? error.message : String(error);
    const result = makeResult({
      kind: "spawn_error",
      startedAt,
      argv,
      message: `cmux spawn failed: ${message}`,
    });

    await writeCmuxLastError({
      kind: "spawn_error",
      argv: result.argv,
      message: result.message,
    });

    return result;
  }
}

export function __testOnlyResetCmuxCliState(): void {
  unavailableUntilByBinIdentity.clear();
  nowProvider = () => Date.now();
  testExecOverride = null;
}

export function __testOnlyConfigureNow(nowFn: () => number): void {
  nowProvider = nowFn;
}

export function __testOnlySetCmuxCliExec(exec: CmuxCliExec | null): void {
  testExecOverride = exec;
}
