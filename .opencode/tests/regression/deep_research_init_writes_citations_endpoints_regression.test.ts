import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  asRecord,
  withTempDir,
} from "../helpers/dr-harness";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const cliPath = path.join(repoRoot, ".opencode", "pai-tools", "deep-research-cli.ts");

async function runCli(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", cliPath, ...args],
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

describe("deep_research init writes citations endpoints from init flags (regression)", () => {
  test("init --json endpoint flags are written to run-config with run-config source", async () => {
    await withTempDir(async (base) => {
      const runId = "dr_test_init_citations_endpoints_001";
      const brightDataEndpoint = "https://brightdata.example/validate";
      const apifyEndpoint = "https://apify.example/validate";

      const res = await runCli([
        "init",
        "Q",
        "--run-id",
        runId,
        "--runs-root",
        base,
        "--citations-brightdata-endpoint",
        brightDataEndpoint,
        "--citations-apify-endpoint",
        apifyEndpoint,
        "--json",
      ]);

      expect(res.exit).toBe(0);
      const payload = JSON.parse(res.stdout.trim()) as Record<string, unknown>;
      expect(payload.schema_version).toBe("dr.cli.v1");
      expect(payload.ok).toBe(true);

      const result = asRecord(payload.result, "result");
      const runConfigPath = String(result.run_config_path ?? "");
      expect(runConfigPath.length).toBeGreaterThan(0);

      const runConfig = JSON.parse(await fs.readFile(runConfigPath, "utf8")) as Record<string, unknown>;
      const effective = asRecord(runConfig.effective, "run-config.effective");
      const citations = asRecord(effective.citations, "run-config.effective.citations");
      const endpoints = asRecord(citations.endpoints, "run-config.effective.citations.endpoints");

      expect(endpoints.brightdata).toBe(brightDataEndpoint);
      expect(endpoints.apify).toBe(apifyEndpoint);

      const source = asRecord(citations.source, "run-config.effective.citations.source");
      const sourceEndpoints = asRecord(source.endpoints, "run-config.effective.citations.source.endpoints");
      expect(sourceEndpoints.brightdata).toBe("run-config");
      expect(sourceEndpoints.apify).toBe("run-config");
    });
  });
});
