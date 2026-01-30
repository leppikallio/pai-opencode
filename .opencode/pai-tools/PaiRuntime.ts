/**
 * PaiRuntime.ts
 *
 * Canonical runtime path resolver for PAI-OpenCode tools.
 *
 * Goals:
 * - Prefer $PAI_DIR (explicit runtime root override)
 * - Work in both source tree (<repo>/.opencode) and installed runtime (~/.config/opencode)
 * - Avoid hardcoding legacy ~/.opencode paths
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PaiRuntimeInfo = {
  paiDir: string;
  skillsDir: string;
  agentsDir: string;
  pluginsDir: string;
  memoryDir: string;
  settingsPath: string;
  opencodeConfigPath: string;
};

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function xdgConfigHome(): string {
  const v = process.env.XDG_CONFIG_HOME;
  if (v?.trim()) return v.trim();
  return path.join(os.homedir(), ".config");
}

/**
 * Resolve runtime root (PAI_DIR).
 *
 * Order:
 * 1) $PAI_DIR
 * 2) Parent of this module (source tree or installed runtime)
 * 3) ~/.config/opencode (XDG)
 * 4) ~/.opencode (legacy fallback)
 */
export function getPaiDir(): string {
  const fromEnv = process.env.PAI_DIR;
  if (fromEnv?.trim()) return path.resolve(fromEnv.trim());

  // This file lives at: <paiDir>/pai-tools/PaiRuntime.ts
  // In the repo source tree: <repo>/.opencode/pai-tools/PaiRuntime.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromHere = path.resolve(path.join(here, ".."));
  if (dirExists(path.join(fromHere, "skills")) && dirExists(path.join(fromHere, "plugins"))) {
    return fromHere;
  }

  const xdg = path.join(xdgConfigHome(), "opencode");
  if (dirExists(xdg)) return xdg;

  const legacy = path.join(os.homedir(), ".opencode");
  if (dirExists(legacy)) return legacy;

  // Last resort: return XDG default even if missing.
  return xdg;
}

export function getPaiRuntimeInfo(): PaiRuntimeInfo {
  const paiDir = getPaiDir();
  return {
    paiDir,
    skillsDir: path.join(paiDir, "skills"),
    agentsDir: path.join(paiDir, "agents"),
    pluginsDir: path.join(paiDir, "plugins"),
    memoryDir: path.join(paiDir, "MEMORY"),
    settingsPath: path.join(paiDir, "settings.json"),
    opencodeConfigPath: path.join(paiDir, "opencode.json"),
  };
}

export function getSkillsDir(): string {
  return getPaiRuntimeInfo().skillsDir;
}

export function getMemoryDir(): string {
  return getPaiRuntimeInfo().memoryDir;
}

export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
