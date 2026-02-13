# Phase 04 — Citation and Evidence Services (Weeks 6–8)

## Objective
Create canonical, validated citation infrastructure as a hard gate before synthesis.

## Dependencies
- Phase 03 outputs available and structured.

## Workstreams (parallel)
### WS-04A: URL extraction and normalization
- Extract source URLs from wave outputs.
- Normalize and deduplicate references.

### WS-04B: Validation workers
- Parallel URL checks (status, redirects, content presence where required).
- Mark invalid/mismatch/paywalled states.

### WS-04C: Canonical citation pool
- Build `citations.jsonl` and `validated-citations.md` outputs.
- Track provenance (`found_by`, wave, perspective).

### WS-04D: Citation reviewer gate
- Reviewer validates that synthesis inputs only reference approved pool items.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: QATester

## Acceptance Criteria
- Citation pool generated deterministically for each run.
- Invalid citations are reported with reasons.
- Synthesis blocked if citation gate fails.

## Deliverables
- Citation service spec
- Validation policy and thresholds
- Hallucination reporting template

## Gate
- **Gate C:** citation integrity and validation coverage.
