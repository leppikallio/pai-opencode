import { describe, expect, test } from "bun:test";
import { emitMdWithFrontmatter, parseMdWithFrontmatter } from "./markdown";

describe("parseMdWithFrontmatter", () => {
  test("parses YAML keys when frontmatter is present", () => {
    const input = "---\ntitle: Sample\ncount: 3\n---\nBody\n";
    const result = parseMdWithFrontmatter(input);

    expect(result.data).toEqual({ title: "Sample", count: 3 });
    expect(result.body).toBe("Body\n");
  });

  test("returns empty data when no frontmatter exists", () => {
    const input = "# Heading\n\nPlain markdown body\n";
    const result = parseMdWithFrontmatter(input);

    expect(result.data).toEqual({});
    expect(result.body).toBe(input);
  });

  test("preserves body exactly after frontmatter separator", () => {
    const input = "---\nname: demo\n---\n\n\nStarts with two blank lines\n";
    const result = parseMdWithFrontmatter(input);

    expect(result.body).toBe("\n\nStarts with two blank lines\n");
  });
});

describe("emitMdWithFrontmatter", () => {
  test("emits parseable markdown for simple roundtrip data", () => {
    const emitted = emitMdWithFrontmatter({
      data: { title: "Roundtrip", published: true },
      body: "Hello world",
    });

    const reparsed = parseMdWithFrontmatter(emitted);

    expect(reparsed.data).toEqual({ title: "Roundtrip", published: true });
    expect(reparsed.body).toBe("Hello world\n");
  });
});
