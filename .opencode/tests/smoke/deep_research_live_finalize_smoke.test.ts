import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_live,
  orchestrator_tick_post_pivot,
  orchestrator_tick_post_summaries,
  run_init,
  stage_advance,
} from "../../tools/deep_research_cli.ts";

import { fixturePath, makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

type JsonObject = Record<string, unknown>;

async function assertFileExists(runRoot: string, relPath: string): Promise<void> {
  const fullPath = path.join(runRoot, relPath);
  const st = await fs.stat(fullPath);
  if (!st.isFile()) throw new Error(`artifact is not a file: ${relPath}`);
}

function gateStatusFromReport(doc: JsonObject): "pass" | "fail" | undefined {
  if (typeof doc.status === "string") {
    return doc.status === "pass" || doc.status === "fail" ? doc.status : undefined;
  }
  if (typeof doc.pass === "boolean") {
    return doc.pass ? "pass" : "fail";
  }
  return undefined;
}

function gateStatusFromGatesDoc(doc: JsonObject, gateId: string): string | undefined {
  const gates = doc.gates;
  if (gates && typeof gates === "object" && !Array.isArray(gates)) {
    const gate = (gates as JsonObject)[gateId];
    if (gate && typeof gate === "object" && !Array.isArray(gate)) {
      const status = (gate as JsonObject).status;
      return typeof status === "string" ? status : undefined;
    }
  }
  return undefined;
}

describe("deep_research canary (M3 finalize)", () => {
  test("self-seeding canary reaches finalize with Gate E pass", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const baseReal = await fs.realpath(base).catch(() => base);
        const runId = `dr_smoke_m3_${Date.now()}`;

        const initRaw = (await (run_init as any).execute(
          {
            query: "smoke:M3",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: baseReal,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);
        const runRoot = path.dirname(manifestPath);

        const perspectivesFixture = JSON.parse(
          await fs.readFile(fixturePath("wave-output", "perspectives.json"), "utf8"),
        ) as Record<string, unknown>;
        perspectivesFixture.run_id = runId;
        await fs.writeFile(path.join(runRoot, "perspectives.json"), `${JSON.stringify(perspectivesFixture, null, 2)}\n`, "utf8");

        const stageAdvanceRaw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            requested_next: "wave1",
            reason: "smoke:M3 init->wave1",
          },
          makeToolContext(),
        )) as string;
        expect(parseToolJson(stageAdvanceRaw).ok).toBe(true);

        const validMarkdown = await fs.readFile(fixturePath("wave-output", "valid.md"), "utf8");
        const drivers = {
          runAgent: async () => ({ markdown: validMarkdown }),
        };

        const maxTicks = 60;
        let reachedFinalize = false;
        for (let i = 1; i <= maxTicks; i += 1) {
          const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
            stage?: { current?: string };
            status?: string;
          };
          const stage = String(manifest.stage?.current ?? "");

          if (stage === "finalize" || manifest.status === "completed") {
            reachedFinalize = true;
            break;
          }

          if (stage === "wave1" || stage === "wave2" || stage === "init") {
            const tick = await orchestrator_tick_live({
              manifest_path: manifestPath,
              gates_path: gatesPath,
              reason: `smoke:M3:tick-${i}`,
              drivers,
              tool_context: makeToolContext(),
            });
            expect(tick.ok).toBe(true);
            if (!tick.ok) break;
            continue;
          }

          if (stage === "pivot" || stage === "citations") {
            const tick = await orchestrator_tick_post_pivot({
              manifest_path: manifestPath,
              gates_path: gatesPath,
              reason: `smoke:M3:tick-${i}`,
              tool_context: makeToolContext(),
            });
            expect(tick.ok).toBe(true);
            if (!tick.ok) break;
            continue;
          }

          const tick = await orchestrator_tick_post_summaries({
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: `smoke:M3:tick-${i}`,
            tool_context: makeToolContext(),
          });
          expect(tick.ok).toBe(true);
          if (!tick.ok) break;
        }

        if (!reachedFinalize) {
          const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { stage?: { current?: string }, status?: string };
          throw new Error(
            `M3 canary failed to reach finalize within ${maxTicks} ticks (stage=${String(manifest.stage?.current)}, status=${String(manifest.status)})`,
          );
        }

        await assertFileExists(runRoot, "manifest.json");
        await assertFileExists(runRoot, "gates.json");
        await assertFileExists(runRoot, "summaries/summary-pack.json");
        await assertFileExists(runRoot, "synthesis/final-synthesis.md");
        await assertFileExists(runRoot, "reports/gate-e-status.json");
        await assertFileExists(runRoot, "logs/audit.jsonl");
        await assertFileExists(runRoot, "review/review-bundle.json");

        const manifest = JSON.parse(await fs.readFile(path.join(runRoot, "manifest.json"), "utf8")) as { stage?: { current?: string } };
        expect(String(manifest.stage?.current)).toBe("finalize");

        const gateEStatusDoc = JSON.parse(await fs.readFile(path.join(runRoot, "reports", "gate-e-status.json"), "utf8")) as JsonObject;
        expect(gateStatusFromReport(gateEStatusDoc)).toBe("pass");

        const gatesDoc = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8")) as JsonObject;
        expect(gateStatusFromGatesDoc(gatesDoc, "E")).toBe("pass");
      });
    });
  });
});
