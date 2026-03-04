import { describe, expect, test } from "bun:test";

import { buildIdentitySlug } from "../../plugins/handlers/auto-prd";
import { slugify } from "../../plugins/lib/paths";

const IDENTITY_SLUG_PATTERN = /^\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{6,}$/;

describe("identity slug generation", () => {
  test("same second and title but different session IDs produce unique slugs", () => {
    const startedAt = new Date("2026-03-04T12:34:56.900Z");
    const fileSlug = slugify("Align PRD generation to PRDFORMAT v2") || "work-session";

    const slugA = buildIdentitySlug({
      startedAt,
      fileSlug,
      sessionId: "session-identity-abc123",
    });
    const slugB = buildIdentitySlug({
      startedAt,
      fileSlug,
      sessionId: "session-identity-abc124",
    });

    expect(slugA).toMatch(IDENTITY_SLUG_PATTERN);
    expect(slugB).toMatch(IDENTITY_SLUG_PATTERN);
    expect(slugA).not.toBe(slugB);
  });

  test("slug is deterministic for identical inputs", () => {
    const startedAt = new Date("2026-03-04T00:00:00.000Z");
    const fileSlug = slugify("Deterministic identity slug") || "work-session";

    const slugOne = buildIdentitySlug({
      startedAt,
      fileSlug,
      sessionId: "session-stable-id",
    });
    const slugTwo = buildIdentitySlug({
      startedAt,
      fileSlug,
      sessionId: "session-stable-id",
    });

    expect(slugOne).toBe(slugTwo);
    expect(slugOne).toMatch(IDENTITY_SLUG_PATTERN);
    expect(slugOne.startsWith("20260304-000000-")).toBe(true);
  });
});
