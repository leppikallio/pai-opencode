# Phase 03 — Agent Contracts and Wave Graph (Weeks 4–6)

## Objective
Operationalize parallel research waves with strict scoped contracts and reviewer checks.

## Dependencies
- Phase 02 stage scheduler operational.

## Workstreams (parallel)
### WS-03A: Router and perspective allocator
- Implement perspective generation contract.
- Assign existing runtime researcher agents by perspective type.

### WS-03B: Wave 1 fan-out execution
- Parallel launch policy with cap controls.
- Contract enforcement for outputs (schema + size + source section).

### WS-03C: Pivot and Wave 2 planner
- Gap detection contract.
- Conditional specialist wave generation with delta-only scope.

### WS-03D: Builder-validator pairing for agent outputs
- Reviewer checks each agent output for schema compliance and source hygiene.
- Fail/retry routes driven by reviewer result.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: Architect

## Acceptance Criteria
- Wave fan-out and fan-in run with deterministic caps.
- Every output passes a reviewer contract or enters controlled retry.
- Pivot decision is explainable and stored.

## Deliverables
- Agent prompt contract pack
- Wave graph policy doc
- Pivot rubric doc

## Gate
- **Gate B:** wave contract compliance and pivot integrity.
