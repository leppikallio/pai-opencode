#!/usr/bin/env bun
/**
 * Precommit - repo pre-commit gate
 *
 * Runs mandatory checks and fails the commit on each failure:
 * - Biome lint on staged TypeScript files
 * - gitleaks leak detection (staged)
 * - PAI protected file validation (staged)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Cmd = {
  cmd: string;
  args: string[];
  cwd?: string;
};

async function run({ cmd, args, cwd }: Cmd): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: cwd ?? REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  return await proc.exited;
}

async function capture({ cmd, args, cwd }: Cmd): Promise<{ code: number; stdout: string } > {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout: out };
}

function stagedTypeScriptFiles(staged: string[]): string[] {
  return staged.filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
}

function biomeBin(): string {
  const bin = join(REPO_ROOT, "node_modules", ".bin", "biome");
  return existsSync(bin) ? bin : "biome";
}

async function main(): Promise<void> {
  let failed = false;

  // 1) Get staged files
  const stagedRes = await capture({
    cmd: "git",
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
  });

  if (stagedRes.code !== 0) {
    process.exit(stagedRes.code);
  }

  const staged = stagedRes.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) Biome lint (staged TS only)
  const tsFiles = stagedTypeScriptFiles(staged);
  if (tsFiles.length > 0) {
    const code = await run({
      cmd: biomeBin(),
      args: ["lint", "--files-ignore-unknown=true", ...tsFiles],
    });
    if (code !== 0) failed = true;
  }

  // 3) gitleaks (staged)
  // Strict: fail the commit if gitleaks is not installed.
  const gitleaksCheck = await capture({ cmd: "gitleaks", args: ["version"] });
  if (gitleaksCheck.code !== 0) {
    console.error("\nERROR: gitleaks is required for commits.");
    console.error("Install it (macOS): brew install gitleaks");
    console.error("Or download a release binary: https://github.com/gitleaks/gitleaks\n");
    failed = true;
  } else {
    const code = await run({
      cmd: "gitleaks",
      args: [
        "protect",
        "--staged",
        "--redact",
        "--verbose",
        "--gitleaks-ignore-path",
        REPO_ROOT,
      ],
    });
    if (code !== 0) failed = true;
  }

  // 4) PAI protected file validation (staged)
  {
    const code = await run({
      cmd: "bun",
      args: ["Tools/validate-protected.ts", "--staged"],
    });
    if (code !== 0) failed = true;
  }

  process.exit(failed ? 1 : 0);
}

await main();
