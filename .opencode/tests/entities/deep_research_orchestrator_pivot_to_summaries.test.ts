import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type OrchestratorLiveRunAgentInput,
  orchestrator_run_live,
  orchestrator_run_post_pivot,
  run_init,
} from "../../tools/deep_research.ts";
import {
  fixturePath,
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function validMarkdownNoGaps(label: string): string {
  return [
    "## Findings",
    `Primary finding for ${label}.`,
    "",
    "## Sources",
    "- https://example.com/source-1",
    "",
    "## Gaps",
    "No critical gaps identified.",
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

describe("deep_research orchestrator pivot -> summaries (entity)", () => {
  test("deterministically drives pivot -> citations -> summaries with Gate C enforced", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_orchestrator_pivot_to_summaries_001";

        const initRaw = (await (run_init as any).execute(
          {
            query: "Q",
            mode: "standard",
            sensitivity: "no_web",
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

        await writePerspectivesForRun(runRoot, runId);

        const toPivot = await orchestrator_run_live({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator run live to pivot",
          max_ticks: 3,
          drivers: {
            runAgent: async (input: OrchestratorLiveRunAgentInput) => ({
              markdown: validMarkdownNoGaps(input.perspective_id),
            }),
          },
          tool_context: makeToolContext(),
        });

        expect(toPivot.ok).toBe(true);
        if (!toPivot.ok) return;
        expect(toPivot.end_stage).toBe("pivot");

        const auditPath = path.join(runRoot, "logs", "audit.jsonl");
        const auditBeforeRaw = await fs.readFile(auditPath, "utf8");
        const auditBeforeCount = auditBeforeRaw
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0).length;

        const postPivot = await orchestrator_run_post_pivot({
          manifest_path: manifestPath,
          gates_path: gatesPath,
          reason: "test: orchestrator post-pivot run",
          max_ticks: 3,
          tool_context: makeToolContext(),
        });

        expect(postPivot.ok).toBe(true);
        if (!postPivot.ok) return;

        expect(postPivot.start_stage).toBe("pivot");
        expect(postPivot.end_stage).toBe("summaries");

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.stage.current).toBe("summaries");

        const citationsPath = path.join(runRoot, "citations", "citations.jsonl");
        const citationsStat = await fs.stat(citationsPath);
        expect(citationsStat.isFile()).toBe(true);

        const citationsLines = (await fs.readFile(citationsPath, "utf8"))
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0);
        expect(citationsLines.length).toBeGreaterThan(0);

        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.gates.C.status).toBe("pass");
        expect(typeof gates.gates.C.checked_at).toBe("string");
        expect(gates.gates.C.checked_at.length).toBeGreaterThan(0);

        const auditAfterRaw = await fs.readFile(auditPath, "utf8");
        const auditAfterLines = auditAfterRaw
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0);
        expect(auditAfterLines.length).toBeGreaterThan(auditBeforeCount);
      });
    });
  });
});
