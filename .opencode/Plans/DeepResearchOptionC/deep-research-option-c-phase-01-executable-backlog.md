# Phase 01 Executable Backlog — Platform Core Scaffolding

## Objective
Implement the minimum “platform substrate” for Option C in the **integration layer** (no OpenCode core changes):
- deterministic run directory + run ledger
- manifest/gates IO utilities
- global install wiring

## Gate
- Phase 01 must be complete before Phase 02 begins.

## Backlog (Owner/Reviewer mapped)
| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P01-01 | Decide final install layout in repo for global deploy | Architect | Engineer | Gate A | `spec-install-layout-v1.md` | Paths match OpenCode docs for commands/tools |
| P01-02 | Implement run directory creator (run-id + folder skeleton) | Engineer | Architect | P01-01 | `spec-tool-deep-research-run-init-v1.md` | Creates full tree + returns root path |
| P01-03 | Implement manifest read/write helper (atomic write + revision bump) | Engineer | Architect | P01-02 + spec-manifest | `spec-tool-deep-research-manifest-write-v1.md` | Revision increments; write is atomic |
| P01-04 | Implement gates read/write helper | Engineer | Architect | P01-02 + spec-gates | `spec-tool-deep-research-gates-write-v1.md` | Hard-gate status rules enforced |
| P01-05 | Implement schema validation hook (validate manifest/gates on write) | Engineer | QATester | P01-03,P01-04 | `spec-schema-validation-v1.md` | Invalid example rejected per schema-examples |
| P01-06 | Implement feature-flag config surface in integration layer | Engineer | Architect | P01-01 | `spec-feature-flags-v1.md` | Flags cover enable/disable + caps |
| P01-07 | Implement session progress updater (todos/status) via `todowrite` (server abort optional) | Engineer | QATester | P01-02 | `spec-session-progress-v1.md` | Demonstrates updating session todos for DR stages |
| P01-X1 | Phase 01 checkpoint + signoff | Architect | QATester | all P01-* | `PHASE-01-CHECKPOINT.md` | Reviewer PASS + Phase 02 unblocked |

## Notes
- “tool:*” deliverables will be implemented as OpenCode custom tools under global install (`~/.config/opencode/tools/`).
- If any task implies OpenCode core edits, it must be redesigned.
