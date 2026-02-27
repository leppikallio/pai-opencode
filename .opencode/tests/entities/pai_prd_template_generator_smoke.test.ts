import { describe, expect, test } from "bun:test";

import { generatePRDFilename, generatePRDId, generatePRDTemplate } from "../../plugins/lib/prd-template";

describe("generatePRDTemplate", () => {
  test("includes required PRD frontmatter keys and core sections", () => {
    const now = new Date("2031-12-31T23:59:59.000Z");
    const template = generatePRDTemplate({
      title: "Memory Parity PRD",
      slug: "memory-parity",
      now,
    });

    const requiredFrontmatter = [
      "prd: true",
      "status: DRAFT",
      "mode: interactive",
      "effort_level: Standard",
      "iteration: 0",
      "maxIterations: 128",
      "loopStatus: null",
      "last_phase: null",
      "failing_criteria: []",
      'verification_summary: "0/0"',
      "parent: null",
      "children: []",
    ];

    for (const key of requiredFrontmatter) {
      expect(template).toContain(key);
    }

    const requiredHeadings = [
      "## STATUS",
      "## CONTEXT",
      "## PLAN",
      "## IDEAL STATE CRITERIA (Verification Criteria)",
      "## DECISIONS",
      "## LOG",
    ];

    for (const heading of requiredHeadings) {
      expect(template).toContain(heading);
    }

    expect(template).toContain("created: 2031-12-31");
    expect(template).toContain("updated: 2031-12-31");
  });

  test("generatePRDId and generatePRDFilename use the same UTC day", () => {
    const now = new Date("2031-01-02T00:00:00.000Z");
    expect(generatePRDId("x", now)).toBe("PRD-20310102-x");
    expect(generatePRDFilename("x", now)).toBe("PRD-20310102-x.md");
  });

  test("prompt is capped at 500 characters", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const long = "a".repeat(900);
    const prd = generatePRDTemplate({ title: "T", slug: "t", prompt: long, now });
    expect(prd).toContain(`### Problem Space\n${"a".repeat(500)}\n`);
    expect(prd).not.toContain("a".repeat(700));
  });

  test("mode and effort overrides are reflected in frontmatter", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const prd = generatePRDTemplate({
      title: "T",
      slug: "t",
      mode: "loop",
      effortLevel: "Thorough",
      now,
    });
    expect(prd).toContain("mode: loop");
    expect(prd).toContain("effort_level: Thorough");
  });

  test("omitted prompt uses placeholder", () => {
    const now = new Date("2031-06-01T12:00:00.000Z");
    const prd = generatePRDTemplate({ title: "T", slug: "t", now });
    expect(prd).toContain("### Problem Space\n_To be populated during OBSERVE phase._\n");
  });
});
