# Track T04 — Citation System

## Mission
Provide an **evidence pipeline** that yields a validated citation pool (Gate C), suitable for bounded synthesis.

## In scope
- URL extraction → normalization → validation → deterministic citation IDs
- Offline/online fixtures and replayable validation outcomes
- Gate C computation: threshold checks + report generation

## Out of scope
- Synthesis writing (T05)
- Orchestrator sequencing (T02)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-04-citation-system.md`
- Tool specs:
  - `spec-tool-deep-research-citations-extract-urls-v1.md`
  - `spec-tool-deep-research-citations-normalize-v1.md`
  - `spec-tool-deep-research-citations-validate-v1.md`
  - `spec-tool-deep-research-citations-render-md-v1.md`
- `spec-citation-schema-v1.md`
- `spec-tool-deep-research-gate-c-compute-v1.md`

## Interfaces (inputs/outputs)
- **Inputs:** wave output markdown (from T03) and/or synthesis drafts
- **Outputs:** `citations.jsonl` + validation reports; Gate C metrics

## Acceptance criteria (binary)
- Citation validation produces deterministic `citations.jsonl` on fixture replay
- Gate C fails when thresholds are not met and emits an actionable report
- Citation rendering produces a stable markdown report suitable for review

## Dependencies
- Blocked by: T00, T01

## Risks
- Live web variability → mitigate with fixture capture + deterministic replay pipeline

## Owner / reviewer
- Owner: Engineer
- Reviewer: QATester
