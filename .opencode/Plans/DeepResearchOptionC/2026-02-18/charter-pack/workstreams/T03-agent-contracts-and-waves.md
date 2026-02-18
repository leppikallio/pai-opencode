# Track T03 — Agent Contracts & Waves

## Mission
Define and enforce **wave output contracts** and reviewer checkpoints so agent parallelism stays deterministic and verifiable.

## In scope
- Perspective + wave planning artifacts
- Wave output markdown contract validation (Gate B)
- Reviewer factory contracts + rubrics integration points
- Bounded context rules (synthesis reads only summary pack + citation pool)

## Out of scope
- Orchestrator sequencing (T02)
- Citation extraction/validation logic (T04)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-03-agent-contracts.md`
- `spec-tool-deep-research-wave1-plan-v1.md`
- `spec-tool-deep-research-wave-output-validate-v1.md`
- `spec-tool-deep-research-wave-review-v1.md`
- `spec-reviewer-rubrics-v1.md`

## Interfaces (inputs/outputs)
- **Inputs:** T00 schemas/rubrics; orchestrator stage boundaries (T02)
- **Outputs:** validated wave outputs and wave review reports suitable for gating

## Acceptance criteria (binary)
- A wave output validator rejects non-conforming markdown with actionable errors
- Gate B metrics are computed deterministically from stored wave outputs
- Reviewer rubrics can be executed fixture-only (no web) for regression testing

## Dependencies
- Blocked by: T00

## Risks
- Agents produce verbose/off-contract output → mitigate via strict templates + validation + reviewer gate

## Owner / reviewer
- Owner: Engineer
- Reviewer: QATester
