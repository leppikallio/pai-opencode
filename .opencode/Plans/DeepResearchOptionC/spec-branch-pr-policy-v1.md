# spec-branch-pr-policy-v1 (P00-C01)

## Purpose
Defines how we make parallel progress safely (branches, PR checks, reviewer gates).

## Repos
- Implementation repo (where changes land):
  - `/Users/zuul/Projects/pai-opencode-graphviz`
- OpenCode core repo is read-only for this program:
  - `/Users/zuul/Projects/opencode`

## Branch strategy
### Long-lived branches
- `main` (stable)
- `deep-research/option-c` (integration branch, optional)

### Work branches
Format:
- `dr/<phase>/<task-id>-<short-slug>`

Examples:
- `dr/p01/P01-A01-run-ledger`
- `dr/p02/P02-B03-timeouts`

## PR requirements
Every PR must include:
- linked backlog task ID
- acceptance criteria checklist
- evidence section (tests run or why not applicable)

## Required checks (minimum)
- typecheck/build (repo-specific)
- unit tests (where present)
- lint/format

## Reviewer model
- Every PR has at least one reviewer (Architect or QATester depending on workstream).
- High-risk changes require two reviewers.

## Evidence
This file defines naming, PR requirements, and reviewer model.
