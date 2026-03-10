import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { maybeRewriteBashToolInputWithRtk } from "../../plugins/pai-cc-hooks/rtk";
import {
  getRtkCapabilityCachePath,
  refreshRtkCapabilityCache,
  writeRtkCapabilityCache,
} from "../../plugins/rtk/capability";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
const sourceDir = path.join(repoRoot, ".opencode");

function prependPath(binDir: string): string {
  const existingPath = process.env.PATH ?? "";
  return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

async function createRtkShim(args: {
  versionMode: "modern" | "too-old" | "missing";
  rewritePrefix?: string;
}): Promise<string> {
  const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-upgrade-shim-"));
  const shimPath = path.join(shimDir, "rtk");

  const versionBranch =
    args.versionMode === "modern"
      ? 'echo "rtk 0.23.0"\n  exit 0'
      : args.versionMode === "too-old"
      ? 'echo "rtk 0.22.9"\n  exit 0'
      : "exit 1";

  const rewritePrefix = args.rewritePrefix ?? "rtk";
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  ${versionBranch}
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "${rewritePrefix} %s\\n" "$*"
  exit 0
fi
exit 1
`;

  await fs.writeFile(shimPath, script, { mode: 0o755 });
  await fs.chmod(shimPath, 0o755);
  return shimDir;
}

function runInstall(args: { targetDir: string; pathValue: string }) {
  return spawnSync(
    "bun",
    [
      installToolPath,
      "--target",
      args.targetDir,
      "--source",
      sourceDir,
      "--non-interactive",
      "--skills",
      "all",
      "--skills-gate-profile",
      "off",
      "--no-install-deps",
      "--no-verify",
    ],
    {
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        PATH: args.pathValue,
      },
    },
  );
}

async function readCachedCapability(stateDir: string) {
  const cachePath = getRtkCapabilityCachePath({ stateDir });
  return JSON.parse(await fs.readFile(cachePath, "utf8")) as {
    present: boolean;
    version: string | null;
    supportsRewrite: boolean;
  };
}

async function withRuntimeEnv<T>(args: {
  runtimeRoot: string;
  pathValue: string;
  run: () => Promise<T>;
}): Promise<T> {
  const previousRoot = process.env.OPENCODE_ROOT;
  const previousConfigRoot = process.env.OPENCODE_CONFIG_ROOT;
  const previousPath = process.env.PATH;

  process.env.OPENCODE_ROOT = args.runtimeRoot;
  delete process.env.OPENCODE_CONFIG_ROOT;
  process.env.PATH = args.pathValue;

  try {
    return await args.run();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.OPENCODE_ROOT;
    } else {
      process.env.OPENCODE_ROOT = previousRoot;
    }

    if (previousConfigRoot === undefined) {
      delete process.env.OPENCODE_CONFIG_ROOT;
    } else {
      process.env.OPENCODE_CONFIG_ROOT = previousConfigRoot;
    }

    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
}

describe("rtk upgrade safety", () => {
  test("refresh rewrites stale cache when upgrade target is too old", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-upgrade-runtime-"));
    const shimDir = await createRtkShim({ versionMode: "too-old" });

    try {
      const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
      await writeRtkCapabilityCache({
        stateDir,
        capability: {
          present: true,
          version: "0.24.0",
          supportsRewrite: true,
        },
      });

      await refreshRtkCapabilityCache({
        stateDir,
        env: { PATH: prependPath(shimDir) },
      });

      expect(await readCachedCapability(stateDir)).toEqual({
        present: true,
        version: "0.22.9",
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("refresh rewrites stale cache when RTK is missing", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-upgrade-runtime-"));
    const shimDir = await createRtkShim({ versionMode: "missing" });

    try {
      const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
      await writeRtkCapabilityCache({
        stateDir,
        capability: {
          present: true,
          version: "0.24.0",
          supportsRewrite: true,
        },
      });

      await refreshRtkCapabilityCache({
        stateDir,
        env: { PATH: prependPath(shimDir) },
      });

      expect(await readCachedCapability(stateDir)).toEqual({
        present: false,
        version: null,
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("runtime rewrite delegates live behavior to rtk rewrite after cache refresh", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-upgrade-runtime-"));
    const bootstrapShimDir = await createRtkShim({ versionMode: "modern", rewritePrefix: "rtk" });
    const upgradedShimDir = await createRtkShim({ versionMode: "modern", rewritePrefix: "proxy" });

    try {
      const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
      await refreshRtkCapabilityCache({
        stateDir,
        env: { PATH: prependPath(bootstrapShimDir) },
      });

      const rewritten = await withRuntimeEnv({
        runtimeRoot,
        pathValue: prependPath(upgradedShimDir),
        run: () =>
          maybeRewriteBashToolInputWithRtk({
            toolName: "bash",
            toolInput: { command: "git status", description: "test" },
          }),
      });

      expect(rewritten).toEqual({
        command: "proxy git status",
        description: "test",
      });
    } finally {
      await fs.rm(bootstrapShimDir, { recursive: true, force: true });
      await fs.rm(upgradedShimDir, { recursive: true, force: true });
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("install/bootstrap refresh replaces stale supported cache when RTK is missing", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-upgrade-install-"));
    const modernShimDir = await createRtkShim({ versionMode: "modern" });
    const missingShimDir = await createRtkShim({ versionMode: "missing" });

    try {
      const firstRun = runInstall({
        targetDir,
        pathValue: prependPath(modernShimDir),
      });
      const firstOutput = `${firstRun.stdout ?? ""}\n${firstRun.stderr ?? ""}`;
      expect(firstRun.status, firstOutput).toBe(0);

      const secondRun = runInstall({
        targetDir,
        pathValue: prependPath(missingShimDir),
      });
      const secondOutput = `${secondRun.stdout ?? ""}\n${secondRun.stderr ?? ""}`;
      expect(secondRun.status, secondOutput).toBe(0);

      const cachePath = path.join(targetDir, "MEMORY", "STATE", "rtk", "capability.json");
      const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
      expect(cache).toEqual({
        present: false,
        version: null,
        supportsRewrite: false,
      });
    } finally {
      await fs.rm(modernShimDir, { recursive: true, force: true });
      await fs.rm(missingShimDir, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});
