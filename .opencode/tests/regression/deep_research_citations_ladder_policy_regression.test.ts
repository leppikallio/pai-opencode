import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { citations_validate, run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research citations ladder policy (regression)", () => {
  test("citations_validate applies run policy ladder retries/timeouts", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_citations_policy_regression_001";
        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path ?? "");
        const runRoot = path.dirname(manifestPath);
        const policyPath = path.join(runRoot, "run-config", "policy.json");
        const urlMapPath = path.join(runRoot, "citations", "url-map.json");
        const targetUrl = "https://example.org/policy-retry";

        const policyDoc = JSON.parse(await fs.readFile(policyPath, "utf8"));
        policyDoc.citations_ladder_policy_v1 = {
          direct_fetch_timeout_ms: 3000,
          endpoint_timeout_ms: 3000,
          max_redirects: 5,
          max_body_bytes: 2 * 1024 * 1024,
          direct_fetch_max_attempts: 2,
          bright_data_max_attempts: 1,
          apify_max_attempts: 1,
          backoff_initial_ms: 1,
          backoff_multiplier: 1,
          backoff_max_ms: 1,
        };
        await fs.writeFile(policyPath, `${JSON.stringify(policyDoc, null, 2)}\n`, "utf8");

        await fs.writeFile(
          urlMapPath,
          `${JSON.stringify(
            {
              schema_version: "url_map.v1",
              run_id: runId,
              items: [
                {
                  url_original: targetUrl,
                  normalized_url: targetUrl,
                  cid: "cid_policy_retry_001",
                },
              ],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        const originalFetch = globalThis.fetch;
        let directFetchCalls = 0;

        (globalThis as any).fetch = async (input: string | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === targetUrl) {
            directFetchCalls += 1;
            if (directFetchCalls === 1) {
              throw new Error("simulated transient direct fetch failure");
            }
            return new Response(
              "<html><title>Policy Retry</title><body>success after retry</body></html>",
              {
                status: 200,
                headers: { "content-type": "text/html" },
              },
            );
          }

          throw new Error(`unexpected fetch url: ${url}; method=${String(init?.method ?? "GET")}`);
        };

        try {
          const outRaw = (await (citations_validate as any).execute(
            {
              manifest_path: manifestPath,
              online_dry_run: false,
              reason: "test: citations ladder policy",
            },
            makeToolContext(),
          )) as string;

          const out = parseToolJson(outRaw);
          expect(out.ok).toBe(true);
          expect((out as any).mode).toBe("online");

          const citationsPath = String((out as any).citations_path ?? "");
          const rows = (await fs.readFile(citationsPath, "utf8"))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));

          expect(rows.length).toBe(1);
          expect(rows[0].status).toBe("valid");
          expect(directFetchCalls).toBe(2);
        } finally {
          (globalThis as any).fetch = originalFetch;
        }
      });
    });
  });
});
