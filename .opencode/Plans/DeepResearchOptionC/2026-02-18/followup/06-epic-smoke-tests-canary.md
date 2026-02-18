# Epic E6 — Executable M2/M3 canaries + runbooks

## Why
Engineer raw-2: live smoke tests are placeholders; architect raw-2 provides a readiness rubric.

## Outcomes
Turn M2/M3 into executable, repeatable canaries with clear runbooks.

## Deliverables
- Update smoke tests so they can create a run root and execute stage boundaries.
  - Keep network + real Task spawning gated/skipped by default to keep CI deterministic.
- Add runbooks:
  - M2: live wave1 to pivot
  - M3: live finalize + fixture capture

## Acceptance criteria
- M2/M3 can be run manually with one command each, producing auditable artifacts.

## Validator gates
- Architect PASS, QA PASS.
