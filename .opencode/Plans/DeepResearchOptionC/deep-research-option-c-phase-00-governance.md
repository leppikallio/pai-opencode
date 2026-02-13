# Phase 00 — Governance, Contracts, and Baselines (Week 1)

## Objective
Lock standards that all later parallel streams must follow.

## Inputs
- Archived roadmap and architecture docs
- Existing OpenCode + PAI runtime constraints
- Executable backlog: `deep-research-option-c-phase-00-executable-backlog.md`

## Workstreams (parallel)
### WS-00A: Contract definitions
- Define canonical schemas:
  - `manifest.json`
  - `gates.json`
  - `perspectives.json`
  - `citations.jsonl`
  - `summary-pack.json`

### WS-00B: Quality gate definitions
- Define Gate A–F thresholds and hard/soft semantics.
- Define reviewer rubrics for each gate.

### WS-00C: Delivery governance
- Define branch strategy, checkpoint cadence, rollback policy.
- Define pause/resume procedure for all phases.

## Reviewer Pairing
- Builder: Architect
- Reviewer: Engineer

## Acceptance Criteria
- Schemas finalized and versioned (`v1`).
- All gate thresholds documented with pass/fail examples.
- Tracker file references this phase as complete.

## Deliverables
- Schema spec markdown
- Gate rubric markdown
- Program governance markdown

## Execution Start Order
1. Start Wave 1 tasks in backlog (`P00-A01`, `P00-B01`, `P00-C02`).
2. Run Builder/Reviewer pairing exactly as backlog protocol defines.
3. Record daily updates in `deep-research-option-c-progress-tracker.md`.

## Checkpoint Template
```markdown
Phase: 00
Completed: []
In flight: []
Blocked: []
Next action: 
Owner: 
```
