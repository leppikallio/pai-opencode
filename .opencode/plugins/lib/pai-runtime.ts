/**
 * PAI Runtime Directory Resolver
 *
 * In OpenCode, global config lives at:
 *   ~/.config/opencode/
 *
 * This repo stores source files under:
 *   <repo>/.opencode/
 *
 * After installation, these plugin files live under:
 *   ~/.config/opencode/plugins/
 *
 * This helper resolves the *active runtime root* (PAI_DIR) without assuming
 * the current working directory.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";

export type PaiRuntimeInfo = {
  paiDir: string;
  settingsPath: string;
  opencodeConfigPath: string;
};

function xdgConfigHome(): string {
  const fromEnv = process.env.XDG_CONFIG_HOME;
  if (fromEnv?.trim()) return fromEnv.trim();
  return join(os.homedir(), ".config");
}

function defaultPaiDir(): string {
  return join(xdgConfigHome(), "opencode");
}

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve PAI runtime root directory.
 *
 * Order:
 * 1) $PAI_DIR (explicit override)
 * 2) Parent of this plugin tree (installed runtime)
 * 3) ~/.config/opencode (OpenCode global config)
 * 4) ~/.opencode (legacy fallback)
 */
export function getPaiDir(): string {
  const fromEnv = process.env.PAI_DIR;
  if (fromEnv?.trim()) return resolve(fromEnv.trim());

  // This file lives at: <paiDir>/plugins/lib/pai-runtime.ts (installed)
  // or: <repo>/.opencode/plugins/lib/pai-runtime.ts (source tree)
  const here = dirname(fileURLToPath(import.meta.url));
  const fromHere = resolve(join(here, "..", "..", ".."));
  if (dirExists(join(fromHere, "plugins")) && dirExists(join(fromHere, "skills"))) {
    return fromHere;
  }

  const xdg = defaultPaiDir();
  if (dirExists(xdg)) return xdg;

  const legacy = join(os.homedir(), ".opencode");
  if (dirExists(legacy)) return legacy;

  // Last resort: return the default path even if it does not exist.
  return xdg;
}

export function getPaiRuntimeInfo(): PaiRuntimeInfo {
  const paiDir = getPaiDir();
  return {
    paiDir,
    settingsPath: join(paiDir, "settings.json"),
    opencodeConfigPath: join(paiDir, "opencode.json"),
  };
}
