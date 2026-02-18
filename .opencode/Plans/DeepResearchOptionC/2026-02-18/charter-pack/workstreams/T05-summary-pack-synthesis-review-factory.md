# Track T05 — Summary Pack + Synthesis + Review Factory

## Mission
Produce **bounded synthesis** from bounded inputs, with deterministic reviewer aggregation and Gate D/E enforcement.

## In scope
- Summary pack assembly + size/cost bounding (Gate D)
- Synthesis writer that consumes *only* summary pack + validated citations
- Review factory run + bounded revision control policy
- Gate E evaluation + offline evidence reports

## Out of scope
- Live retrieval and citation validation (T04)
- Orchestrator control flow (T02)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-05-synthesis-review-factory.md`
- Tool specs:
  - `spec-tool-deep-research-summary-pack-build-v1.md`
  - `spec-tool-deep-research-synthesis-write-v1.md`
  - `spec-tool-deep-research-review-factory-run-v1.md`
  - `spec-tool-deep-research-revision-control-v1.md`
  - `spec-tool-deep-research-gate-d-evaluate-v1.md`
  - `spec-tool-deep-research-gate-e-evaluate-v1.md`
  - `spec-tool-deep-research-gate-e-reports-v1.md`
- `spec-router-summary-schemas-v1.md`

## Interfaces (inputs/outputs)
- **Inputs:** validated `citations.jsonl` (T04), wave outputs / summaries (T03)
- **Outputs:** `summary-pack.json` + `synthesis.md` + review bundle + Gate D/E metrics

## Acceptance criteria (binary)
- Synthesis tool rejects inputs that are not validated/bounded (enforced preconditions)
- Gate D fails on oversized/insufficient coverage summary packs
- Gate E produces an evidence report that can be reviewed offline deterministically

## Dependencies
- Blocked by: T00, T03, T04

## Risks
- Scope creep in synthesis input surface → mitigate with strict input contract and enforcement in tool

## Owner / reviewer
- Owner: Engineer
- Reviewer: Architect
