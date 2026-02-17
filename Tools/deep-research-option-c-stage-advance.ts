#!/usr/bin/env bun

import * as path from "node:path";

import { stage_advance } from "../.opencode/tools/deep_research/stage_advance";

type CliArgs = {
  help: boolean;
  manifest?: string;
  gates?: string;
  next?: string;
  reason?: string;
};

function usage(): string {
  return [
    "Option C stage-advance wrapper",
    "",
    "Usage:",
    "  bun Tools/deep-research-option-c-stage-advance.ts --manifest <abs> --gates <abs> --next <stage> --reason \"...\"",
    "  bun Tools/deep-research-option-c-stage-advance.ts --manifest <abs> --gates <abs> --reason \"...\"",
    "  bun Tools/deep-research-option-c-stage-advance.ts --help",
    "",
    "Flags:",
    "  --manifest  Absolute path to manifest.json (required)",
    "  --gates     Absolute path to gates.json (required)",
    "  --next      Requested next stage (optional)",
    "  --reason    Audit reason (required)",
    "  --help      Show this help message",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--manifest") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--manifest requires a value");
      out.manifest = value;
      i += 1;
      continue;
    }
    if (arg === "--gates") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--gates requires a value");
      out.gates = value;
      i += 1;
      continue;
    }
    if (arg === "--next") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--next requires a value");
      out.next = value;
      i += 1;
      continue;
    }
    if (arg === "--reason") {
      const value = argv[i + 1]?.trim();
      if (!value) throw new Error("--reason requires a value");
      out.reason = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

function parseOk(raw: unknown): boolean {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { ok?: unknown };
      return parsed.ok === true;
    } catch {
      return false;
    }
  }

  if (raw && typeof raw === "object") {
    const maybe = raw as { ok?: unknown };
    return maybe.ok === true;
  }

  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.manifest || !path.isAbsolute(args.manifest)) {
    throw new Error("--manifest must be an absolute path");
  }
  if (!args.gates || !path.isAbsolute(args.gates)) {
    throw new Error("--gates must be an absolute path");
  }
  if (!args.reason) {
    throw new Error("--reason is required");
  }

  const raw = await stage_advance.execute({
    manifest_path: args.manifest,
    gates_path: args.gates,
    requested_next: args.next,
    reason: args.reason,
  });

  if (typeof raw === "string") {
    console.log(raw);
  } else {
    console.log(JSON.stringify(raw));
  }

  process.exit(parseOk(raw) ? 0 : 1);
}

await main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage());
  process.exit(1);
});
