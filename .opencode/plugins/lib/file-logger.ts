/**
 * PAI-OpenCode File Logger
 *
 * TUI-SAFE LOGGING: NEVER use console.log in OpenCode plugins!
 * Console output corrupts the OpenCode TUI.
 *
 * This module provides file-only logging for debugging plugins.
 *
 * @module file-logger
 */

import { appendFileSync, mkdirSync, existsSync, writeFileSync, statSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPaiDir } from "./pai-runtime";

// Log inside the active PAI runtime directory.
// In the repo source tree this resolves to: .opencode/plugins/debug.log
// In the installed runtime this resolves to: ~/.config/opencode/plugins/debug.log
const LOG_PATH = join(getPaiDir(), "plugins", "debug.log");

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let lastRotateCheckAt = 0;

function enabled(): boolean {
  return process.env.PAI_DEBUG === "1";
}

function maybeRotate(): void {
  const now = Date.now();
  if (now - lastRotateCheckAt < 1000) return;
  lastRotateCheckAt = now;

  try {
    const st = statSync(LOG_PATH);
    if (st.size <= MAX_LOG_BYTES) return;
    const rotated = LOG_PATH.replace(/\.log$/, `.${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    renameSync(LOG_PATH, rotated);
  } catch {
    // Best-effort.
  }
}

/**
 * Log a message to file (TUI-safe)
 *
 * IMPORTANT: This function NEVER uses console.log
 * All output goes to $PAI_DIR/plugins/debug.log
 *
 * @param message - The message to log
 * @param level - Log level (info, warn, error, debug)
 */
export function fileLog(
  message: string,
  level: "info" | "warn" | "error" | "debug" = "info"
): void {
  if (!enabled()) return;
  try {
    maybeRotate();
    const timestamp = new Date().toISOString();
    const levelPrefix = level.toUpperCase().padEnd(5);
    const logLine = `[${timestamp}] [${levelPrefix}] ${message}\n`;

    const dir = dirname(LOG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    appendFileSync(LOG_PATH, logLine);
  } catch {
    // Silent fail - NEVER console.log here!
    // TUI corruption is worse than missing logs
  }
}

/**
 * Log an error with stack trace to file
 *
 * @param message - Error context message
 * @param error - The error object
 */
export function fileLogError(message: string, error: unknown): void {
  const errorMessage =
    error instanceof Error
      ? `${error.message}\n${error.stack || ""}`
      : String(error);
  fileLog(`${message}: ${errorMessage}`, "error");
}

/**
 * Get the log file path
 * Useful for telling users where to find logs
 */
export function getLogPath(): string {
  return LOG_PATH;
}

/**
 * Clear the log file
 * Useful at session start
 */
export function clearLog(): void {
  if (!enabled()) return;
  try {
    writeFileSync(LOG_PATH, "");
  } catch {
    // Silent fail
  }
}
