# Epic E2 — Operator CLI ergonomics

## Why
Engineer raw-2: absolute-path heavy UX is cognitively expensive; operators rerun too much; triage should be automatic.

## Outcomes
Make the operator CLI “resume-first”:
- Accept `--run-id` or `--run-root` for all commands and resolve manifest/gates paths.
- Add `run --until <stage|finalize>`.
- Add `cancel` command (checkpoint + `manifest.status=cancelled`).
- Reduce required flags: allow `--manifest` only and derive gates path from manifest.
- When blocked, print compact triage immediately (don’t require separate command).

## Deliverables
- Common flag group: `--run-id` | `--run-root` with safe resolution.
- `run --until ...`.
- `cancel`.
- `inspect` enriched to surface:
  - citations blocked URLs + next-step hints (if present)
  - retry directives path (if present)
  - “latest” online fixtures pointer (if present)

## Tests / Verification
- Entity tests for run-id resolution.
- Maintain stable `--help` contract.

## Validator gates
- Architect PASS, QA PASS.
