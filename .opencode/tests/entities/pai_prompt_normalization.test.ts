import { describe, expect, test } from "bun:test";

import { normalizePromptForArtifacts } from "../../plugins/lib/prompt-normalization";

describe("normalizePromptForArtifacts", () => {
  test("is idempotent", () => {
    const input = "  Keep CASE\r\nAcross\rLines\n  ";

    const once = normalizePromptForArtifacts(input);
    const twice = normalizePromptForArtifacts(once);

    expect(twice).toBe(once);
  });

  test("trims edges and normalizes newlines to LF", () => {
    const input = "\r\n  first line\r\nsecond line\rthird line  \t";

    expect(normalizePromptForArtifacts(input)).toBe("first line\nsecond line\nthird line");
  });

  test("does not apply semantic transforms like lowercasing", () => {
    const input = "  MiXeD Case Prompt\r\n";

    expect(normalizePromptForArtifacts(input)).toBe("MiXeD Case Prompt");
  });
});
