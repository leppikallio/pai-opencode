# Phase 06 — Observability & Automated Quality Harness (Weeks 10–12)

## Objective
Instrument the platform and automate quality verification across real and simulated runs.

## Dependencies
- Phase 05 synthesis/reviewer loop complete.

## Workstreams (parallel)
### WS-06A: Run telemetry
- Emit stage-level events, durations, retries, failures.
- Produce run-level metrics summary.

### WS-06B: Quality harness (simulation)
- Build offline fixture harness for wave/citation/synthesis validation.
- Validate gates without external network dependency.

### WS-06C: Regression suite
- Create benchmark prompts and expected thresholds.
- Add automated pass/fail checks for:
  - citation validity,
  - utilization,
  - coverage,
  - latency envelopes.

### WS-06D: Reviewer quality audits
- Reviewer subagents audit prior runs and flag drift patterns.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: QATester

## Acceptance Criteria
- Every run emits enough telemetry for replay diagnosis.
- Harness catches context-budget and citation regressions.
- Gate outcomes are measurable and reproducible.

## Deliverables
- Metrics dictionary
- Simulation harness spec
- Regression prompt suite definition

## Gate
- **Gate E:** observability and automated quality checks stable.
