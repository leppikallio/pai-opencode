import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getRtkCapabilityCachePath,
  refreshRtkCapabilityCache,
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

async function createRtkShim(args: { versionOutput: string }): Promise<string> {
  const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-bootstrap-shim-"));
  const shimPath = path.join(shimDir, "rtk");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${args.versionOutput}"
  exit 0
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "%s\\n" "$*"
  exit 0
fi
exit 1
`;

  await fs.writeFile(shimPath, script, { mode: 0o755 });
  await fs.chmod(shimPath, 0o755);
  return shimDir;
}

describe("rtk bootstrap detection", () => {
  test("writes deterministic capability cache path with rewrite support", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rtk-bootstrap-runtime-"));
    const shimDir = await createRtkShim({ versionOutput: "rtk 0.23.0" });

    try {
      const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
      const result = await refreshRtkCapabilityCache({
        stateDir,
        env: { PATH: prependPath(shimDir) },
      });

      expect(result.capability).toEqual({
        present: true,
        version: "0.23.0",
        supportsRewrite: true,
      });

      const expectedPath = path.join(runtimeRoot, "MEMORY", "STATE", "rtk", "capability.json");
      expect(getRtkCapabilityCachePath({ stateDir })).toBe(expectedPath);
      expect(result.cachePath).toBe(expectedPath);

      const cache = JSON.parse(await fs.readFile(expectedPath, "utf8"));
      expect(cache).toEqual({
        present: true,
        version: "0.23.0",
        supportsRewrite: true,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("install refreshes RTK capability cache during bootstrap", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-install-rtk-capability-"));
    const shimDir = await createRtkShim({ versionOutput: "rtk 0.23.0" });

    try {
      const run = spawnSync(
        "bun",
        [
          installToolPath,
          "--target",
          targetDir,
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
            PATH: prependPath(shimDir),
          },
        },
      );

      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const cachePath = path.join(targetDir, "MEMORY", "STATE", "rtk", "capability.json");
      const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
      expect(cache).toEqual({
        present: true,
        version: "0.23.0",
        supportsRewrite: true,
      });
    } finally {
      await fs.rm(shimDir, { recursive: true, force: true });
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});
