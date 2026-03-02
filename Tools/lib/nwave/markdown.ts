import YAML from "yaml";

export type MdDoc = { data: Record<string, unknown>; body: string };

const FRONTMATTER_START = "---\n";
const FRONTMATTER_END = "\n---\n";

export function parseMdWithFrontmatter(input: string): MdDoc {
  if (!input.startsWith(FRONTMATTER_START)) {
    return { data: {}, body: input };
  }

  const endIndex = input.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (endIndex === -1) {
    return { data: {}, body: input };
  }

  const rawFrontmatter = input.slice(FRONTMATTER_START.length, endIndex);
  const body = input.slice(endIndex + FRONTMATTER_END.length);

  try {
    const parsed = YAML.parse(rawFrontmatter) as unknown;
    const data: Record<string, unknown> =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { data, body };
  } catch {
    return { data: {}, body };
  }
}

export function emitMdWithFrontmatter(args: MdDoc): string {
  const body = args.body.endsWith("\n") ? args.body : `${args.body}\n`;
  const keys = Object.keys(args.data);
  if (keys.length === 0) return body;

  const yaml = YAML.stringify(args.data).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}
