import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot =
  path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
const sourceDir = path.join(repoRoot, ".opencode");

export function prependPath(binDir: string): string {
  const existingPath = process.env.PATH ?? "";
  return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

export function createRtkShim(args: {
  versionOutput: string;
  tempPrefix: string;
}): string {
  const shimDir = mkdtempSync(path.join(os.tmpdir(), args.tempPrefix));
  const shimPath = path.join(shimDir, "rtk");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${args.versionOutput}"
  exit 0
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "rtk %s\\n" "$*"
  exit 0
fi
exit 1
`;

  writeFileSync(shimPath, script, "utf8");
  chmodSync(shimPath, 0o755);
  return shimDir;
}

export function runInstall(args: { targetDir: string; pathValue: string }) {
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

export function readRuntimeOpenCodeConfig(targetDir: string): {
  raw: string;
  parsed: Record<string, unknown>;
} {
  const configPath = path.join(targetDir, "opencode.json");
  const raw = readFileSync(configPath, "utf8");
  return {
    raw,
    parsed: JSON.parse(raw) as Record<string, unknown>,
  };
}
