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

async function runAwarenessHook(args: {
  runtimeRoot: string;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, ".opencode/hooks/RtkAwareness.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      ...args.env,
      OPENCODE_ROOT: args.runtimeRoot,
      OPENCODE_CONFIG_ROOT: undefined,
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

async function writeCapabilityCache(args: {
  runtimeRoot: string;
  capability: { present: boolean; version: string | null; supportsRewrite: boolean };
}): Promise<void> {
  const cachePath = path.join(args.runtimeRoot, "MEMORY", "STATE", "rtk", "capability.json");
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(args.capability, null, 2)}\n`, "utf8");
}

describe("RtkAwareness SessionStart hook", () => {
  test("no-ops when RTK cache is missing", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-awareness-missing-"));

    try {
      const result = await runAwarenessHook({ runtimeRoot });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("no-ops when cached RTK capability does not support rewrite", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-awareness-unsupported-"));

    try {
      await writeCapabilityCache({
        runtimeRoot,
        capability: {
          present: true,
          version: "0.22.9",
          supportsRewrite: false,
        },
      });

      const result = await runAwarenessHook({ runtimeRoot });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("emits adapted RTK awareness when cached capability supports rewrite", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-awareness-supported-"));
    const emptyPathDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-awareness-empty-path-"));

    try {
      await writeCapabilityCache({
        runtimeRoot,
        capability: {
          present: true,
          version: "0.23.0",
          supportsRewrite: true,
        },
      });

      const result = await runAwarenessHook({
        runtimeRoot,
        env: {
          PATH: emptyPathDir,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("<system-reminder>");
      expect(result.stdout).toContain("rtk gain");
      expect(result.stdout).toContain("rtk gain --history");
      expect(result.stdout).toContain("rtk discover");
      expect(result.stdout).toContain("rtk proxy <cmd>");
      expect(result.stdout).toContain("PAI/OpenCode");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(emptyPathDir, { recursive: true, force: true });
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
