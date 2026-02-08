# ValidateSkillSystemDocs

Lightweight automated validator for the **SkillSystem split docs**.

This is intentionally separate from the installer’s `ScanBrokenRefs` pass. It focuses on:

- Router table integrity
- Section doc invariants (backlinks + canaries)
- Detecting SkillSearch *usage* patterns that would encourage “pretend loading”

## What it validates

### 1) Router completeness

`SkillSystem.md` must contain a routing table entry for every section doc found in:

- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem/*.md`

### 2) Section doc invariants

Each section doc must contain (in the first ~20 lines):

- `> Up (runtime): \`/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md\``
- `> Source (repo): \`/Users/zuul/Projects/pai-opencode/.opencode/...\``
- `> Scope: ...`

And must contain its canary comment matching the router table, e.g.:

- `<!-- SKILLSYSTEM:STRUCTURE:v1 -->`

### 3) SkillSearch usage prohibition

Section docs must not instruct SkillSearch as a required workflow step.

This validator flags function-like usage:

- `SkillSearch(`

Mentions in prose (e.g., describing an anti-pattern) are allowed.

Preferred discovery pattern:

1) `Read` the exact absolute runtime path
2) If unknown: `glob`, then `Read`

## Where it lives

Repo:
- `/Users/zuul/Projects/pai-opencode/.opencode/skills/system/Tools/ValidateSkillSystemDocs.ts`

Runtime (after install):
- `/Users/zuul/.config/opencode/skills/system/Tools/ValidateSkillSystemDocs.ts`

## How to run

Validate runtime docs (default paths):

```bash
bun "/Users/zuul/.config/opencode/skills/system/Tools/ValidateSkillSystemDocs.ts"
```

JSON output:

```bash
bun "/Users/zuul/.config/opencode/skills/system/Tools/ValidateSkillSystemDocs.ts" --format json
```

Override paths (useful for custom setups):

```bash
bun "/Users/zuul/.config/opencode/skills/system/Tools/ValidateSkillSystemDocs.ts" \
  --index "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md" \
  --sections-dir "/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem" \
  --format text
```

## Exit codes

- `0`: all checks passed
- `1`: validation failures found
- `2`: tool error (bad args / IO / parse)
