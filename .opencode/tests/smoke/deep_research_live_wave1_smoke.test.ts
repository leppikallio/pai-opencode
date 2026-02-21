import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  orchestrator_tick_live,
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

async function assertWave1MarkdownExists(runRoot: string): Promise<void> {
  const wave1Entries = await fs.readdir(path.join(runRoot, "wave-1"));
  const perspectiveMarkdown = wave1Entries.filter((name: string) => name.endsWith(".md"));
  if (perspectiveMarkdown.length === 0) {
    throw new Error("no perspective markdown files found in wave-1");
  }
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

describe("deep_research canary (M2 wave1 -> pivot)", () => {
  test("self-seeding canary reaches pivot with Gate B pass", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const baseReal = await fs.realpath(base).catch(() => base);
        const runId = `dr_smoke_m2_${Date.now()}`;

        const initRaw = (await (run_init as any).execute(
          {
            query: "smoke:M2",
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

        // Seed perspectives deterministically.
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
            reason: "smoke:M2 init->wave1",
          },
          makeToolContext(),
        )) as string;
        expect(parseToolJson(stageAdvanceRaw).ok).toBe(true);

        const validMarkdown = await fs.readFile(fixturePath("wave-output", "valid.md"), "utf8");
        const drivers = {
          runAgent: async () => ({ markdown: validMarkdown }),
        };

        const maxTicks = 5;
        let reachedPivot = false;
        for (let i = 1; i <= maxTicks; i += 1) {
          const tick = await orchestrator_tick_live({
            manifest_path: manifestPath,
            gates_path: gatesPath,
            reason: `smoke:M2:tick-${i}`,
            drivers,
            tool_context: makeToolContext(),
          });
          expect(tick.ok).toBe(true);
          if (!tick.ok) break;
          if (tick.to === "pivot") {
            reachedPivot = true;
            break;
          }
        }

        if (!reachedPivot) {
          const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { stage?: { current?: string } };
          throw new Error(`M2 canary failed to reach pivot within ${maxTicks} ticks (stage=${String(manifest.stage?.current)})`);
        }

        await assertFileExists(runRoot, "manifest.json");
        await assertFileExists(runRoot, "gates.json");
        await assertFileExists(runRoot, "wave-1/wave1-plan.json");
        await assertFileExists(runRoot, "wave-review.json");
        await assertFileExists(runRoot, "logs/audit.jsonl");
        await assertWave1MarkdownExists(runRoot);

        const gatesDoc = JSON.parse(await fs.readFile(path.join(runRoot, "gates.json"), "utf8")) as JsonObject;
        expect(gateStatusFromGatesDoc(gatesDoc, "B")).toBe("pass");
      });
    });
  });
});
