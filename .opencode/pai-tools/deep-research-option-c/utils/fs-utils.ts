import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export async function writeCheckpoint(args: {
  logsDirAbs: string;
  filename: string;
  content: string;
}): Promise<string> {
  const outPath = path.join(args.logsDirAbs, args.filename);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${args.content.trim()}\n`, "utf8");
  return outPath;
}
