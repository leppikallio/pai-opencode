import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import { wave_review } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson } from "../helpers/dr-harness";

describe("deep_research_wave_review (entity)", () => {
  const testsRoot = path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "tests")
    : path.resolve(process.cwd(), ".opencode", "tests");

  const fixture = (...parts: string[]) =>
    path.resolve(testsRoot, "fixtures", "wave-review", ...parts);

  const perspectivesPath = fixture("perspectives.json");
  const outputsPassDir = fixture("outputs-pass");
  const outputsFailDir = fixture("outputs-fail");

  test("returns PASS with lexicographically ordered results", async () => {
    const outRaw = (await (wave_review as any).execute(
      {
        perspectives_path: perspectivesPath,
        outputs_dir: outputsPassDir,
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(true);
    expect((out as any).pass).toBe(true);
    expect((out as any).validated).toBe(3);
    expect((out as any).failed).toBe(0);

    const results = (out as any).results as Array<any>;
    expect(results.map((entry) => entry.perspective_id)).toEqual(["p1", "p2", "p3"]);
    expect(results.every((entry) => entry.pass === true)).toBe(true);
    expect(results.every((entry) => entry.failure === null)).toBe(true);

    expect((out as any).retry_directives).toEqual([]);
    expect((out as any).report.failures_sample).toEqual([]);
    expect((out as any).report.failures_omitted).toBe(0);
  });

  test("returns bounded FAIL retry directives in stable order", async () => {
    const outRaw = (await (wave_review as any).execute(
      {
        perspectives_path: perspectivesPath,
        outputs_dir: outputsFailDir,
        perspective_ids: ["p3", "p1", "p2"],
        max_failures: 2,
      },
      makeToolContext(),
    )) as string;
    const out = parseToolJson(outRaw);

    expect(out.ok).toBe(true);
    expect((out as any).pass).toBe(false);
    expect((out as any).validated).toBe(3);
    expect((out as any).failed).toBe(3);

    const results = (out as any).results as Array<any>;
    expect(results.map((entry) => entry.perspective_id)).toEqual(["p1", "p2", "p3"]);

    const byId = new Map(results.map((entry) => [entry.perspective_id, entry]));
    expect(byId.get("p1")?.failure?.code).toBe("MISSING_REQUIRED_SECTION");
    expect(byId.get("p2")?.failure?.code).toBe("TOO_MANY_WORDS");
    expect(byId.get("p3")?.failure?.code).toBe("MALFORMED_SOURCES");

    const directives = (out as any).retry_directives as Array<any>;
    expect(directives.map((entry) => entry.perspective_id)).toEqual(["p1", "p2"]);
    expect(directives.map((entry) => entry.blocking_error_code)).toEqual([
      "MISSING_REQUIRED_SECTION",
      "TOO_MANY_WORDS",
    ]);

    expect((out as any).report.failures_sample).toEqual(["p1", "p2"]);
    expect((out as any).report.failures_omitted).toBe(1);
  });

  test("is deterministic for fixed inputs", async () => {
    const args = {
      perspectives_path: perspectivesPath,
      outputs_dir: outputsFailDir,
      perspective_ids: ["p2", "p1", "p3"],
      max_failures: 2,
    };

    const firstRaw = (await (wave_review as any).execute(args, makeToolContext())) as string;
    const secondRaw = (await (wave_review as any).execute(args, makeToolContext())) as string;

    const first = parseToolJson(firstRaw);
    const second = parseToolJson(secondRaw);

    expect(first).toEqual(second);
  });
});
