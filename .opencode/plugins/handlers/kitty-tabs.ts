/**
 * Kitty Tab State Updates (optional)
 *
 * Implements a small subset of the legacy Claude/Kitty tab-state system for
 * OpenCode by calling Kitty remote control commands.
 *
 * Opt-in only (default OFF): set PAI_KITTY_TABS=1.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileLog, fileLogError } from "../lib/file-logger";

export type KittyTabState =
  | "inference"
  | "working"
  | "awaitingInput"
  | "completed"
  | "error";

function truthyEnv(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isKittyTabsEnabled(): boolean {
  return truthyEnv("PAI_KITTY_TABS");
}

function resolveKittyRcBin(): string {
  // Prefer explicit override.
  const override = (process.env.PAI_KITTY_RC_BIN ?? "").trim();
  if (override) return override;

  // Homebrew (Apple Silicon)
  if (existsSync("/opt/homebrew/bin/kitten")) return "/opt/homebrew/bin/kitten";
  if (existsSync("/opt/homebrew/bin/kitty")) return "/opt/homebrew/bin/kitty";

  // Homebrew (Intel)
  if (existsSync("/usr/local/bin/kitten")) return "/usr/local/bin/kitten";
  if (existsSync("/usr/local/bin/kitty")) return "/usr/local/bin/kitty";

  // Fall back to PATH.
  return "kitten";
}

const KITTY_RC_BIN = resolveKittyRcBin();

function inferShortTitle(seed: string): string {
  const words = seed
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 4);

  return words.length > 0 ? words.join(" ") : "PAI";
}

function buildTabTitle(state: KittyTabState, seed: string): string {
  const title = inferShortTitle(seed);

  switch (state) {
    case "inference":
      return `🧠 ${title}…`;
    case "working":
      return `⚙️ ${title}…`;
    case "awaitingInput":
      return "❓ QUESTION";
    case "completed":
      return `✓ ${title}`;
    case "error":
      return `⚠ ${title}!`;
    default:
      return title;
  }
}

const COLORS = {
  active_bg: "#002B80",
  active_fg: "#FFFFFF",
  inactive_fg: "#A0A0A0",
  inactive_bg: {
    inference: "#1E0A3C",
    working: "#804000",
    awaitingInput: "#085050",
    completed: "#022800",
    error: "#804000",
  } satisfies Record<KittyTabState, string>,
} as const;

function spawnKitten(args: string[]): void {
  try {
    const child = spawn(KITTY_RC_BIN, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      fileLogError(`Kitty tabs: kitten failed (${args[0] ?? "cmd"})`, error);
    });
    child.unref();
  } catch (error) {
    fileLogError("Kitty tabs: spawn failed", error);
  }
}

export function setKittyTabState(state: KittyTabState, seed: string): void {
  if (!isKittyTabsEnabled()) return;

  // We intentionally do NOT hard-gate on TERM/KITTY_* env vars.
  // OpenCode may run with TERM=xterm-256color, and Kitty env can vary.
  // If remote control is unavailable, the spawn simply fails (best-effort).

  const title = buildTabTitle(state, seed);
  const inactive_bg = COLORS.inactive_bg[state];

  // Prefer explicit socket target when available.
  const to = (process.env.KITTY_LISTEN_ON ?? "").trim();
  const prefix = to ? ["@", "--to", to] : ["@"];

  spawnKitten([...prefix, "set-tab-title", title]);

  spawnKitten([
    ...prefix,
    "set-tab-color",
    "--self",
    `active_bg=${COLORS.active_bg}`,
    `active_fg=${COLORS.active_fg}`,
    `inactive_bg=${inactive_bg}`,
    `inactive_fg=${COLORS.inactive_fg}`,
  ]);

  fileLog(`Kitty tabs: set state=${state} title=${JSON.stringify(title)}`, "debug");
}
