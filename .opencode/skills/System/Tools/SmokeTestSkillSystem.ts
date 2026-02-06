#!/usr/bin/env bun
/**
 * SmokeTestSkillSystem
 *
 * Pragmatic verification for "does the system behave as intended" after SkillSystem/CreateSkill refactors.
 *
 * Two layers:
 *  1) Static checks (no LLM calls):
 *     - ValidateSkillSystemDocs
 *     - Budget-line counts for selected SKILL.md files
 *  2) Behavioral checks (LLM calls via `opencode run --format json`):
 *     - Ask targeted questions that MUST trigger Read-gated behavior and canary citation.
 *
 * Note: this tool runs against the *installed runtime* paths by default.
 */

import * as fs from "node:fs/promises";

type Format = "text" | "json";

type Finding = {
  severity: "error" | "warning";
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type Report = {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
  meta: {
    mode: "static" | "behavior" | "both";
    model?: string;
    agent?: string;
    ranAt: string;
  };
};

const RUNTIME_ROOT = "/Users/zuul/.config/opencode";

const DEFAULTS = {
  format: "text" as Format,
  mode: "static" as "static" | "behavior" | "both",
  agent: "",
  model: "openai/gpt-5.3-codex",
  printLogs: false,
  dryRun: false,
};

function usageText(): string {
  return `SmokeTestSkillSystem

Usage:
  bun "${RUNTIME_ROOT}/skills/System/Tools/SmokeTestSkillSystem.ts" [options]

Options:
  --mode <static|behavior|both>   Which checks to run (default: static)
  --model <provider/model>       Model for opencode behavioral checks (default: ${DEFAULTS.model})
  --agent <AgentName>            Agent for opencode behavioral checks (default: runtime default)
  --print-logs                    Pass --print-logs to opencode run (behavior mode)
  --dry-run                       Print commands only; do not run
  --format <text|json>            Output format (default: text)
  --help                          Show help

Behavioral checks call the LLM via:
  opencode run --format json --agent <AgentName> --model <provider/model> "<message>"
`;
}

function parseArgs(argv: string[]) {
  const out = {
    ...DEFAULTS,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      process.stdout.write(usageText());
      process.exit(0);
    }

    if (a === "--format") {
      const v = argv[++i];
      if (v !== "text" && v !== "json") {
        throw new Error(`--format must be text|json (got ${v ?? "(missing)"})`);
      }
      out.format = v;
      continue;
    }

    if (a === "--mode") {
      const v = argv[++i];
      if (v !== "static" && v !== "behavior" && v !== "both") {
        throw new Error(`--mode must be static|behavior|both (got ${v ?? "(missing)"})`);
      }
      out.mode = v;
      continue;
    }

    if (a === "--model") {
      const v = argv[++i];
      if (!v) throw new Error("--model requires a value");
      out.model = v;
      continue;
    }

    if (a === "--agent") {
      const v = argv[++i];
      if (!v) throw new Error("--agent requires a value");
      out.agent = v;
      continue;
    }

    if (a === "--print-logs") {
      out.printLogs = true;
      continue;
    }

    if (a === "--dry-run") {
      out.dryRun = true;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function push(findings: Finding[], finding: Finding) {
  findings.push(finding);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function runCmd(cmd: string[], opts: { dryRun: boolean }) {
  const pretty = cmd.map((c) => (c.includes(" ") ? JSON.stringify(c) : c)).join(" ");
  if (opts.dryRun) {
    return { code: 0, stdout: "", stderr: `[dry-run] ${pretty}\n` };
  }

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function staticChecks(findings: Finding[], opts: { dryRun: boolean }) {
  const validateSkillSystemDocs = `${RUNTIME_ROOT}/skills/System/Tools/ValidateSkillSystemDocs.ts`;
  const countBudgetLines = `${RUNTIME_ROOT}/skills/CreateSkill/Tools/CountSkillBudgetLines.ts`;

  if (!(await fileExists(validateSkillSystemDocs))) {
    push(findings, {
      severity: "error",
      code: "MISSING_TOOL_VALIDATE_SKILLSYSTEM",
      message: `Missing runtime tool: ${validateSkillSystemDocs}`,
    });
    return;
  }

  // Validate SkillSystem router/section invariants.
  {
    const res = await runCmd(["bun", validateSkillSystemDocs], opts);
    if (res.code !== 0) {
      push(findings, {
        severity: "error",
        code: "SKILLSYSTEM_VALIDATION_FAILED",
        message: "ValidateSkillSystemDocs failed",
        details: { stdout: res.stdout, stderr: res.stderr },
      });
    }
  }

  // Budget-line counter sanity for key SKILL.md files.
  if (!(await fileExists(countBudgetLines))) {
    push(findings, {
      severity: "warning",
      code: "MISSING_TOOL_COUNT_BUDGET_LINES",
      message: `Missing budget counter tool: ${countBudgetLines}`,
    });
    return;
  }

  const skillFiles: Array<{ file: string; max?: number; label: string }> = [
    {
      label: "CreateSkill (info only)",
      file: `${RUNTIME_ROOT}/skills/CreateSkill/SKILL.md`,
    },
    {
      label: "PAI (expected to be large until migrated)",
      file: `${RUNTIME_ROOT}/skills/PAI/SKILL.md`,
      max: 80,
    },
  ];

  for (const { file, max, label } of skillFiles) {
    if (!(await fileExists(file))) {
      push(findings, {
        severity: "warning",
        code: "MISSING_SKILL_FILE",
        message: `Missing SKILL.md in runtime (skipping budget check): ${file}`,
      });
      continue;
    }

    const cmd = ["bun", countBudgetLines, "--file", file, "--format", "json"];
    const res = await runCmd(cmd, opts);

    if (res.code === 2) {
      push(findings, {
        severity: "warning",
        code: "BUDGET_TOOL_ERROR",
        message: `Budget-lines tool errored for: ${file}`,
        details: { label, stdout: res.stdout, stderr: res.stderr },
      });
      continue;
    }

    // Parse JSON payload if possible.
    let payload: unknown = null;
    try {
      payload = res.stdout ? JSON.parse(res.stdout) : null;
    } catch {
      // Keep it non-fatal: report parse issue.
      push(findings, {
        severity: "warning",
        code: "BUDGET_JSON_PARSE_FAILED",
        message: `Could not parse budget JSON for: ${file}`,
        details: { label, stdout: res.stdout, stderr: res.stderr },
      });
      continue;
    }

    const payloadRecord: Record<string, unknown> | null =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const budgetLines =
      payloadRecord && typeof payloadRecord.budgetLines === "number" ? payloadRecord.budgetLines : null;

    if (typeof max === "number" && typeof budgetLines === "number") {
      if (budgetLines > max) {
        push(findings, {
          severity: "warning",
          code: "BUDGET_OVER_MAX",
          message: `${label}: budgetLines ${budgetLines} exceeds max ${max} (${file})`,
          details: payloadRecord ?? { raw: res.stdout },
        });
      }
    }
  }
}

type BehaviorCase = {
  name: string;
  message: string;
  files: string[];
  mustContainAll: string[];
  mustContainAny?: string[];
};

function behaviorCases(): BehaviorCase[] {
  return [
    {
      name: "Structure canary",
      message:
        "Using only the attached file, answer: are numeric-prefixed docs allowed outside /Users/zuul/.config/opencode/skills/PAI/Components/**? Cite either the canary comment (preferred) or the exact heading you used.",
      files: [
        `${RUNTIME_ROOT}/skills/PAI/SYSTEM/SkillSystem/Structure.md`,
      ],
      mustContainAll: ["/Users/zuul/.config/opencode/skills/PAI/Components/**"],
      mustContainAny: [
        "SKILLSYSTEM:STRUCTURE:v1",
        "# SkillSystem — Structure",
        "allowed **ONLY** under",
      ],
    },
    {
      name: "Budget lines + examples exclusion",
      message:
        "Using only the attached file, answer: in the procedural SKILL.md budget rule, does the ## Examples section count toward the 80 budget lines? Cite either the canary comment (preferred) or the exact heading you used.",
      files: [
        `${RUNTIME_ROOT}/skills/PAI/SYSTEM/SkillSystem/Validation.md`,
      ],
      mustContainAll: ["## Examples", "80"],
      mustContainAny: [
        "SKILLSYSTEM:VALIDATION:v1",
        "# SkillSystem — Validation",
        "does not count",
        "do not count",
        "excluded",
      ],
    },
    {
      name: "Writing workflows Verify optional",
      message:
        "Using only the attached file, answer: for pure writing/creative workflows, is a ## Verify section required? Cite either the canary comment (preferred) or the exact heading you used.",
      files: [
        `${RUNTIME_ROOT}/skills/PAI/SYSTEM/SkillSystem/Workflows.md`,
      ],
      mustContainAll: ["pure writing/creative workflows", "Verify"],
      mustContainAny: [
        "SKILLSYSTEM:WORKFLOWS:v1",
        "# SkillSystem — Workflows",
        "optional",
      ],
    },
  ];
}

async function behavioralChecks(
  findings: Finding[],
  opts: {
    agent: string;
    model: string;
    printLogs: boolean;
    dryRun: boolean;
  }
) {
  // Validate opencode exists.
  const which = await runCmd(["bash", "-lc", "command -v opencode"], opts);
  if (which.code !== 0) {
    push(findings, {
      severity: "error",
      code: "OPENCODE_NOT_FOUND",
      message: "opencode is not available on PATH",
      details: { stderr: which.stderr },
    });
    return;
  }

  for (const c of behaviorCases()) {
    const title = `SmokeTest SkillSystem: ${c.name}`;
    const cmd: string[] = [
      "opencode",
      "run",
      "--format",
      "json",
      "--title",
      title,
    ];
    if (opts.agent?.trim()) cmd.push("--agent", opts.agent.trim());
    if (opts.model?.trim()) cmd.push("--model", opts.model.trim());
    if (opts.printLogs) cmd.push("--print-logs");

    for (const f of c.files) {
      cmd.push("--file", f);
    }

    // Separator is required so the message isn't parsed as another --file entry.
    cmd.push("--", c.message);

    const res = await runCmd(cmd, opts);
    const hay = `${res.stdout}\n${res.stderr}`;

    if (res.code !== 0) {
      push(findings, {
        severity: "error",
        code: "OPENCODE_RUN_FAILED",
        message: `Behavior test failed to run: ${c.name}`,
        details: { exitCode: res.code, stderr: res.stderr, stdout: res.stdout },
      });
      continue;
    }

    const missingAll = c.mustContainAll.filter((needle) => !hay.includes(needle));
    const anyOk =
      !c.mustContainAny || c.mustContainAny.some((needle) => hay.includes(needle));

    if (missingAll.length || !anyOk) {
      const excerpt = hay.slice(0, 4000);
      push(findings, {
        severity: "error",
        code: "BEHAVIOR_EXPECTATION_MISSING",
        message: `Missing expected marker(s) in output for: ${c.name}`,
        details: {
          missingAll,
          mustContainAny: c.mustContainAny,
          anyMatched: c.mustContainAny?.filter((x) => hay.includes(x)) ?? [],
          excerpt,
        },
      });
    }
  }
}

function toReport(findings: Finding[], meta: Report["meta"]): Report {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta,
  };
}

function renderText(report: Report): string {
  const lines: string[] = [];
  lines.push(`SmokeTestSkillSystem: ${report.ok ? "OK" : "FAIL"}`);
  lines.push(`Mode: ${report.meta.mode}`);
  if (report.meta.model) lines.push(`Model: ${report.meta.model}`);
  if (report.meta.agent) lines.push(`Agent: ${report.meta.agent}`);
  lines.push(`Ran at: ${report.meta.ranAt}`);

  if (report.errors.length) {
    lines.push("");
    lines.push(`Errors (${report.errors.length}):`);
    for (const e of report.errors) {
      lines.push(`- [${e.code}] ${e.message}`);
    }
  }
  if (report.warnings.length) {
    lines.push("");
    lines.push(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) {
      lines.push(`- [${w.code}] ${w.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const findings: Finding[] = [];

  if (args.mode === "static" || args.mode === "both") {
    await staticChecks(findings, { dryRun: args.dryRun });
  }

  if (args.mode === "behavior" || args.mode === "both") {
    await behavioralChecks(findings, {
      agent: args.agent,
      model: args.model,
      printLogs: args.printLogs,
      dryRun: args.dryRun,
    });
  }

  const report = toReport(findings, {
    mode: args.mode,
    model: args.mode === "static" ? undefined : args.model,
    agent: args.mode === "static" ? undefined : args.agent,
    ranAt: nowIso(),
  });

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderText(report));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`SmokeTestSkillSystem tool error: ${msg}\n`);
  process.exitCode = 2;
});
