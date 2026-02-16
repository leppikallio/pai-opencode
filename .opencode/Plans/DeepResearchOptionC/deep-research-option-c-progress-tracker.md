# Option C Progress Tracker (Pause/Resume Source of Truth)

## Program Metadata
- Program: OpenCode Deep Research Option C
- Planned window: 12–16 weeks
- Status: `in_progress`
- Last updated: `2026-02-16`
- Current phase: `Phase 07` (Gate F signed off)

## Plan root directory (canonical)
All program plans and specs live here:
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC`

## READ FIRST (PM / Orchestrator)
If you are running this program and don’t have prior context:
1) Read **this file**.
2) Then read `deep-research-option-c-recovery-pack.md`.
3) Then open the current phase executable backlog doc (Phase 06: `deep-research-option-c-phase-06-executable-backlog.md`).

Optional context:
- Phase 04 outline: `deep-research-option-c-phase-04-citation-system.md`

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
| 02 | Orchestrator engine | Engineer | done | QATester | Gate B | Signed off: `PHASE-02-CHECKPOINT-GATE-B.md` + `PHASE-02-CHECKPOINT-QA-REVIEW.md` |
| 03 | Agent contracts & wave graph | Engineer | done | Architect | Gate B | Signed off: `PHASE-03-CHECKPOINT-GATE-B.md` |
| 04 | Citation validation services | Engineer | done | QATester | Gate C | Signed off: `PHASE-04-CHECKPOINT-GATE-C.md` |
| 05 | Synthesis/reviewer factory | Engineer | done | Architect | Gate D/E | Signed off: `PHASE-05-CHECKPOINT-GATE-D-E.md` |
| 06 | Observability + quality automation | Engineer | done | QATester | Gate E | Signed off: `PHASE-06-CHECKPOINT-GATE-E.md` |
| 07 | Rollout hardening & canary | Engineer | done | Architect | Gate F | Signed off: `PHASE-07-CHECKPOINT-GATE-F.md` + `PHASE-07-CHECKPOINT-GATE-F-SIGNOFF.md` |

## Workstream Tracker
| Stream | Scope | Status | Active tasks |
|---|---|---|---|
| G | Governance/contracts (Phase 00) | done | 0 |
| A | Core platform/state | done | Phase 01 complete; Phase 02 unblocked |
| B | Orchestration/runtime | done | Phase 02 stage engine complete |
| C | Agents/contracts | done | Phase 03 Gate B passed |
| D | Citation/evidence | done | Phase 04 Gate C passed |
| E | Synthesis/review | done | 0 |
| F | QA/observability | done | 0 |

## Phase 00 completion evidence
- `PHASE-00-CHECKPOINT-ARCH-REVIEW.md`
- `PHASE-00-CHECKPOINT-QA-REVIEW.md`
- `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md`

## Critical Risks
1. Context budget regression from oversized summary packs.
2. Reviewer loops stalling due to unclear acceptance rubric.
3. Tool permission drift causing non-deterministic behavior.

## Phase 07 Notes (in progress)
- Wave 0 docs exist.
- P07-05 fallback_offer tool+test exists.
- Drills log exists.

## Next 3 Actions
1. Complete P07-02 feature-flag orchestration surface and verify `deep_research_feature_flags.contract.test.ts` (OFFLINE `PAI_DR_NO_WEB=1`).
2. Close P07-03/P07-04 canary constraints + emergency disable/rollback routing, then align rollout playbook/runbook knobs to spec.
3. Finish P07-06 watchdog timeout wiring/checkpoint artifact and fold existing P07-05 + drills-log evidence into Gate F checkpoint assembly.

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
