# Epic E5 — Config precedence + citations operator guidance + fixture capture

## Why
Both reviews highlight:
- env-driven seams for citations endpoints
- blocked URLs need first-class operator guidance
- fixture bundle capture should be a first-class operator action

## Outcomes
- After init, run-config/manifest-captured flags are authoritative; env is bootstrap/override only.
- `inspect` surfaces citations blockers and online fixtures pointers.
- Add `capture-fixtures` operator action to produce deterministic replay bundles.

## Deliverables
- Config precedence rules (doc + code): manifest constraints -> run-config -> env (optional).
- CLI `inspect` reads and summarizes `citations/blocked-urls.json` when present.
- `capture-fixtures` CLI subcommand wrapping `deep_research_fixture_bundle_capture`.

## Tests / Verification
- Entity test: config precedence honored.
- Entity test: inspect surfaces blocked URLs.

## Validator gates
- Architect PASS, QA PASS.
