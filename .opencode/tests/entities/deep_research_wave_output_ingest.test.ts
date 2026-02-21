import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  run_init,
  wave_output_ingest,
} from "../../tools/deep_research_cli.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdown(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label}.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    "- (P1) Need more data",
    "",
  ].join("\n");
}

async function writePerspectivesForRun(runRoot: string, runId: string): Promise<string> {
  const fixture = fixturePath("runs", "p03-wave1-plan-min", "perspectives.json");
  const raw = await fs.readFile(fixture, "utf8");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.run_id = runId;

  const target = path.join(runRoot, "perspectives.json");
  await fs.writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return target;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function setWaveDirInManifest(
  manifestPath: string,
  wave: "wave1" | "wave2",
  waveDir: string,
): Promise<void> {
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as any;
  manifest.artifacts = manifest.artifacts ?? {};
  manifest.artifacts.paths = manifest.artifacts.paths ?? {};
  if (wave === "wave1") manifest.artifacts.paths.wave1_dir = waveDir;
  else manifest.artifacts.paths.wave2_dir = waveDir;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("deep_research_wave_output_ingest (entity)", () => {
  test("writes and validates wave1 markdown outputs", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_wave1_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const outRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [
              { perspective_id: "p1", markdown: validMarkdown("p1") },
              { perspective_id: "p2", markdown: validMarkdown("p2") },
            ],
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).wave).toBe("wave1");
        expect((out as any).written_count).toBe(2);
        expect((out as any).validated_count).toBe(2);

        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");
        expect(await fs.readFile(p1Path, "utf8")).toContain("## Findings");
        expect(await fs.readFile(p2Path, "utf8")).toContain("## Sources");
      });
    });
  });

  test("writes wave2 outputs under wave-2 directory", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_wave2_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const outRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave2",
            outputs: [{ perspective_id: "p3", markdown: validMarkdown("p3") }],
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        const p3Path = path.join(runRoot, "wave-2", "p3.md");
        expect(await fs.readFile(p3Path, "utf8")).toContain("## Gaps");
      });
    });
  });

  test("returns validation error codes from wave_output_validate", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_validate_fail_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const invalidMarkdown = [
          "## Findings",
          "No sources section in this markdown.",
          "",
          "## Gaps",
          "- (P1) Missing source citations",
          "",
        ].join("\n");

        const outRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [{ perspective_id: "p1", markdown: invalidMarkdown }],
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("MISSING_REQUIRED_SECTION");

        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        expect(await fileExists(p1Path)).toBe(false);
      });
    });
  });

  test("is transactional when one output fails validation", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_txn_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const invalidMarkdown = [
          "## Findings",
          "P2 missing sources section.",
          "",
          "## Gaps",
          "- (P1) Missing source citations",
          "",
        ].join("\n");

        const outRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [
              { perspective_id: "p1", markdown: validMarkdown("p1") },
              { perspective_id: "p2", markdown: invalidMarkdown },
            ],
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("MISSING_REQUIRED_SECTION");

        const p1Path = path.join(runRoot, "wave-1", "p1.md");
        const p2Path = path.join(runRoot, "wave-1", "p2.md");
        expect(await fileExists(p1Path)).toBe(false);
        expect(await fileExists(p2Path)).toBe(false);
      });
    });
  });

  test("rejects invalid wave directory invariants", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_wave_dir_invariants_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        for (const badWaveDir of [".", "wave-1/../escape"]) {
          await setWaveDirInManifest(manifestPath, "wave1", badWaveDir);

          const outRaw = (await (wave_output_ingest as any).execute(
            {
              manifest_path: manifestPath,
              perspectives_path: perspectivesPath,
              wave: "wave1",
              outputs: [{ perspective_id: "p1", markdown: validMarkdown("p1") }],
            },
            makeToolContext(),
          )) as string;
          const out = parseToolJson(outRaw);

          expect(out.ok).toBe(false);
          expect((out as any).error.code).toBe("INVALID_WAVE_DIR");
        }
      });
    });
  });

  test("rejects symlink wave directory and symlink-segment escapes", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_symlink_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = await writePerspectivesForRun(runRoot, runId);

        const outsideRoot = path.join(base, "outside-root");
        await fs.mkdir(outsideRoot, { recursive: true });

        const waveSymlink = path.join(runRoot, "wave-symlink");
        await fs.symlink(outsideRoot, waveSymlink, "dir");

        await setWaveDirInManifest(manifestPath, "wave1", "wave-symlink");

        const symlinkOutRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [{ perspective_id: "p1", markdown: validMarkdown("p1") }],
          },
          makeToolContext(),
        )) as string;
        const symlinkOut = parseToolJson(symlinkOutRaw);

        expect(symlinkOut.ok).toBe(false);
        expect((symlinkOut as any).error.code).toBe("WAVE_DIR_SYMLINK");

        const outsideSub = path.join(outsideRoot, "nested");
        await fs.mkdir(outsideSub, { recursive: true });
        const segmentLink = path.join(runRoot, "wave-link-parent");
        await fs.symlink(outsideRoot, segmentLink, "dir");
        await setWaveDirInManifest(manifestPath, "wave1", "wave-link-parent/nested");

        const escapedOutRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [{ perspective_id: "p2", markdown: validMarkdown("p2") }],
          },
          makeToolContext(),
        )) as string;
        const escapedOut = parseToolJson(escapedOutRaw);

        expect(escapedOut.ok).toBe(false);
        expect((escapedOut as any).error.code).toBe("PATH_TRAVERSAL");
      });
    });
  });

  test("blocks path traversal from perspective_id", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_wave_ingest_traversal_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const perspectivesPath = path.join(runRoot, "perspectives.json");

        const traversalPerspectives = {
          schema_version: "perspectives.v1",
          run_id: runId,
          created_at: "2026-02-14T00:00:00Z",
          perspectives: [
            {
              id: "../evil",
              title: "Traversal",
              track: "standard",
              agent_type: "ClaudeResearcher",
              prompt_contract: {
                max_words: 100,
                max_sources: 2,
                tool_budget: {},
                must_include_sections: ["Findings", "Sources", "Gaps"],
              },
            },
          ],
        };
        await fs.writeFile(perspectivesPath, `${JSON.stringify(traversalPerspectives, null, 2)}\n`, "utf8");

        const outRaw = (await (wave_output_ingest as any).execute(
          {
            manifest_path: manifestPath,
            perspectives_path: perspectivesPath,
            wave: "wave1",
            outputs: [{ perspective_id: "../evil", markdown: validMarkdown("evil") }],
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("PATH_TRAVERSAL");
      });
    });
  });
});
