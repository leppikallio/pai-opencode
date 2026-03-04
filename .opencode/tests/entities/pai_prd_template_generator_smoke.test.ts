import { describe, expect, test } from "bun:test";

import { generatePRDFilename, generatePRDId, generatePRDTemplate } from "../../plugins/lib/prd-template";

describe("generatePRDTemplate", () => {
  test("includes required PRD frontmatter keys and core sections", () => {
    const now = new Date("2031-12-31T23:59:59.000Z");
    const template = generatePRDTemplate({
      task: "Memory Parity PRD",
      slug: "20311231-235959-memory-parity-prd-abc123",
      now,
    });

    const requiredFrontmatter = [
      'task: "Memory Parity PRD"',
      "slug: 20311231-235959-memory-parity-prd-abc123",
      "effort: standard",
      "phase: observe",
      "progress: 0/0",
      "mode: interactive",
      "started: 2031-12-31T23:59:59.000Z",
      "updated: 2031-12-31T23:59:59.000Z",
    ];

    for (const key of requiredFrontmatter) {
      expect(template).toContain(key);
    }

    const requiredHeadings = ["## Context", "## Criteria", "## Decisions", "## Verification"];

    for (const heading of requiredHeadings) {
      expect(template).toContain(heading);
    }
  });

  test("generatePRDId and generatePRDFilename use the same UTC day", () => {
    const now = new Date("2031-01-02T00:00:00.000Z");
    expect(generatePRDId("x", now)).toBe("PRD-20310102-x");
    expect(generatePRDFilename("x", now)).toBe("PRD-20310102-x.md");
  });

  test("prompt is capped at 500 characters", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const long = "a".repeat(900);
    const prd = generatePRDTemplate({ task: "T", slug: "20310601-120000-t-abc123", prompt: long, now });
    expect(prd).toContain(`### Problem Space\n${"a".repeat(500)}\n`);
    expect(prd).not.toContain("a".repeat(700));
  });

  test("mode and effort overrides are reflected in frontmatter", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const prd = generatePRDTemplate({
      task: "T",
      slug: "20310601-120000-t-abc123",
      mode: "loop",
      effort: "advanced",
      now,
    });
    expect(prd).toContain("mode: loop");
    expect(prd).toContain("effort: advanced");
  });

  test("omitted prompt uses placeholder", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const prd = generatePRDTemplate({ task: "T", slug: "20310601-120000-t-abc123", now });
    expect(prd).toContain("### Problem Space\n_To be populated during OBSERVE phase._\n");
  });
});
