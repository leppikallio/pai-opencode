#!/usr/bin/env bun
/**
 * CountSkillBudgetLines
 *
 * Counts "budget lines" in a SKILL.md file.
 *
 * Budget lines rule (procedural default):
 * - Count all lines (including YAML frontmatter and blanks)
 * - EXCEPT: exclude the `## Examples` section (heading + body)
 *   where the section is defined as:
 *     - starts at a line matching /^##\s+Examples\s*$/
 *     - ends immediately before the next /^##\s+/ line (or EOF)
 */

import * as fs from "node:fs/promises";

type Format = "text" | "json";

type Result = {
  file: string;
  budgetLines: number;
  totalLines: number;
  excludedExampleLines: number;
  max?: number;
  ok: boolean;
};

function usageText(): string {
  return `CountSkillBudgetLines

Usage:
  bun CountSkillBudgetLines.ts --file <path> [--max <n>] [--format text|json]

Options:
  --file <path>     Path to SKILL.md
  --max <n>         If set, exits non-zero when budgetLines > max
  --format <fmt>    text (default) | json
  --help            Show help

Exit codes:
  0  ok (and within max if provided)
  1  budgetLines exceeds --max
  2  tool error (bad args / IO)
`;
}

function parseArgs(argv: string[]) {
  let file: string | undefined;
  let max: number | undefined;
  let format: Format = "text";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(usageText());
      process.exit(0);
    }
    if (a === "--file") {
      file = argv[++i];
      continue;
    }
    if (a === "--max") {
      const v = argv[++i];
      if (!v) throw new Error("--max requires a value");
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --max: ${v}`);
      max = n;
      continue;
    }
    if (a === "--format") {
      const v = argv[++i];
      if (v !== "text" && v !== "json") {
        throw new Error(`--format must be text|json (got ${v ?? "(missing)"})`);
      }
      format = v;
      continue;
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!file) throw new Error("--file is required");
  return { file, max, format };
}

function countBudgetLines(markdown: string) {
  const lines = markdown.split(/\r?\n/);

  let inExamples = false;
  let excludedExampleLines = 0;
  let budgetLines = 0;

  for (const line of lines) {
    const isH2 = /^##\s+/.test(line);
    const isExamplesH2 = /^##\s+Examples\s*$/.test(line);

    if (isExamplesH2) {
      inExamples = true;
      excludedExampleLines++;
      continue;
    }

    if (inExamples && isH2) {
      // new H2 section ends Examples section
      inExamples = false;
    }

    if (inExamples) {
      excludedExampleLines++;
      continue;
    }

    budgetLines++;
  }

  return {
    budgetLines,
    totalLines: lines.length,
    excludedExampleLines,
  };
}

async function main() {
  try {
    const { file, max, format } = parseArgs(process.argv.slice(2));
    const md = await fs.readFile(file, "utf8");
    const { budgetLines, totalLines, excludedExampleLines } = countBudgetLines(md);

    const ok = max === undefined ? true : budgetLines <= max;
    const result: Result = {
      file,
      budgetLines,
      totalLines,
      excludedExampleLines,
      max,
      ok,
    };

    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const maxText = max === undefined ? "(no max)" : String(max);
      process.stdout.write(
        `Budget lines: ${budgetLines} (max ${maxText}) | Total lines: ${totalLines} | Excluded examples: ${excludedExampleLines}\n`
      );
    }

    if (!ok) process.exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`CountSkillBudgetLines tool error: ${msg}\n`);
    process.exitCode = 2;
  }
}

await main();
