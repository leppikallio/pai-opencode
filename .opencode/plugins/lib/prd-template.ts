interface PRDOptions {
  title: string;
  slug: string;
  effortLevel?: string;
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

function isoDayUtc(now: Date): string {
  const { y, m, d } = ymdUtc(now);
  return `${y}-${m}-${d}`;
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
  const today = isoDayUtc(now);
  const id = generatePRDId(opts.slug, now);
  const effort = opts.effortLevel || "Standard";
  const mode = opts.mode || "interactive";
  const promptSection = opts.prompt
    ? `### Problem Space\n${opts.prompt.substring(0, 500)}\n`
    : "### Problem Space\n_To be populated during OBSERVE phase._\n";

  return `---
prd: true
id: ${id}
status: DRAFT
mode: ${mode}
effort_level: ${effort}
created: ${today}
updated: ${today}
iteration: 0
maxIterations: 128
loopStatus: null
last_phase: null
failing_criteria: []
verification_summary: "0/0"
parent: null
children: []
---

# ${opts.title}

> _To be populated: what this achieves and why it matters._

## STATUS

| What | State |
|------|-------|
| Progress | 0/0 criteria passing |
| Phase | DRAFT |
| Next action | OBSERVE phase - create ISC |
| Blocked by | nothing |

## CONTEXT

${promptSection}
### Key Files
_To be populated during exploration._

### Constraints
_To be populated during OBSERVE/PLAN._

### Decisions Made
_None yet._

## PLAN

_To be populated during PLAN phase._

## IDEAL STATE CRITERIA (Verification Criteria)

_Criteria will be added during OBSERVE phase via TaskCreate._
_Format: ISC-C{N}: {8-12 word state criterion} | Verify: {method}_

## DECISIONS

_Non-obvious technical decisions logged here during BUILD/EXECUTE._

## LOG

_Session entries appended during LEARN phase._
`;
}
