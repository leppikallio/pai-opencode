# WS6 — Long-run ops: lock/lease, pause/resume, watchdog, telemetry

## Objective

Make 1h+ runs safe and operable:

- run-root lock/lease prevents concurrent ticks
- pause/resume is first-class and integrates with watchdog
- watchdog is enforced at tick boundaries
- telemetry heartbeats + metrics rollups support progress visibility and postmortems

## Scope

- Implement lockfile/lease semantics (run root).
- Ensure orchestrator/CLI uses optimistic locking (`expected_revision`) to prevent races.
- Implement pause/resume as durable manifest state + checkpoint artifact.
- Wire watchdog_check into tick/run boundaries.

## Deliverables

- New artifacts:
  - `<run_root>/.lock` (or `locks/orchestrator.lock`)
  - `logs/pause-checkpoint.md` (or JSON)
  - stage checkpoint artifacts (optional but recommended)

- CLI support in WS1:
  - `pause`, `resume`, `inspect`, `triage`

## Acceptance criteria

- [ ] Two concurrent orchestrators cannot both mutate the same run root.
- [ ] Pause stops progress without corrupting stage history.
- [ ] Resume continues safely; watchdog does not fail immediately due to pause time.
- [ ] Telemetry + metrics show where time went.

## Reviews

- Architect PASS
- QA PASS
