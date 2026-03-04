interface PRDOptions {
  task: string;
  slug: string;
  effort?: "standard" | "extended" | "advanced";
  mode?: "interactive" | "loop";
  prompt?: string;
  now?: Date;
}

function ymdUtc(now: Date): { y: string; m: string; d: string } {
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return { y, m, d };
}

export function generatePRDFilename(slug: string, now: Date = new Date()): string {
  const { y, m, d } = ymdUtc(now);
  return `PRD-${y}${m}${d}-${slug}.md`;
}

export function generatePRDId(slug: string, now: Date = new Date()): string {
  const { y, m, d } = ymdUtc(now);
  return `PRD-${y}${m}${d}-${slug}`;
}

export function generatePRDTemplate(opts: PRDOptions): string {
  const now = opts.now ?? new Date();
  const isoNow = now.toISOString();
  const effort = opts.effort || "standard";
  const mode = opts.mode || "interactive";
  const promptSection = opts.prompt ? opts.prompt.substring(0, 500) : "_To be populated during OBSERVE phase._";

  return `---
task: ${JSON.stringify(opts.task)}
slug: ${opts.slug}
effort: ${effort}
phase: observe
progress: 0/0
mode: ${mode}
started: ${isoNow}
updated: ${isoNow}
---

## Context

### Problem Space
${promptSection}

### Key Files
_To be populated during exploration._

### Constraints
_To be populated during OBSERVE and PLAN._

## Criteria

_To be populated during OBSERVE phase._

## Decisions

_Non-obvious decisions logged during BUILD and EXECUTE._

## Verification

_Evidence recorded during VERIFY phase._
`;
}
