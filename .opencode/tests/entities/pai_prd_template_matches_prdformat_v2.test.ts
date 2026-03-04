import { describe, expect, test } from "bun:test";

import { generatePRDTemplate } from "../../plugins/lib/prd-template";

describe("PRD template aligns with PRDFORMAT v2", () => {
  test("includes v2 frontmatter fields and required sections", () => {
    const now = new Date("2026-03-04T12:34:56.789Z");
    const template = generatePRDTemplate({
      task: "Align PRD generation to PRDFORMAT v2",
      slug: "20260304-123456-align-prd-generation-abc123",
      effort: "advanced",
      now,
    });

    expect(template.startsWith("---\n")).toBe(true);

    const requiredFrontmatter = [
      'task: "Align PRD generation to PRDFORMAT v2"',
      "slug: 20260304-123456-align-prd-generation-abc123",
      "effort: advanced",
      "phase: observe",
      "progress: 0/0",
      "mode: interactive",
      "started: 2026-03-04T12:34:56.789Z",
      "updated: 2026-03-04T12:34:56.789Z",
    ];

    for (const field of requiredFrontmatter) {
      expect(template).toContain(field);
    }

    const requiredSections = ["## Context", "## Criteria", "## Decisions", "## Verification"];
    for (const section of requiredSections) {
      expect(template).toContain(section);
    }
  });

  test("does not include legacy v1 markers", () => {
    const template = generatePRDTemplate({
      task: "Remove legacy PRD fields",
      slug: "20260304-123456-remove-legacy-prd-fields-abc123",
      now: new Date("2026-03-04T12:34:56.000Z"),
    });

    const legacyMarkers = [
      "effort_level:",
      "verification_summary:",
      "## STATUS",
      "## IDEAL STATE CRITERIA",
    ];

    for (const marker of legacyMarkers) {
      expect(template).not.toContain(marker);
    }
  });
});
