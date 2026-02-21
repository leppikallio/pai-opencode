import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withTempDir } from "../helpers/dr-harness";

function opencodeRootFromCwd(): string {
  return path.basename(process.cwd()) === ".opencode"
    ? process.cwd()
    : path.resolve(process.cwd(), ".opencode");
}

const SETTINGS_PATH = path.join(opencodeRootFromCwd(), "settings.json");

async function withSettingsFlags<T>(flags: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const originalRaw = await fs.readFile(SETTINGS_PATH, "utf8");
  const original = JSON.parse(originalRaw) as Record<string, unknown>;
  const next = { ...original } as Record<string, unknown>;

  const deepResearchCli = typeof next.deepResearchCli === "object" && next.deepResearchCli && !Array.isArray(next.deepResearchCli)
    ? { ...(next.deepResearchCli as Record<string, unknown>) }
    : {};

  deepResearchCli.flags = {
    PAI_DR_CLI_ENABLED: true,
    ...flags,
  };
  next.deepResearchCli = deepResearchCli;

  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    return await fn();
  } finally {
    await fs.writeFile(SETTINGS_PATH, originalRaw, "utf8");
  }
}

describe("deep_research_run_init (entity)", () => {
  test("enabled by default (no env required)", async () => {
    await withTempDir(async (base) => {
      const outRaw = (await (run_init as any).execute(
        {
          query: "Q",
          mode: "standard",
          sensitivity: "normal",
          run_id: "dr_test_enabled_default_001",
          root_override: base,
        },
        makeToolContext(),
      )) as string;

      const out = parseToolJson(outRaw);
      expect(out.ok).toBe(true);
    });
  });

  test("creates deterministic skeleton + manifest + gates + ledger", async () => {
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

  test("uses PAI_DR_CLI_RUNS_ROOT from settings when root_override is omitted", async () => {
    await withTempDir(async (runsRoot) => {
      await withSettingsFlags({ PAI_DR_CLI_RUNS_ROOT: runsRoot }, async () => {
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
        expect(manifest.query.constraints.deep_research_cli_flags.PAI_DR_CLI_RUNS_ROOT).toBe(runsRoot);
      });
    });
  });

  test("rejects path traversal run_id values", async () => {
    await withTempDir(async (base) => {
      const outRaw = (await (run_init as any).execute(
        {
          query: "Research Z",
          mode: "standard",
          sensitivity: "normal",
          run_id: "../escape",
          root_override: base,
        },
        makeToolContext(),
      )) as string;

      const out = parseToolJson(outRaw);
      expect(out.ok).toBe(false);
      expect((out as any).error.code).toBe("PATH_TRAVERSAL");
    });
  });
});
