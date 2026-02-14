# Phase 02 Executable Backlog — Orchestrator Engine

## Objective
Create the programmatic stage machine that runs Option C deterministically using:
- custom tools for deterministic operations
- existing researcher agents for research/synthesis
- hard gates (A–F) that block progression

## Gate
- Gate B (reliability + deterministic transitions)

## Backlog (Owner/Reviewer mapped)
| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P02-01 | Define stage machine spec (states, transitions, terminal states) | Architect | Engineer | Gate A + Phase 01 | `spec-stage-machine-v1.md` | Includes transition table + invariants |
| P02-02 | Implement stage scheduler tool (advance stage; writes manifest/gates) | Engineer | QATester | P02-01 | `spec-tool-deep-research-stage-advance-v1.md` | Same inputs produce same next stage |
| P02-T1 | Add entity tests + fixture replay harness (Phase 01 tools + stage_advance) | Engineer | QATester | P02-02 | `deep-research-option-c-testing-strategy-v1.md` + tests | `bun test` can run each entity in isolation |
| P02-03 | Implement retry controller (bounded retries per spec-gate-escalation) | Engineer | Architect | P02-02 | `spec-retry-policy-v1.md` | Retry caps match spec-gate-escalation |
| P02-04 | Implement timeout/watchdog (no silent hang) | Engineer | QATester | P02-02 | `spec-watchdog-v1.md` | Demonstrates forced terminal fail on timeout |
| P02-05 | Implement dry-run mode (no web; uses fixtures) | Engineer | QATester | P02-02 | `spec-dry-run-v1.md` | Replays run from fixture artifacts |
| P02-06 | Phase 02 checkpoint + Gate B signoff | Architect | QATester | all P02-* | `PHASE-02-CHECKPOINT-GATE-B.md` | Reviewer PASS + Phase 03 unblocked |

## Notes
- This phase still makes **no changes** to OpenCode core; it is tools+commands.
- Phase 02 must not start before Phase 01 has manifest/gates IO working.
