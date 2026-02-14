import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import { wave_output_validate } from "../../tools/deep_research.ts";
import { fixturePath, makeToolContext, parseToolJson } from "../helpers/dr-harness";

describe("deep_research_wave_output_validate (entity)", () => {
  const fixture = (name: string) => fixturePath("wave-output", name);
  const perspectivesPath = fixture("perspectives.json");
  const perspectiveId = "p1";

  test("returns ok for valid markdown contract", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: fixture("valid.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(true);
    expect((out as any).perspective_id).toBe(perspectiveId);
    expect((out as any).sources).toBe(2);
    expect((out as any).missing_sections).toEqual([]);
  });

  test("returns MISSING_REQUIRED_SECTION when Sources heading is absent", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: fixture("missing-sources.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(false);
    expect((out as any).error.code).toBe("MISSING_REQUIRED_SECTION");
    expect((out as any).error.details.section).toBe("Sources");
  });

  test("returns TOO_MANY_SOURCES when source count exceeds max", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: fixture("too-many-sources.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(false);
    expect((out as any).error.code).toBe("TOO_MANY_SOURCES");
    expect((out as any).error.details.max_sources).toBe(2);
    expect((out as any).error.details.sources).toBe(3);
  });

  test("returns TOO_MANY_WORDS when word count exceeds contract", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: fixture("too-many-words.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(false);
    expect((out as any).error.code).toBe("TOO_MANY_WORDS");
  });

  test("returns MALFORMED_SOURCES for malformed entries in Sources section", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: perspectiveId,
        markdown_path: fixture("malformed-sources.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(false);
    expect((out as any).error.code).toBe("MALFORMED_SOURCES");
  });

  test("returns PERSPECTIVE_NOT_FOUND for unknown perspective id", async () => {
    const outRaw = (await (wave_output_validate as any).execute(
      {
        perspectives_path: perspectivesPath,
        perspective_id: "missing-id",
        markdown_path: fixture("valid.md"),
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(false);
    expect((out as any).error.code).toBe("PERSPECTIVE_NOT_FOUND");
  });
});
