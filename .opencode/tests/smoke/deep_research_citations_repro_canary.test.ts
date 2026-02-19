import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as deepResearch from "../../tools/deep_research.ts";

import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const run_init = ((deepResearch as any).run_init ?? (deepResearch as any).deep_research_run_init) as any | undefined;
const citations_validate = ((deepResearch as any).citations_validate ??
  (deepResearch as any).deep_research_citations_validate) as any | undefined;

describe("deep_research canary (M4 citations reproducibility)", () => {
  const maybeTest = run_init && citations_validate ? test : test.skip;

  maybeTest("online citations writes replayable fixtures; replay yields identical citations.jsonl", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const baseReal = await fs.realpath(base).catch(() => base);
        const runId = `dr_smoke_m4_${Date.now()}`;

        const initRaw = (await (run_init as any).execute(
          {
            query: "smoke:M4",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: baseReal,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        const citationsDir = path.join(runRoot, "citations");
        await fs.mkdir(citationsDir, { recursive: true });

        // Make checked_at deterministic across replay runs.
        const manifestDoc = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
        manifestDoc.updated_at = "2020-01-01T00:00:00.000Z";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifestDoc, null, 2)}\n`, "utf8");

        const urlMapPath = path.join(citationsDir, "url-map.json");
        await fs.writeFile(
          urlMapPath,
          JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [
                {
                  url_original: "https://example.org/article",
                  normalized_url: "https://example.org/article",
                  cid: "cid_m4_001",
                },
              ],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        (globalThis as any).fetch = async () => {
          fetchCalls += 1;
          throw new Error("network calls are disallowed in deterministic canary");
        };

        try {
          const firstCitationsPath = path.join(citationsDir, "citations.first.jsonl");
          const firstRaw = (await (citations_validate as any).execute(
            {
              manifest_path: manifestPath,
              citations_path: firstCitationsPath,
              online_fixtures_path: fixturePath("citations", "phase04", "validate", "online-ladder-fixtures.json"),
              reason: "smoke:M4 first-pass fixture capture (fixture-seeded)",
            },
            makeToolContext(),
          )) as string;
          const first = parseToolJson(firstRaw);
          expect(first.ok).toBe(true);
          if (!first.ok) return;

          expect(String((first as any).mode)).toBe("online");
          expect((first as any).online_dry_run).toBe(false);

          const latestPointerPath = String((first as any).online_fixtures_latest_path ?? "");
          expect(latestPointerPath).toContain(`${path.sep}citations${path.sep}online-fixtures.latest.json`);
          const latestPointer = JSON.parse(await fs.readFile(latestPointerPath, "utf8")) as Record<string, unknown>;
          expect(String(latestPointer.schema_version)).toBe("online_fixtures.latest.v1");
          const capturePath = String((first as any).online_fixtures_path ?? "");
          expect(capturePath).toContain(`${path.sep}citations${path.sep}online-fixtures.`);
          expect(String(latestPointer.path)).toBe(capturePath);

          const firstCitations = await fs.readFile(firstCitationsPath, "utf8");
          expect(firstCitations.trim().length).toBeGreaterThan(0);

          const replayCitationsPath = path.join(citationsDir, "citations.replay.jsonl");
          const replayRaw = (await (citations_validate as any).execute(
            {
              manifest_path: manifestPath,
              citations_path: replayCitationsPath,
              online_fixtures_path: capturePath,
              reason: "smoke:M4 replay from online fixtures",
            },
            makeToolContext(),
          )) as string;
          const replay = parseToolJson(replayRaw);
          expect(replay.ok).toBe(true);
          if (!replay.ok) return;

          expect(String((replay as any).mode)).toBe("online");
          const replayCitations = await fs.readFile(replayCitationsPath, "utf8");
          expect(replayCitations).toBe(firstCitations);
          expect(fetchCalls).toBe(0);
        } finally {
          (globalThis as any).fetch = originalFetch;
        }
      });
    });
  });
});
