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

type BiomeLintSummary = {
  errors?: number;
  warnings?: number;
  infos?: number;
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

function parseBiomeJson(stdout: string): { summary: BiomeLintSummary } | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const jsonText = stdout.slice(start, end + 1).trim();
  try {
    const parsed = JSON.parse(jsonText) as { summary?: BiomeLintSummary };
    if (!parsed || typeof parsed !== "object") return null;
    const summary = parsed.summary;
    if (!summary || typeof summary !== "object") return null;
    return { summary };
  } catch {
    return null;
  }
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
    // Biome exits non-zero for errors; warnings/infos still exit 0 by default.
    // Repo policy: ANY diagnostics (info/warn/error) must block commits.
    const report = await capture({
      cmd: biomeBin(),
      args: [
        "lint",
        "--diagnostic-level=info",
        "--reporter=json",
        "--files-ignore-unknown=true",
        ...tsFiles,
      ],
    });

    if (report.code !== 0) {
      // Re-run with default reporter for readable output.
      await run({
        cmd: biomeBin(),
        args: ["lint", "--files-ignore-unknown=true", ...tsFiles],
      });
      failed = true;
    } else {
      const parsed = parseBiomeJson(report.stdout);
      if (!parsed) {
        console.error("\nERROR: failed to parse Biome JSON reporter output.");
        console.error("Re-run with: biome lint --reporter=json ... to inspect output.");
        failed = true;
      } else {
        const errors = Number(parsed.summary.errors ?? 0);
        const warnings = Number(parsed.summary.warnings ?? 0);
        const infos = Number(parsed.summary.infos ?? 0);
        if ((errors + warnings + infos) > 0) {
          await run({
            cmd: biomeBin(),
            args: ["lint", "--files-ignore-unknown=true", ...tsFiles],
          });
          failed = true;
        }
      }
    }
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
