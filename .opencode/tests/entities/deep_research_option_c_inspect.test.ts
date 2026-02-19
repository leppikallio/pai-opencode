import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { run_init } from "../../tools/deep_research.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

const cliPath = fileURLToPath(new URL("../../pai-tools/deep-research-option-c.ts", import.meta.url));

describe("deep-research-option-c inspect (entity)", () => {
  test("capture-fixtures command is registered", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", cliPath, "capture-fixtures", "--help"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("deep-research-option-c capture-fixtures");
  });

  test("init persists effective citations config into run-config.json", async () => {
    await withTempDir(async (runsRoot) => {
      const runId = "dr_test_cli_config_001";
      const proc = Bun.spawn({
        cmd: [
          "bun",
          cliPath,
          "init",
          "Q",
          "--runs-root",
          runsRoot,
          "--run-id",
          runId,
          "--mode",
          "standard",
          "--sensitivity",
          "restricted",
          "--no-perspectives",
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(stderr.trim()).toBe("");

      const runConfigPath = path.join(runsRoot, runId, "run-config.json");
      const runConfig = JSON.parse(await fs.readFile(runConfigPath, "utf8"));

      expect(runConfig.effective.citations.mode).toBe("dry_run");
      expect(runConfig.effective.citations.endpoints.brightdata).toBe("");
      expect(runConfig.effective.citations.endpoints.apify).toBe("");
      expect(runConfig.effective.citations.source.mode).toBe("manifest");
      expect(runConfig.effective.citations.source.authority).toBe("run-config");
    });
  });

  test("surfaces blocked URLs summary and next actions", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = "dr_test_cli_inspect_001";
        const initRaw = (await (run_init as any).execute(
          { query: "Q", mode: "standard", sensitivity: "normal", run_id: runId, root_override: base },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);

        const manifestPath = String((init as any).manifest_path);
        const runRoot = path.dirname(manifestPath);
        const blockedPath = path.join(runRoot, "citations", "blocked-urls.json");

        await fs.writeFile(
          blockedPath,
          `${JSON.stringify({
            schema_version: "blocked_urls.v1",
            run_id: runId,
            generated_at: "2026-02-18T00:00:00.000Z",
            items: [
              { status: "blocked", action: "Configure Bright Data/Apify endpoint", normalized_url: "https://a.example" },
              { status: "blocked", action: "Configure Bright Data/Apify endpoint", normalized_url: "https://b.example" },
              { status: "paywalled", action: "Investigate URL manually", normalized_url: "https://c.example" },
            ],
          }, null, 2)}\n`,
          "utf8",
        );

        const proc = Bun.spawn({
          cmd: ["bun", cliPath, "inspect", "--manifest", manifestPath],
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        expect(exitCode).toBe(0);
        expect(stderr.trim()).toBe("");
        expect(stdout).toContain("citations_blockers:");
        expect(stdout).toContain(`artifact_path: ${blockedPath}`);
        expect(stdout).toContain("blocked: 2");
        expect(stdout).toContain("paywalled: 1");
        expect(stdout).toContain("Configure Bright Data/Apify endpoint (count=2)");
      });
    });
  });
});
