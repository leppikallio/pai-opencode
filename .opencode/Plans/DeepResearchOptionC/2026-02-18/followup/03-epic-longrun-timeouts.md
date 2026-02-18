# Epic E3 — 1h+ long-run timeout semantics

## Why
Architect raw-2: default watchdog timeouts (5–10 minutes) will fail legitimate long live stages unless paused.

## Outcomes
Support long runs safely without accidental watchdog failure:
- Mode-based timeouts (deep mode => longer), or
- Progress-heartbeat semantics (timeout since last progress, not stage start).

## Deliverables
- Policy + implementation:
  - how timeouts are computed
  - what counts as progress
  - how orchestrators emit progress heartbeats
- Update watchdog behavior accordingly.

## Tests / Verification
- Entity test: does not time out if heartbeat advances.
- Entity test: times out deterministically if no progress.

## Validator gates
- Architect PASS, QA PASS.
