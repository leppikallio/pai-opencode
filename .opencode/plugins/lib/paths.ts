/**
 * PAI-OpenCode Path Utilities
 *
 * Canonical path construction for MEMORY, WORK, LEARNING directories.
 * Mirrors PAI v2.4 hooks/lib/paths.ts
 *
 * @module paths
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { getPaiDir } from "./pai-runtime";

/**
 * Get the PAI runtime directory path.
 *
 * For global installs this is usually: ~/.config/opencode
 */
export function getOpenCodeDir(): string {
  return getPaiDir();
}

/**
 * Get MEMORY directory path
 */
export function getMemoryDir(): string {
  return path.join(getOpenCodeDir(), "MEMORY");
}

/**
 * Get WORK directory path (for session tracking)
 */
export function getWorkDir(): string {
  return path.join(getMemoryDir(), "WORK");
}

/**
 * Get LEARNING directory path
 */
export function getLearningDir(): string {
  return path.join(getMemoryDir(), "LEARNING");
}

/**
 * Get RESEARCH directory path (for agent outputs)
 */
export function getResearchDir(): string {
  return path.join(getMemoryDir(), "RESEARCH");
}

/**
 * Get STATE directory path
 */
export function getStateDir(): string {
  return path.join(getMemoryDir(), "STATE");
}

/**
 * Get current year-month string (YYYY-MM)
 */
export function getYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get ISO timestamp for filenames
 */
export function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Get date string (YYYY-MM-DD)
 */
export function getDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate session ID from timestamp
 */
export function generateSessionId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const random = Math.random().toString(36).substring(2, 6);
  return `${timestamp}_${random}`;
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Get current work session path from state file
 */
export async function getCurrentWorkPath(): Promise<string | null> {
  const stateFile = path.join(getStateDir(), "current-work.json");

  try {
    const content = await fs.promises.readFile(stateFile, "utf-8");
    const state = JSON.parse(content);
    return state.work_dir || null;
  } catch {
    // Ensure the state file exists (best effort) so docs remain accurate.
    try {
      await ensureDir(getStateDir());
      await fs.promises.writeFile(
        stateFile,
        JSON.stringify({ work_dir: null }, null, 2)
      );
    } catch {
      // Best effort only
    }
    return null;
  }
}

/**
 * Set current work session path in state file
 */
export async function setCurrentWorkPath(workPath: string): Promise<void> {
  const stateDir = getStateDir();
  await ensureDir(stateDir);

  const stateFile = path.join(stateDir, "current-work.json");
  const state = {
    work_dir: workPath,
    started_at: new Date().toISOString(),
  };

  await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Clear current work session
 */
export async function clearCurrentWork(): Promise<void> {
  const stateFile = path.join(getStateDir(), "current-work.json");

  try {
    await ensureDir(getStateDir());
    await fs.promises.writeFile(
      stateFile,
      JSON.stringify(
        {
          work_dir: null,
          cleared_at: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    // Best effort: absence is acceptable
  }
}

/**
 * Slugify text for filenames
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
