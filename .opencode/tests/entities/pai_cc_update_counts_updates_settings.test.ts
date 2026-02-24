import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  return env;
}

async function runUpdateCountsHook(args: {
  paiDir: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/UpdateCounts.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      PAI_DIR: args.paiDir,
      PAI_NO_NETWORK: "1",
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe("UpdateCounts hook updates settings.json counts", () => {
  test("updates counts.updatedAt and counts.hooks while preserving existing count keys", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-update-counts-hook-"));
    const hooksDir = path.join(paiDir, "hooks");
    const settingsPath = path.join(paiDir, "settings.json");
    const initialUpdatedAt = "2024-01-01T00:00:00.000Z";

    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(path.join(hooksDir, "LoadContext.hook.ts"), "#!/usr/bin/env bun\n", "utf8");
    await fs.writeFile(path.join(hooksDir, "UpdateCounts.hook.ts"), "#!/usr/bin/env bun\n", "utf8");
    await fs.writeFile(path.join(hooksDir, "NotifyStart.hook.ts"), "#!/usr/bin/env bun\n", "utf8");
    await fs.writeFile(path.join(hooksDir, "lib.ts"), "export {};\n", "utf8");
    await fs.writeFile(
      settingsPath,
      `${JSON.stringify({
        featureFlag: true,
        counts: {
          hooks: 0,
          updatedAt: initialUpdatedAt,
          preservedField: 7,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    try {
      const result = await runUpdateCountsHook({ paiDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");

      const parsed = JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<string, unknown>;
      const counts = parsed.counts as Record<string, unknown>;

      expect(counts.hooks).toBe(3);

      expect(typeof counts.updatedAt).toBe("string");
      expect(counts.updatedAt).not.toBe(initialUpdatedAt);
      expect(Number.isNaN(Date.parse(String(counts.updatedAt)))).toBe(false);

      expect(counts.preservedField).toBe(7);
      expect(parsed.featureFlag).toBe(true);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("does not modify settings.json when existing file contains invalid JSON", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-update-counts-hook-"));
    const hooksDir = path.join(paiDir, "hooks");
    const settingsPath = path.join(paiDir, "settings.json");
    const invalidSettings = '{"counts": {"hooks": 1,\n';

    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(path.join(hooksDir, "LoadContext.hook.ts"), "#!/usr/bin/env bun\n", "utf8");
    await fs.writeFile(settingsPath, invalidSettings, "utf8");

    try {
      const result = await runUpdateCountsHook({ paiDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Failed to parse settings.json");

      const after = await fs.readFile(settingsPath, "utf8");
      expect(after).toBe(invalidSettings);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
