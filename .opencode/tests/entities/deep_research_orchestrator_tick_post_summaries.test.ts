import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_post_summaries,
  run_init,
} from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

async function seedGenerateInputs(base: string, runId: string) {
  const initRaw = (await run_init.execute(
    { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = String(init.manifest_path);
  const gatesPath = String(init.gates_path);
  const runRoot = path.dirname(manifestPath);
  const sourceDir = path.join(runRoot, "agent-output");
  await fs.mkdir(sourceDir, { recursive: true });

  await fs.writeFile(
    path.join(runRoot, "perspectives.json"),
    `${JSON.stringify({
      schema_version: "perspectives.v1",
      run_id: runId,
      created_at: "2026-02-18T00:00:00Z",
      perspectives: [
        {
          id: "p1",
          title: "Perspective One",
          track: "standard",
          agent_type: "ClaudeResearcher",
          source_artifact: "agent-output/p1.md",
          prompt_contract: {
            max_words: 300,
            max_sources: 10,
            tool_budget: { search_calls: 1 },
            must_include_sections: ["Findings", "Sources", "Gaps"],
          },
        },
        {
          id: "p2",
          title: "Perspective Two",
          track: "independent",
          agent_type: "GeminiResearcher",
          source_artifact: "agent-output/p2.md",
          prompt_contract: {
            max_words: 300,
            max_sources: 10,
            tool_budget: { search_calls: 1 },
            must_include_sections: ["Findings", "Sources", "Gaps"],
          },
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(path.join(sourceDir, "p1.md"), "## Findings\nSignal A [@cid_a]\n", "utf8");
  await fs.writeFile(path.join(sourceDir, "p2.md"), "## Findings\nSignal B [@cid_b]\n", "utf8");
  await fs.writeFile(
    path.join(runRoot, "citations", "citations.jsonl"),
    `${[
      JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" }),
      JSON.stringify({ cid: "cid_b", status: "paywalled", normalized_url: "https://b.test" }),
    ].join("\n")}\n`,
    "utf8",
  );

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.stage = {
    ...(manifest.stage ?? {}),
    current: "summaries",
    started_at: "2026-02-18T00:00:00Z",
    history: [],
  };
  manifest.status = "running";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifestPath, gatesPath, runRoot };
}

describe("deep_research_orchestrator_tick_post_summaries (entity)", () => {
  test("generate mode advances summaries -> finalize without fixture directories", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const { manifestPath, gatesPath, runRoot } = await seedGenerateInputs(base, "dr_test_orch_post_sum_generate_001");

        const tick1 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: summaries generate",
          tool_context: makeToolContext(),
        });
        expect(tick1.ok).toBe(true);
        if (!tick1.ok) return;
        expect(tick1.from).toBe("summaries");
        expect(tick1.to).toBe("synthesis");
        expect(tick1.gate_d_status).toBe("pass");

        const tick2 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: synthesis generate",
          tool_context: makeToolContext(),
        });
        expect(tick2.ok).toBe(true);
        if (!tick2.ok) return;
        expect(tick2.from).toBe("synthesis");
        expect(tick2.to).toBe("review");

        const tick3 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: review generate",
          tool_context: makeToolContext(),
        });
        expect(tick3.ok).toBe(true);
        if (!tick3.ok) return;
        expect(tick3.from).toBe("review");
        expect(tick3.to).toBe("finalize");
        expect(tick3.gate_e_status).toBe("pass");

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.D.status).toBe("pass");
        expect(gates.gates.E.status).toBe("pass");

        await fs.access(path.join(runRoot, "reports", "gate-e-status.json"));
        await fs.access(path.join(runRoot, "reports", "gate-e-numeric-claims.json"));

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("finalize");
        expect(manifest.status).toBe("completed");
      });
    });
  });

  test("review loop is bounded by max_review_iterations", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orch_post_sum_generate_002";
        const { manifestPath, gatesPath } = await seedGenerateInputs(base, runId);

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        manifest.limits = {
          ...(manifest.limits ?? {}),
          max_review_iterations: 1,
        };
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        const changesRequiredReviewTool = {
          execute: async (payload: Record<string, unknown>) => {
            const manifestForPayload = JSON.parse(await fs.readFile(String(payload.manifest_path), "utf8"));
            const runRoot = path.dirname(String(payload.manifest_path));
            const reviewDir = path.join(runRoot, "review");
            const reviewBundlePath = path.join(reviewDir, "review-bundle.json");
            await fs.mkdir(reviewDir, { recursive: true });
            await fs.writeFile(
              reviewBundlePath,
              `${JSON.stringify({
                schema_version: "review_bundle.v1",
                run_id: String(manifestForPayload.run_id ?? ""),
                decision: "CHANGES_REQUIRED",
                findings: [{ id: "f1", text: "needs changes" }],
                directives: [{ id: "d1", text: "revise synthesis" }],
              }, null, 2)}\n`,
              "utf8",
            );
            await fs.writeFile(
              path.join(reviewDir, "revision-directives.json"),
              `${JSON.stringify({
                schema_version: "revision_directives.v1",
                run_id: String(manifestForPayload.run_id ?? ""),
                directives: [{ id: "d1", text: "revise synthesis" }],
              }, null, 2)}\n`,
              "utf8",
            );

            return JSON.stringify({
              ok: true,
              review_bundle_path: reviewBundlePath,
              decision: "CHANGES_REQUIRED",
              inputs_digest: "sha256:test-review",
            });
          },
        };

        const tick1 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: summaries",
          tool_context: makeToolContext(),
        });
        expect(tick1.ok).toBe(true);

        const tick2 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: synthesis",
          tool_context: makeToolContext(),
        });
        expect(tick2.ok).toBe(true);

        const tick3 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: review first",
          review_factory_run_tool: changesRequiredReviewTool as any,
          tool_context: makeToolContext(),
        });
        expect(tick3.ok).toBe(true);
        if (!tick3.ok) return;
        expect(tick3.to).toBe("synthesis");

        const tick4 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: synthesis second",
          tool_context: makeToolContext(),
        });
        expect(tick4.ok).toBe(true);
        if (!tick4.ok) return;
        expect(tick4.to).toBe("review");

        const tick5 = await orchestrator_tick_post_summaries({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: review second",
          review_factory_run_tool: changesRequiredReviewTool as any,
          tool_context: makeToolContext(),
        });
        expect(tick5.ok).toBe(false);
        if (tick5.ok) return;
        expect(tick5.error.code).toBe("REVIEW_CAP_EXCEEDED");
      });
    });
  });
});
