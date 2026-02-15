# pai-swamp-adapter (MVP)

This is an **adapter-only** bridge for using **Swamp** repos with **PAI/OpenCode**, without modifying Swamp or OpenCode.

## When to run

Run after Swamp initializes a repo:

1. `swamp repo init`
2. `bun Tools/pai-swamp-adapter.ts sync --repo .`

## What it generates/updates

In the target repo:

- `.opencode/opencode.jsonc` (dev/interactive default)
- `.opencode/opencode.ci.jsonc` (CI/unattended profile)
- `AGENTS.md` overlay section (does **not** edit `CLAUDE.md`)
- `.opencode/skills/<skill>/SKILL.md` (PAI addendum overrides for Swamp skills)
- `.opencode/pai-swamp-adapter/state.json` (hash gate state)
- `.opencode/pai-swamp-adapter/overlays/<skill>/addendum.md` (editable per-skill overlay)

It also ensures `.gitignore` includes `.swamp/secrets/**` and fails if those files are tracked.

## Trust gating / approvals

If upstream Swamp-generated content changes:
- `CLAUDE.md`
- `.claude/skills/**/SKILL.md`

the tool requires approval before continuing.

Flags:
- `--approve` auto-approves gates
- `--non-interactive` fails closed instead of prompting
- `--show-diff` prints unified diffs when gating triggers

## CI usage (important)

OpenCode loads `.opencode/opencode.jsonc` by default.

To use the CI profile, set:

```bash
export OPENCODE_CONFIG=.opencode/opencode.ci.jsonc
```

Then run:

```bash
bun Tools/pai-swamp-adapter.ts sync --repo . --non-interactive --show-diff
```

## Help

```bash
bun Tools/pai-swamp-adapter.ts --help
```
