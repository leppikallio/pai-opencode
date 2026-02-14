import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  citations_extract_urls,
  citations_normalize,
  citations_render_md,
  citations_validate,
  gate_c_compute,
  run_init,
} from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

function parseJsonl(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("deep_research citations phase04 (entity)", () => {
  test("offline pipeline: extract -> normalize -> validate -> gate C -> render", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_citations_001";
        const initRaw = (await (run_init as any).execute(
          {
            query: "Citations pipeline",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const root = (init as any).root as string;
        const manifestPath = (init as any).manifest_path as string;

        const wave1Path = path.join(root, "wave-1", "p1.md");
        const wave2Path = path.join(root, "wave-2", "p2.md");
        await fs.writeFile(
          wave1Path,
          [
            "# Perspective 1",
            "",
            "## Analysis",
            "Outside link https://ignore.example/outside should not be extracted.",
            "",
            "## Sources",
            "- https://Example.com/doc/?utm_source=news&id=2",
            "- https://example.com/doc?id=2",
            "- https://example.com/paywall",
            "",
          ].join("\n"),
          "utf8",
        );
        await fs.writeFile(
          wave2Path,
          [
            "# Perspective 2",
            "",
            "## Sources",
            "- https://example.net/report/#frag",
            "",
          ].join("\n"),
          "utf8",
        );

        const extractRaw = (await (citations_extract_urls as any).execute(
          {
            manifest_path: manifestPath,
            include_wave2: true,
            reason: "test: extract",
          },
          makeToolContext(),
        )) as string;
        const extract = parseToolJson(extractRaw);
        expect(extract.ok).toBe(true);
        expect((extract as any).total_found).toBe(4);
        expect((extract as any).unique_found).toBe(4);

        const extractedText = await fs.readFile((extract as any).extracted_urls_path, "utf8");
        const extractedLines = extractedText.trim().split(/\r?\n/);
        expect(extractedLines).toEqual([
          "https://example.com/doc?id=2",
          "https://example.com/doc/?utm_source=news&id=2",
          "https://example.com/paywall",
          "https://example.net/report/#frag",
        ]);

        const normalizeRaw = (await (citations_normalize as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: normalize",
          },
          makeToolContext(),
        )) as string;
        const normalize = parseToolJson(normalizeRaw);
        expect(normalize.ok).toBe(true);
        expect((normalize as any).unique_normalized).toBe(3);

        const normalizedText = await fs.readFile((normalize as any).normalized_urls_path, "utf8");
        expect(normalizedText.trim().split(/\r?\n/)).toEqual([
          "https://example.com/doc?id=2",
          "https://example.com/paywall",
          "https://example.net/report",
        ]);

        const fixturesPath = path.join(root, "citations", "offline-fixtures.json");
        await fs.writeFile(
          fixturesPath,
          JSON.stringify(
            {
              items: [
                {
                  normalized_url: "https://example.com/doc?id=2",
                  status: "valid",
                  title: "Example Doc",
                  publisher: "Example Publisher",
                  notes: "ok",
                },
                {
                  normalized_url: "https://example.com/paywall",
                  status: "paywalled",
                  notes: "paywall",
                },
                {
                  normalized_url: "https://example.net/report",
                  status: "valid",
                  notes: "ok",
                },
              ],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const validateRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            offline_fixtures_path: fixturesPath,
            reason: "test: validate",
          },
          makeToolContext(),
        )) as string;
        const validate = parseToolJson(validateRaw);
        expect(validate.ok).toBe(true);
        expect((validate as any).mode).toBe("offline");
        expect((validate as any).validated).toBe(3);

        const citationsRaw = await fs.readFile((validate as any).citations_path, "utf8");
        const citationRecords = parseJsonl(citationsRaw);
        expect(citationRecords.map((record) => record.normalized_url)).toEqual([
          "https://example.com/doc?id=2",
          "https://example.com/paywall",
          "https://example.net/report",
        ]);
        expect(citationRecords.map((record) => record.status)).toEqual(["valid", "paywalled", "valid"]);

        const gateRaw = (await (gate_c_compute as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate-c",
          },
          makeToolContext(),
        )) as string;
        const gate = parseToolJson(gateRaw);
        expect(gate.ok).toBe(true);
        expect((gate as any).gate_id).toBe("C");
        expect((gate as any).status).toBe("pass");
        expect((gate as any).metrics.validated_url_rate).toBe(1);
        expect((gate as any).metrics.invalid_url_rate).toBe(0);
        expect((gate as any).metrics.uncategorized_url_rate).toBe(0);

        const renderRaw = (await (citations_render_md as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: render",
          },
          makeToolContext(),
        )) as string;
        const render = parseToolJson(renderRaw);
        expect(render.ok).toBe(true);
        expect((render as any).rendered).toBe(3);

        const renderedMd = await fs.readFile((render as any).output_md_path, "utf8");
        expect(renderedMd).toContain("# Validated Citations");
        expect(renderedMd).toContain("## cid_");
      });
    });
  });

  test("online mode returns stub statuses with ladder placeholder", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_citations_002";
        const initRaw = (await (run_init as any).execute(
          {
            query: "Citations online stub",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        const manifestPath = (init as any).manifest_path as string;
        const root = (init as any).root as string;

        await fs.writeFile(path.join(root, "wave-1", "p1.md"), "## Sources\n- https://example.org/a\n", "utf8");

        const extractRaw = (await (citations_extract_urls as any).execute(
          { manifest_path: manifestPath, reason: "test: extract-online" },
          makeToolContext(),
        )) as string;
        const extract = parseToolJson(extractRaw);

        const normalizeRaw = (await (citations_normalize as any).execute(
          { manifest_path: manifestPath, extracted_urls_path: (extract as any).extracted_urls_path, reason: "test: normalize-online" },
          makeToolContext(),
        )) as string;
        const normalize = parseToolJson(normalizeRaw);

        const validateRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            url_map_path: (normalize as any).url_map_path,
            reason: "test: validate-online",
          },
          makeToolContext(),
        )) as string;
        const validate = parseToolJson(validateRaw);
        expect(validate.ok).toBe(true);
        expect((validate as any).mode).toBe("online");

        const citationsRaw = await fs.readFile((validate as any).citations_path, "utf8");
        const records = parseJsonl(citationsRaw);
        expect(records.length).toBe(1);
        expect(["blocked", "invalid"]).toContain(String(records[0].status));
        expect(String(records[0].notes)).toContain("ladder placeholder");
      });
    });
  });
});
