import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_post_pivot,
  run_init,
} from "../../tools/deep_research.ts";
import {
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

describe("deep_research_orchestrator_tick_post_pivot online fixtures latest replay (entity)", () => {
  test("citations stage reuses online-fixtures.latest.json target when present", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "0" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orch_post_pivot_online_latest_001";
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

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.stage = {
          ...(manifest.stage ?? {}),
          current: "citations",
        };
        manifest.status = "running";
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const citationsDir = path.join(runRoot, "citations");
        await fs.mkdir(citationsDir, { recursive: true });

        const fixturePath = path.join(citationsDir, "online-fixtures.synthetic.json");
        await fs.writeFile(
          fixturePath,
          `${JSON.stringify({
            schema_version: "online_fixtures.v1",
            run_id: runId,
            generated_at: "2026-02-20T00:00:00.000Z",
            items: [],
          }, null, 2)}\n`,
          "utf8",
        );

        const latestPointerPath = path.join(citationsDir, "online-fixtures.latest.json");
        await fs.writeFile(
          latestPointerPath,
          `${JSON.stringify({
            schema_version: "online_fixtures.latest.v1",
            run_id: runId,
            updated_at: "2026-02-20T00:00:00.000Z",
            ts: "20260220T000000000Z",
            path: fixturePath,
          }, null, 2)}\n`,
          "utf8",
        );

        let validatePayload: Record<string, unknown> | null = null;

        const out = await orchestrator_tick_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: replay latest online fixtures",
          citations_extract_urls_tool: {
            execute: async () => JSON.stringify({
              ok: true,
              extracted_urls_path: path.join(citationsDir, "extracted-urls.txt"),
            }),
          } as any,
          citations_normalize_tool: {
            execute: async () => JSON.stringify({
              ok: true,
              url_map_path: path.join(citationsDir, "url-map.json"),
            }),
          } as any,
          citations_validate_tool: {
            execute: async (payload: Record<string, unknown>) => {
              validatePayload = payload;
              return JSON.stringify({
                ok: true,
                citations_path: path.join(citationsDir, "citations.jsonl"),
              });
            },
          } as any,
          gate_c_compute_tool: {
            execute: async () => JSON.stringify({
              ok: true,
              status: "pass",
              update: {
                gates: {
                  C: {
                    status: "pass",
                    hard: true,
                    metrics: {
                      validated_url_rate: 1,
                      invalid_url_rate: 0,
                      uncategorized_url_rate: 0,
                    },
                  },
                },
              },
              inputs_digest: "sha256:test-gate-c",
            }),
          } as any,
          gates_write_tool: {
            execute: async () => JSON.stringify({ ok: true }),
          } as any,
          stage_advance_tool: {
            execute: async () => JSON.stringify({
              ok: true,
              from: "citations",
              to: "summaries",
              manifest_revision: 999,
              decision: {
                inputs_digest: "sha256:test-stage-advance",
              },
            }),
          } as any,
          tool_context: makeToolContext(),
        });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.from).toBe("citations");
        expect(out.to).toBe("summaries");

        expect(validatePayload).not.toBeNull();
        if (!validatePayload) {
          throw new Error("expected citations_validate payload capture");
        }
        expect((validatePayload as any).manifest_path).toBe(manifestPath);
        expect((validatePayload as any).online_fixtures_path).toBe(fixturePath);
      });
    });
  });
});
