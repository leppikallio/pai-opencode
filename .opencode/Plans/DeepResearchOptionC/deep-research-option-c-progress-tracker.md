# Option C Progress Tracker (Pause/Resume Source of Truth)

## Program Metadata
- Program: OpenCode Deep Research Option C
- Planned window: 12–16 weeks
- Status: `in_progress`
- Last updated: `2026-02-13`
- Current phase: `Phase 01`

## Plan root directory (canonical)
All program plans and specs live here:
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC`

## READ FIRST (PM / Orchestrator)
If you are running this program and don’t have prior context:
1) Read **this file**.
2) Then read `deep-research-option-c-recovery-pack.md`.
3) Then open the current phase executable backlog (Phase 01: `deep-research-option-c-phase-01-executable-backlog.md`).

Session loss / compaction safe recovery:
- `deep-research-option-c-recovery-pack.md`

## Status Legend
- `pending` — not started
- `in_progress` — currently active
- `review` — awaiting reviewer gate
- `blocked` — blocked by dependency/risk
- `done` — accepted and closed

## Phase Status Board
| Phase | Name | Owner | Status | Reviewer | Gate | Notes |
|---|---|---|---|---|---|---|
| 00 | Governance & contracts | Architect | done | Engineer | Gate A | Signed off: `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md` |
| 01 | Platform core scaffolding | Engineer | done | Architect | Gate A | Signed off: `PHASE-01-CHECKPOINT-GATE-A-SIGNOFF.md` |
| 02 | Orchestrator engine | Engineer | pending | QATester | Gate B | Scheduler + retries |
| 03 | Agent contracts & wave graph | Engineer | pending | Architect | Gate B | Fan-out/fan-in |
| 04 | Citation validation services | Engineer | pending | QATester | Gate C | Canonical pool |
| 05 | Synthesis/reviewer factory | Engineer | pending | Architect | Gate D/E | Writer-review loop |
| 06 | Observability + quality automation | Engineer | pending | QATester | Gate E | Metrics + harness |
| 07 | Rollout hardening & canary | Engineer | pending | Architect | Gate F | Flags + fallback |

## Workstream Tracker
| Stream | Scope | Status | Active tasks |
|---|---|---|---|
| G | Governance/contracts (Phase 00) | done | 0 |
| A | Core platform/state | done | Phase 01 complete; Phase 02 unblocked |
| B | Orchestration/runtime | pending | 0 |
| C | Agents/contracts | pending | 0 |
| D | Citation/evidence | pending | 0 |
| E | Synthesis/review | pending | 0 |
| F | QA/observability | pending | 0 |

## Phase 00 completion evidence
- `PHASE-00-CHECKPOINT-ARCH-REVIEW.md`
- `PHASE-00-CHECKPOINT-QA-REVIEW.md`
- `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md`

## Critical Risks
1. Context budget regression from oversized summary packs.
2. Reviewer loops stalling due to unclear acceptance rubric.
3. Tool permission drift causing non-deterministic behavior.

## Next 3 Actions
1. Start Phase 01 Wave 1 tasks from `deep-research-option-c-phase-01-executable-backlog.md`.
2. After Phase 01 checkpoint, start Phase 02 (stage engine) tasks.
3. Keep Phase 02 blocked until Phase 01 manifest/gates IO tools are implemented.

## Pause/Resume Protocol
Before pausing, update:
- current phase and status board rows,
- active tasks + blockers,
- next action + owner,
- latest checkpoint reference.

On resume, read this file first, then read current phase file.

## Recovery Bootstrap
- Session-loss bootstrap doc:
  - `deep-research-option-c-recovery-pack.md`
- Canonical reference index:
  - `deep-research-option-c-reference-index.md`
- Implementation approach:
  - `deep-research-option-c-implementation-approach.md`
