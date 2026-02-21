import { sha256HexLowerUtf8 } from "../../../tools/deep_research_cli/lifecycle_lib";

export function stableDigest(value: Record<string, unknown>): string {
  return `sha256:${sha256HexLowerUtf8(JSON.stringify(value))}`;
}

export function promptDigestFromPromptMarkdown(promptMd: string): string {
  return `sha256:${sha256HexLowerUtf8(promptMd)}`;
}

export function normalizePromptDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^sha256:[a-f0-9]{64}$/u.test(trimmed)) return trimmed;
  if (/^[a-f0-9]{64}$/u.test(trimmed)) return `sha256:${trimmed}`;
  return null;
}
