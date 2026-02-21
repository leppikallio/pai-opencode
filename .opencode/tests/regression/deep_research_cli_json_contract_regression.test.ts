import { describe, expect, test } from "bun:test";
import * as path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const jsonContractPath = path.join(
  repoRoot,
  ".opencode",
  "pai-tools",
  "deep-research-cli",
  "cli",
  "json-contract.ts",
);

describe("deep_research cli json-contract (regression)", () => {
  test("emitJsonV1 prints parseable envelope with schema_version", async () => {
    const script = [
      `import { emitJsonV1 } from ${JSON.stringify(jsonContractPath)};`,
      "emitJsonV1({ ok: true, command: \"tick\", contract: { run_id: \"dr_test\" }, result: { hello: \"world\" } });",
    ].join("\n");

    const proc = Bun.spawn({
      cmd: ["bun", "-e", script],
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exit = await proc.exited;

    expect(exit).toBe(0);
    expect(stderr).toBe("");

    const trimmed = stdout.trim();
    expect(trimmed.startsWith("{")).toBe(true);
    expect(trimmed.endsWith("}")).toBe(true);
    expect(trimmed.split(/\r?\n/)).toHaveLength(1);

    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    expect(payload.schema_version).toBe("dr.cli.v1");
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("tick");
  });
});
