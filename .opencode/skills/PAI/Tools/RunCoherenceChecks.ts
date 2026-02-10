#!/usr/bin/env bun

import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

type Options = {
  root: string;
  mode: "runtime" | "source";
};

function usage(exitCode = 0): never {
  console.log(`RunCoherenceChecks

Usage:
  bun ~/.config/opencode/skills/PAI/Tools/RunCoherenceChecks.ts [--root <PAI root>] [--mode runtime|source]

Defaults:
  --root   $PAI_DIR or ~/.config/opencode
  --mode   runtime

Checks executed:
  1) CheckTerminologyDrift (PAI-specific naming drift)
  2) ScanBrokenRefs (PAI scope)
  3) ValidateSkillSystemDocs (runtime mode only)
`);
  process.exit(exitCode);
}

function defaultRoot(): string {
  const env = process.env.PAI_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), ".config", "opencode");
}

function parseArgs(argv: string[]): Options {
  let root = defaultRoot();
  let mode: "runtime" | "source" = "runtime";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --root");
      root = value;
      i++;
      continue;
    }
    if (arg === "--mode") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --mode");
      if (value !== "runtime" && value !== "source") {
        throw new Error(`Invalid --mode value: ${value}`);
      }
      mode = value;
      i++;
      continue;
    }
    throw new Error(`Unknown arg: ${arg}`);
  }

  return { root, mode };
}

function runStep(name: string, command: string) {
  console.log(`\n[coherence] ${name}`);
  console.log(`[coherence] cmd: ${command}`);
  execSync(command, { stdio: "inherit" });
}

function runScanBrokenRefsStep(args: { refsTool: string; root: string; scope: string }) {
  const command = `bun "${args.refsTool}" --allow-standalone --format json --root "${args.root}" --scope "${args.scope}"`;
  console.log("\n[coherence] broken refs (PAI scope)");
  console.log(`[coherence] cmd: ${command}`);

  const out = execSync(command, { encoding: "utf8" });
  const parsed = JSON.parse(out) as { count?: number };
  const count = typeof parsed.count === "number" ? parsed.count : 0;

  if (count > 0) {
    console.error(`ScanBrokenRefs: ${count} missing reference(s)`);
    throw new Error("broken references detected");
  }

  console.log("ScanBrokenRefs: 0 missing reference(s)");
}

function main() {
  try {
    const { root, mode } = parseArgs(process.argv.slice(2));
    const skillsRoot = path.join(root, "skills");
    const paiRoot = path.join(skillsRoot, "PAI");

    const terminologyTool = path.join(paiRoot, "Tools", "CheckTerminologyDrift.ts");
    const refsTool = path.join(skillsRoot, "system", "Tools", "ScanBrokenRefs.ts");
    const validateTool = path.join(skillsRoot, "system", "Tools", "ValidateSkillSystemDocs.ts");

    runStep("terminology drift", `bun "${terminologyTool}"`);
    runScanBrokenRefsStep({ refsTool, root, scope: path.join(paiRoot) });
    if (mode === "runtime") {
      runStep("SkillSystem docs", `bun "${validateTool}"`);
    } else {
      console.log("\n[coherence] SkillSystem docs");
      console.log(
        "[coherence] skipped in source mode (ValidateSkillSystemDocs is runtime-anchored to ~/.config/opencode paths)"
      );
    }

    console.log("\nRunCoherenceChecks: OK");
  } catch (err) {
    console.error(`\nRunCoherenceChecks: FAIL\n${String(err)}`);
    process.exit(1);
  }
}

main();
