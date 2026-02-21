import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_validate = ((deepResearch as any).citations_validate
  ?? (deepResearch as any).deep_research_citations_validate) as any | undefined;

describe("deep_research_citations_validate blocked queue (entity)", () => {
  const maybeTest = citations_validate ? test : test.skip;

  maybeTest("writes blocked-urls.queue.md in deterministic order with found_by context", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_queue_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");
        const foundByPath = path.join(runRoot, "citations", "found-by.json");

        await fs.writeFile(
          urlMapPath,
          `${JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [
                {
                  url_original: "https://b.example/path",
                  normalized_url: "https://b.example/path",
                  cid: "cid_blocked_b",
                },
                {
                  url_original: "https://a.example/path",
                  normalized_url: "https://a.example/path",
                  cid: "cid_blocked_a",
                },
              ],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        await fs.writeFile(
          foundByPath,
          `${JSON.stringify(
            {
              schema_version: "found_by.v1",
              run_id: runId,
              items: [
                {
                  url_original: "https://a.example/path",
                  wave: "wave-2",
                  perspective_id: "alpha",
                  source_line: "- https://a.example/path",
                  ordinal: 1,
                },
                {
                  url_original: "https://b.example/path",
                  wave: "wave-1",
                  perspective_id: "beta",
                  source_line: "- https://b.example/path",
                  ordinal: 1,
                },
              ],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            online_dry_run: true,
            reason: "test: blocked queue markdown",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).mode).toBe("online");
        expect((out as any).blocked_urls_count).toBe(2);

        const blockedUrlsPath = String((out as any).blocked_urls_path ?? "");
        const blockedDoc = JSON.parse(await fs.readFile(blockedUrlsPath, "utf8"));
        expect(Array.isArray(blockedDoc.items)).toBe(true);
        expect(blockedDoc.items.length).toBe(2);
        expect(blockedDoc.items[0].normalized_url).toBe("https://a.example/path");
        expect(blockedDoc.items[1].normalized_url).toBe("https://b.example/path");

        const queuePath = String((out as any).blocked_urls_queue_path ?? "");
        expect(queuePath).toContain(`${path.sep}citations${path.sep}blocked-urls.queue.md`);

        const queueMarkdown = await fs.readFile(queuePath, "utf8");
        expect(queueMarkdown).toContain("# Blocked URLs Queue");
        expect(queueMarkdown).toContain(`generated_at: ${blockedDoc.generated_at}`);
        expect(queueMarkdown).toContain("blocked_count: 2");
        expect(queueMarkdown).toContain("## 1. https://a.example/path");
        expect(queueMarkdown).toContain("## 2. https://b.example/path");
        expect(queueMarkdown).toContain("- reason: online ladder blocked: direct_fetch=skipped(dry-run); bright_data=skipped(dry-run); apify=skipped(dry-run)");
        expect(queueMarkdown).toContain("- recommended_action: Run with online_dry_run=false or provide online fixtures replay input.");
        expect(queueMarkdown).toContain("  - file: wave-2/alpha.md");
        expect(queueMarkdown).toContain("    line: - https://a.example/path");
        expect(queueMarkdown).toContain("    perspective: alpha");
      });
    });
  });
});
