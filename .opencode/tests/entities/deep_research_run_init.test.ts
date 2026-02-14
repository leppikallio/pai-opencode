import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research_run_init (entity)", () => {
  test("DISABLED by default unless PAI_DR_OPTION_C_ENABLED=1", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: undefined }, async () => {
      const outRaw = (await (run_init as any).execute(
        {
          query: "Q",
          mode: "standard",
          sensitivity: "normal",
          run_id: "dr_test_disabled",
          root_override: "/tmp",
        },
        makeToolContext(),
      )) as string;

      const out = parseToolJson(outRaw);
      expect(out.ok).toBe(false);
      expect((out as any).error.code).toBe("DISABLED");
    });
  });

  test("creates deterministic skeleton + manifest + gates + ledger", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_init_001";
        const outRaw = (await (run_init as any).execute(
          {
            query: "Research X",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);

        const root = (out as any).root as string;
        const manifestPath = (out as any).manifest_path as string;
        const gatesPath = (out as any).gates_path as string;
        const ledger = (out as any).ledger as { path: string; written: boolean };

        expect(root).toBe(path.join(base, runId));
        expect(manifestPath).toBe(path.join(root, "manifest.json"));
        expect(gatesPath).toBe(path.join(root, "gates.json"));

        // Skeleton dirs
        for (const d of ["wave-1", "wave-2", "citations", "summaries", "synthesis", "logs"]) {
          const st = await fs.stat(path.join(root, d));
          expect(st.isDirectory()).toBe(true);
        }

        // manifest
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.schema_version).toBe("manifest.v1");
        expect(manifest.run_id).toBe(runId);
        expect(manifest.revision).toBe(1);
        expect(manifest.stage.current).toBe("init");
        expect(manifest.artifacts.root).toBe(root);

        // gates
        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8"));
        expect(gates.schema_version).toBe("gates.v1");
        expect(gates.run_id).toBe(runId);
        expect(Object.keys(gates.gates).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);

        // ledger append best-effort (should succeed under temp base)
        expect(ledger.written).toBe(true);
        const ledgerTxt = await fs.readFile(ledger.path, "utf8");
        expect(ledgerTxt).toContain(runId);
      });
    });
  });

  test("uses PAI_DR_RUNS_ROOT when root_override is omitted", async () => {
    await withTempDir(async (runsRoot) => {
      await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_RUNS_ROOT: runsRoot }, async () => {
        const runId = "dr_test_runs_root_001";
        const outRaw = (await (run_init as any).execute(
          {
            query: "Research Y",
            mode: "standard",
            sensitivity: "normal",
            run_id: runId,
          },
          makeToolContext(),
        )) as string;

        const out = parseToolJson(outRaw);
        expect(out.ok).toBe(true);
        expect((out as any).root).toBe(path.join(runsRoot, runId));

        const manifestPath = (out as any).manifest_path as string;
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        expect(manifest.query.constraints.deep_research_flags.PAI_DR_RUNS_ROOT).toBe(runsRoot);
      });
    });
  });
});
