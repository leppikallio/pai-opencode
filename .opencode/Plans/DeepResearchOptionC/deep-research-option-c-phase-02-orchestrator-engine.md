# Phase 02 — Orchestrator Engine (Weeks 3–5)

## PM / Orchestrator note
- For recovery/pause/resume, follow: `deep-research-option-c-recovery-pack.md`
- Do not violate Option C invariants in: `deep-research-option-c-master-plan.md`
- Execution backlog for this phase lives in: `deep-research-option-c-phase-02-executable-backlog.md`

## Objective
Implement a programmatic stage machine with deterministic transitions, retries, and timeouts.

**Constraint:** no changes to OpenCode core; the stage machine runs in the integration layer (tool/orchestrator) and uses OpenCode server APIs.

## Dependencies
- Phase 01 core scaffolding complete.

## Workstreams (parallel)
### WS-02A: Stage scheduler
- Implement stage graph:
  - init -> wave1 -> pivot -> wave2? -> citation -> summarize -> synthesis -> review
- Implement dependency-aware transitions.

### WS-02B: Retry/failure controller
- Add stage-level retry policy.
- Add bounded retries with explicit failure reasons.

### WS-02C: Timebox/watchdog
- Per-stage timeout controls.
- Hung-task detection and escalation paths.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: QATester

## Acceptance Criteria
- Engine can execute a dry-run graph deterministically.
- Failures move to explicit terminal state with diagnostics.
- No silent hang beyond configured timeout.

## Deliverables
- Stage-machine design doc
- Failure taxonomy doc
- Timeout and watchdog policy doc

## Gate
- **Gate B:** stage engine reliability + deterministic state transitions.
