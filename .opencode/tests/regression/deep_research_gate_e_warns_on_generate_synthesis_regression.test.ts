import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  gate_e_evaluate,
  run_init,
} from "../../tools/deep_research_cli.ts";
import {
  makeToolContext,
  parseToolJson,
  withEnv,
  withTempDir,
} from "../helpers/dr-harness";

function warningCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "")).sort((a, b) => a.localeCompare(b));
}

describe("deep_research Gate E scaffold warning (regression)", () => {
  test("warns when synthesis metadata mode is generate", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_gate_e_warn_generate_${Date.now()}`;
        const initRaw = (await (run_init as any).execute(
          {
            query: "regression: gate-e scaffold warning",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);

        await fs.writeFile(
          path.join(runRoot, "citations", "citations.jsonl"),
          `${JSON.stringify({ cid: "cid_a", status: "valid", normalized_url: "https://a.test" })}\n`,
          "utf8",
        );

        await fs.writeFile(
          path.join(runRoot, "synthesis", "final-synthesis.md"),
          [
            "## Summary",
            "Generated synthesis body [@cid_a]",
            "",
            "## Key Findings",
            "- Finding [@cid_a]",
            "",
            "## Evidence",
            "- Evidence [@cid_a]",
            "",
            "## Caveats",
            "- Caveat [@cid_a]",
            "",
          ].join("\n"),
          "utf8",
        );

        await fs.writeFile(
          path.join(runRoot, "synthesis", "final-synthesis.meta.json"),
          `${JSON.stringify({
            schema_version: "synthesis_meta.v1",
            mode: "generate",
            generated_at: "2026-02-21T00:00:00.000Z",
            inputs_digest: "sha256:test",
          }, null, 2)}\n`,
          "utf8",
        );

        const raw = (await (gate_e_evaluate as any).execute(
          {
            manifest_path: manifestPath,
            reason: "test: gate-e scaffold warning",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(raw) as Record<string, unknown>;

        expect(out.ok).toBe(true);
        expect(warningCodes(out.warnings)).toContain("SCAFFOLD_SYNTHESIS");
      });
    });
  });
});
