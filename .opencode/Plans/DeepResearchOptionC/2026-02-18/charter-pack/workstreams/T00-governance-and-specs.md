# Track T00 — Governance & Specs

## Mission
Lock the **contracts and invariants** that let all other tracks execute in parallel without drift.

## In scope
- Canonical schemas (v1): `manifest.json`, `gates.json`, `perspectives.json`, `citations.jsonl`, `summary-pack.json`
- Gate A–F semantics + thresholds + hard/soft behavior
- Reviewer rubrics + revision control policy
- Branch/PR policy, pause/resume policy, rollback/fallback policy

## Out of scope
- Implementing tools/commands/orchestrator (owned by later tracks)
- Any OpenCode core changes

## Key artifacts (canonical refs)
- `spec-*-v1.md` (schemas, gates, thresholds, rubrics, pause/resume, rollback)
- `schema-examples-v1.md`
- Phase 00 governance + backlog:
  - `deep-research-option-c-phase-00-governance.md`
  - `deep-research-option-c-phase-00-executable-backlog.md`

## Interfaces (inputs/outputs)
- **Input:** existing archived architecture + constraints
- **Output:** versioned specs used as the hard dependency surface for T01–T07

## Acceptance criteria (binary)
- All required v1 spec documents exist and are referenced from the option C reference index
- Gate semantics include at least one pass/fail example per gate
- Phase 00 checkpoint explicitly marks governance/specs as complete

## Dependencies
- None (root track)

## Risks
- Spec churn causing downstream rework → mitigate via versioning + explicit change log

## Owner / reviewer
- Owner: Architect (builder)
- Reviewer: Engineer
