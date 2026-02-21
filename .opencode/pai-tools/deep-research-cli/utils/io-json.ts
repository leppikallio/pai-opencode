import * as fs from "node:fs/promises";

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`JSON object expected at ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

export async function readJsonlRecords(filePath: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
