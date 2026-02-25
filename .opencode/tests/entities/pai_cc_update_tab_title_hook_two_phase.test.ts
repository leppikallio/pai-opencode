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
    } else {
      env[key] = value;
    }
  }

  return env;
}

function tabStatePath(runtimeRoot: string, sessionId: string): string {
  return path.join(runtimeRoot, "MEMORY", "STATE", `tab-state-${sessionId}.json`);
}

async function makeRuntimeRoot(prefix: string): Promise<string> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(runtimeRoot, "hooks"), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, "skills"), { recursive: true });
  return runtimeRoot;
}

async function runUpdateTabTitleHook(args: {
  runtimeRoot: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/UpdateTabTitle.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.runtimeRoot,
      PAI_DISABLE_UPDATE_TAB_TITLE_INFERENCE: "1",
      CMUX_SOCKET_PATH: "",
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

describe("UpdateTabTitle hook two-phase behavior", () => {
  test("writes working tab title with inference gate enabled", async () => {
    const runtimeRoot = await makeRuntimeRoot("pai-update-tab-title-");

    try {
      const result = await runUpdateTabTitleHook({
        runtimeRoot,
        payload: {
          session_id: "S1",
          prompt: "fix auth",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");

      const snapshotRaw = await fs.readFile(tabStatePath(runtimeRoot, "S1"), "utf8");
      const snapshot = JSON.parse(snapshotRaw) as { title?: string; state?: string };
      expect(snapshot.state).toBe("working");
      expect(snapshot.title?.startsWith("⚙️")).toBe(true);
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("rating prompt is ignored and does not create tab state file", async () => {
    const runtimeRoot = await makeRuntimeRoot("pai-update-tab-title-");

    try {
      const result = await runUpdateTabTitleHook({
        runtimeRoot,
        payload: {
          session_id: "S-rating",
          prompt: "8",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(await fs.stat(tabStatePath(runtimeRoot, "S-rating")).then(() => true).catch(() => false)).toBe(false);
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
