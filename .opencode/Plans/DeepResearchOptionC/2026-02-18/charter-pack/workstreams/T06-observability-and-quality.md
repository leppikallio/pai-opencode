# Track T06 — Observability + Quality

## Mission
Make runs **measurable, replayable, and regressible**: telemetry, run metrics, quality audits, and fixture-based regression.

## In scope
- Run telemetry schema + metrics dictionary
- Deterministic metrics rollups per run
- Fixture capture + replay + quality audit tooling
- Regression suite to detect drift in gates and synthesis quality

## Out of scope
- Business logic of citations/synthesis/orchestration (owned by T04/T05/T02)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-06-observability-quality.md`
- `spec-run-telemetry-schema-v1.md`
- `spec-run-metrics-dictionary-v1.md`
- `spec-tool-deep-research-telemetry-append-v1.md`
- `spec-tool-deep-research-run-metrics-write-v1.md`
- `spec-tool-deep-research-fixture-bundle-v1.md`
- `spec-tool-deep-research-fixture-replay-v1.md`
- `spec-deep-research-regression-suite-v1.md`
- `spec-tool-deep-research-quality-audit-v1.md`

## Interfaces (inputs/outputs)
- **Inputs:** run roots produced by orchestrator (T02)
- **Outputs:** `run-metrics.json`, fixture bundles, regression reports

## Acceptance criteria (binary)
- Fixture replay reproduces gate outcomes deterministically on at least one seeded run
- Regression suite runs offline and flags intentional drift when fixtures change
- Run metrics dictionary is used to compute a metrics artifact with schema validation

## Dependencies
- Blocked by: T00, T01; integrates with T02/T04/T05 once available

## Risks
- Metrics become “nice to have” and diverge → mitigate by making metrics part of Gate F rollout criteria

## Owner / reviewer
- Owner: QATester
- Reviewer: Engineer
