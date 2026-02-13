# Phase 05 — Synthesis & Reviewer Factory (Weeks 8–10)

## Objective
Build bounded synthesis pipeline with automated reviewer loops and explicit quality scoring.

## Dependencies
- Phase 04 citation gate operational.

## Workstreams (parallel)
### WS-05A: Summary pack generators
- Parallel summarizers over validated evidence artifacts.
- Enforce strict size caps to prevent context growth.

### WS-05B: Synthesis writer
- Generate draft from summary pack + validated citation pool only.
- Support report templates (executive/analytical).

### WS-05C: Reviewer factory
- Run reviewer agents in parallel on:
  - structure compliance,
  - citation utilization,
  - uncited claims,
  - coverage gaps.

### WS-05D: Revision controller
- Merge reviewer feedback into bounded revision loop (max iterations).
- Escalate to operator if unresolved.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: Architect

## Acceptance Criteria
- Synthesis never ingests raw wave dumps directly.
- Reviewer pipeline returns deterministic pass/fail decision.
- Revision loop converges or escalates with explicit reasons.

## Deliverables
- Summary pack schema
- Reviewer rubric definitions
- Revision loop policy

## Gates
- **Gate D:** summary pack bounded and complete
- **Gate E:** synthesis quality thresholds met
