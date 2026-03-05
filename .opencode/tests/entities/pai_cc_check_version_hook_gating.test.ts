import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type HookRunOptions = {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

function withEnvOverrides(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function runHook(options: HookRunOptions = {}): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/CheckVersion.hook.ts"],
    cwd: repoRoot,
    env: withEnvOverrides(options.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();

  proc.stdin.end();

  const exitResult = await Promise.race([
    proc.exited.then((exitCode) => ({ timedOut: false as const, exitCode })),
    new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);

  if (exitResult.timedOut) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Ignore kill failures in tests.
    }

    throw new Error(`hook timed out after ${timeoutMs}ms`);
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  return {
    exitCode: exitResult.exitCode,
    stderr,
    stdout,
    elapsedMs: Date.now() - startedAt,
  };
}

async function createShimDir(npmScript: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "check-version-hook-"));
  const opencodePath = path.join(dir, "opencode");
  const npmPath = path.join(dir, "npm");

  await fs.writeFile(opencodePath, "#!/bin/sh\necho \"opencode 1.0.0\"\n", { mode: 0o755 });
  await fs.writeFile(npmPath, npmScript, { mode: 0o755 });
  await fs.chmod(opencodePath, 0o755);
  await fs.chmod(npmPath, 0o755);

  return dir;
}

function prependPath(binDir: string): string {
  const existingPath = process.env.PATH ?? "";
  return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

describe("CheckVersion hook gating", () => {
  test("PAI_DISABLE_VERSION_CHECK=1 is a no-op", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          PAI_DISABLE_VERSION_CHECK: "1",
          PAI_NO_NETWORK: undefined,
          OPENCODE_PROJECT_DIR: "/tmp/.opencode/Agents/session-1",
          CLAUDE_AGENT_TYPE: "Subagent",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("PAI_NO_NETWORK=1 is a no-op", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("OPENCODE_AGENT_TYPE=Subagent is treated as subagent and no-ops", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          OPENCODE_AGENT_TYPE: "Subagent",
          OPENCODE_PROJECT_DIR: "/tmp/project",
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: undefined,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("OPENCODE project marker requires lowercase /.opencode/agents/", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          OPENCODE_AGENT_TYPE: "",
          OPENCODE_PROJECT_DIR: "/tmp/.opencode/Agents/session-1",
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: undefined,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Ignoring uppercase agent marker; use /.opencode/agents/");
      expect(result.stderr).toContain("Update available: opencode 1.0.0 -> 2.0.0");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("lowercase /.opencode/agents/ marker is treated as subagent", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          OPENCODE_AGENT_TYPE: "",
          OPENCODE_PROJECT_DIR: "/tmp/.opencode/agents/session-1",
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: undefined,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("legacy CLAUDE markers are ignored (no fallback)", async () => {
    const shimDir = await createShimDir("#!/bin/sh\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          CLAUDE_AGENT_TYPE: "Subagent",
          CLAUDE_PROJECT_DIR: "/tmp/.claude/Agents/old",
          OPENCODE_AGENT_TYPE: "",
          OPENCODE_PROJECT_DIR: "/tmp/project",
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: undefined,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Ignoring legacy CLAUDE_* subagent markers");
      expect(result.stderr).toContain("Update available: opencode 1.0.0 -> 2.0.0");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  });

  test("hanging npm is timed out and hook exits quickly", async () => {
    const shimDir = await createShimDir("#!/bin/sh\nsleep 5\necho \"2.0.0\"\n");
    try {
      const result = await runHook({
        env: {
          PATH: prependPath(shimDir),
          OPENCODE_AGENT_TYPE: "",
          OPENCODE_PROJECT_DIR: "/tmp/project",
          PAI_DISABLE_VERSION_CHECK: undefined,
          PAI_NO_NETWORK: undefined,
        },
        timeoutMs: 2200,
      });

      expect(result.exitCode).toBe(0);
      expect(result.elapsedMs).toBeLessThan(2000);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  }, 6000);
});
