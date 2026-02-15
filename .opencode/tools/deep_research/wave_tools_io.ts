import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

export async function statPath(p: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

export async function copyDirContents(
  srcDir: string,
  dstDir: string,
  copiedEntries: string[],
  relativePrefix: string,
): Promise<void> {
  await ensureDir(dstDir);
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    const relPath = path.join(relativePrefix, entry.name);

    if (entry.isDirectory()) {
      await copyDirContents(srcPath, dstPath, copiedEntries, relPath);
      continue;
    }

    if (entry.isFile()) {
      await ensureDir(path.dirname(dstPath));
      await fs.promises.copyFile(srcPath, dstPath);
      copiedEntries.push(relPath);
      continue;
    }

    throw new Error(`unsupported fixture entry type at ${srcPath}`);
  }
}

export function parseJsonSafe(raw: string): { ok: true; value: unknown } | { ok: false; value: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}
