import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import * as deepResearch from "../../tools/deep_research.ts";
import { resolveCitationsConfig } from "../../tools/deep_research/citations_validate_lib";
import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const citations_validate = ((deepResearch as any).citations_validate ??
  (deepResearch as any).deep_research_citations_validate) as any | undefined;

describe("deep_research_citations_validate (entity)", () => {
  const fixture = (...parts: string[]) => fixturePath("citations", "phase04", ...parts);

  test("resolver precedence uses manifest -> run-config -> unset (no env)", async () => {
    const manifestWithExplicit = {
      query: {
        sensitivity: "normal",
        constraints: {
          deep_research_flags: {
            PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT: "https://manifest.example/bright",
            PAI_DR_CITATIONS_APIFY_ENDPOINT: "https://manifest.example/apify",
          },
        },
      },
    } as Record<string, unknown>;

    const runConfig = {
      effective: {
        citations: {
          mode: "dry_run",
          endpoints: {
            brightdata: "https://run-config.example/bright",
            apify: "https://run-config.example/apify",
          },
        },
      },
    } as Record<string, unknown>;

    const resolvedManifestFirst = resolveCitationsConfig({
      manifest: manifestWithExplicit,
      runConfig,
    });
    expect(resolvedManifestFirst.brightDataEndpoint).toBe("https://manifest.example/bright");
    expect(resolvedManifestFirst.apifyEndpoint).toBe("https://manifest.example/apify");
    expect(resolvedManifestFirst.endpointSources.brightData).toBe("manifest.query.constraints.deep_research_flags");
    expect(resolvedManifestFirst.endpointSources.apify).toBe("manifest.query.constraints.deep_research_flags");
    expect(resolvedManifestFirst.mode).toBe("online");

    const manifestWithoutEndpoint = {
      query: {
        sensitivity: "restricted",
        constraints: {
          deep_research_flags: {},
        },
      },
    } as Record<string, unknown>;

    const resolvedRunConfigSecond = resolveCitationsConfig({
      manifest: manifestWithoutEndpoint,
      runConfig,
    });
    expect(resolvedRunConfigSecond.mode).toBe("dry_run");
    expect(resolvedRunConfigSecond.onlineDryRun).toBe(true);
    expect(resolvedRunConfigSecond.brightDataEndpoint).toBe("https://run-config.example/bright");
    expect(resolvedRunConfigSecond.apifyEndpoint).toBe("https://run-config.example/apify");
    expect(resolvedRunConfigSecond.endpointSources.brightData).toBe("run-config.effective.citations");
    expect(resolvedRunConfigSecond.endpointSources.apify).toBe("run-config.effective.citations");

    const resolvedEnvFallback = resolveCitationsConfig({
      manifest: manifestWithoutEndpoint,
      runConfig: null,
      onlineDryRunArg: false,
    });
    expect(resolvedEnvFallback.brightDataEndpoint).toBe("");
    expect(resolvedEnvFallback.apifyEndpoint).toBe("");
    expect(resolvedEnvFallback.endpointSources.brightData).toBe("unset");
    expect(resolvedEnvFallback.endpointSources.apify).toBe("unset");
    expect(resolvedEnvFallback.onlineDryRun).toBe(false);
    expect(resolvedEnvFallback.onlineDryRunSource).toBe("arg.online_dry_run");
  });

  const maybeTest = citations_validate ? test : test.skip;

  maybeTest("runs in OFFLINE fixture mode when sensitivity=no_web", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "no_web", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");

        const urlMap = JSON.parse(await fs.readFile(fixture("validate", "url-map.json"), "utf8"));
        urlMap.run_id = runId;
        await fs.writeFile(urlMapPath, JSON.stringify(urlMap, null, 2) + "\n", "utf8");

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            offline_fixtures_path: fixture("validate", "url-checks.json"),
            reason: "test: validate urls offline",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).mode).toBe("offline");
        expect((out as any).validated).toBe(3);

        const citationsPath = (out as any).citations_path as string;
        const rows = (await fs.readFile(citationsPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));

        expect(rows.length).toBe(3);
        expect(rows.some((row: any) => row.status === "paywalled")).toBe(true);

        const normalizedUrls = rows.map((row: any) => row.normalized_url);
        expect(normalizedUrls).toEqual([...normalizedUrls].sort((a, b) => a.localeCompare(b)));
      });
    });
  });

  maybeTest("requires offline_fixtures_path in OFFLINE mode", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_002";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "no_web", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: (init as any).manifest_path,
            reason: "test: missing fixtures",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(false);
        expect((out as any).error.code).toBe("INVALID_ARGS");
      });
    });
  });

  maybeTest("ONLINE mode blocks private/local URLs as invalid", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_003";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");

        await fs.writeFile(
          urlMapPath,
          JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [{
                url_original: "http://127.0.0.1/private",
                normalized_url: "http://127.0.0.1/private",
                cid: "cid_private_001",
              }],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            online_dry_run: true,
            reason: "test: online private/local blocked",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);

        expect(out.ok).toBe(true);
        expect((out as any).mode).toBe("online");

        const citationsPath = (out as any).citations_path as string;
        const rows = (await fs.readFile(citationsPath, "utf8"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));

        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe("invalid");
        expect(String(rows[0].notes)).toContain("private/local target blocked by SSRF policy");
      });
    });
  });

  maybeTest("ONLINE mode captures fixtures and replays deterministically without network", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_004";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");

        await fs.writeFile(
          urlMapPath,
          JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [{
                url_original: "https://example.org/article",
                normalized_url: "https://example.org/article",
                cid: "cid_public_001",
              }],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        (globalThis as any).fetch = async (..._args: unknown[]) => {
          fetchCalls += 1;
          throw new Error("network calls are disallowed in deterministic test");
        };

        try {
          const outRaw = (await (citations_validate as any).execute(
            {
              manifest_path: manifestPath,
              online_fixtures_path: fixture("validate", "online-ladder-fixtures.json"),
              reason: "test: online deterministic ladder fixture capture",
            },
            makeToolContext(),
          )) as string;
          const out = parseToolJson(outRaw);

          expect(out.ok).toBe(true);
          expect((out as any).mode).toBe("online");

          const citationsPath = (out as any).citations_path as string;
          const rows = (await fs.readFile(citationsPath, "utf8"))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));

          expect(rows.length).toBe(1);
          expect(rows[0].status).toBe("valid");
          expect(String(rows[0].notes)).toContain("online ladder: bright_data");
          expect(String(rows[0].notes)).not.toContain("online stub");

          const onlineFixturesCapturePath = String((out as any).online_fixtures_path ?? "");
          expect(onlineFixturesCapturePath).toContain(`${path.sep}citations${path.sep}online-fixtures.`);
          const onlineFixturesCapture = JSON.parse(await fs.readFile(onlineFixturesCapturePath, "utf8"));
          expect(onlineFixturesCapture.schema_version).toBe("online_fixtures.v1");
          expect(onlineFixturesCapture.effective_config.mode).toBe("online");
          expect(onlineFixturesCapture.effective_config.online_dry_run).toBe(false);
          expect(Array.isArray(onlineFixturesCapture.items)).toBe(true);
          expect(onlineFixturesCapture.items.length).toBe(1);
          expect(onlineFixturesCapture.items[0].status).toBe("valid");

          const latestPointerPath = String((out as any).online_fixtures_latest_path ?? "");
          expect(latestPointerPath).toContain(`${path.sep}citations${path.sep}online-fixtures.latest.json`);
          const latestPointer = JSON.parse(await fs.readFile(latestPointerPath, "utf8"));
          expect(latestPointer.schema_version).toBe("online_fixtures.latest.v1");
          expect(latestPointer.path).toBe(onlineFixturesCapturePath);

          const blockedUrlsPath = String((out as any).blocked_urls_path ?? "");
          expect(blockedUrlsPath).toContain(`${path.sep}citations${path.sep}blocked-urls.json`);
          const blockedUrlsDoc = JSON.parse(await fs.readFile(blockedUrlsPath, "utf8"));
          expect(blockedUrlsDoc.schema_version).toBe("blocked_urls.v1");
          expect(Array.isArray(blockedUrlsDoc.items)).toBe(true);
          expect(blockedUrlsDoc.items.length).toBe(0);

          const replayRaw = (await (citations_validate as any).execute(
            {
              manifest_path: manifestPath,
              online_fixtures_path: onlineFixturesCapturePath,
              reason: "test: online deterministic ladder fixture replay",
            },
            makeToolContext(),
          )) as string;
          const replay = parseToolJson(replayRaw);

          expect(replay.ok).toBe(true);
          expect((replay as any).mode).toBe("online");

          const replayRows = (await fs.readFile((replay as any).citations_path, "utf8"))
            .split(/\r?\n/)
            .map((line: string) => line.trim())
            .filter(Boolean)
            .map((line: string) => JSON.parse(line));
          expect(replayRows.length).toBe(1);
          expect(replayRows[0].status).toBe("valid");
          expect(fetchCalls).toBe(0);
        } finally {
          (globalThis as any).fetch = originalFetch;
        }
      });
    });
  });

  const canaryTest = ((globalThis as any).process?.env?.PAI_DR_ENABLE_ONLINE_CANARY === "1") ? maybeTest : test.skip;
  canaryTest("ONLINE canary is opt-in and skipped by default", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_p04_validate_canary_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = (init as any).manifest_path as string;
        const runRoot = path.dirname(manifestPath);
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");
        await fs.writeFile(
          urlMapPath,
          JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [{
                url_original: "https://example.com/",
                normalized_url: "https://example.com",
                cid: "cid_canary_001",
              }],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const outRaw = (await (citations_validate as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: online canary",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).mode).toBe("online");
      });
    });
  });
});
