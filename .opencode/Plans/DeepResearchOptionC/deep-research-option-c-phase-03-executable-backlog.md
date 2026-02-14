# Phase 03 Executable Backlog — Agent Contracts and Wave Graph

## Objective
Operationalize parallel research waves (Wave 1 + Pivot/Wave 2 planning) with strict, deterministic, **parseable** output contracts and reviewer enforcement.

## Dependencies
- Phase 02 stage scheduler operational (`spec-tool-deep-research-stage-advance-v1.md`).
- Router/synthesis bounded schemas available (`spec-router-summary-schemas-v1.md`).
- Cross-phase testing requirement (`deep-research-option-c-testing-strategy-v1.md`).

## Gate
- **Gate B:** wave contract compliance and pivot integrity.

## Backlog (Owner/Reviewer mapped)
| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P03-01 | Define deterministic **perspectives writer/validator** contract (inputs → `perspectives.json` v1; stable ordering; no web/agents) | Architect | Engineer | Phase 02 + `spec-router-summary-schemas-v1.md` | `spec-tool-deep-research-perspectives-write-v1.md` | Spec includes schema mapping + determinism rules + examples |
| P03-02 | Implement tool: `deep_research_perspectives_write` (writes + validates `scratch/research-runs/<run_id>/perspectives.json`) | Engineer | Architect | P03-01 | Tool implementation + wiring per spec | `bun test .opencode/tests/entities/deep_research_perspectives_write.test.ts` passes |
| P03-T1 | Add entity tests + fixtures for `deep_research_perspectives_write` (valid + invalid schema cases) | Engineer | QATester | P03-02 + testing strategy | `.opencode/tests/entities/deep_research_perspectives_write.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_perspectives_write.test.ts` passes in seconds |
| P03-03 | Define **Wave 1 fan-out scaffolding** contract (command-level orchestration plan; deterministic caps; **no real web research**) | Architect | Engineer | Phase 02 + P03-01 | `spec-tool-deep-research-wave1-plan-v1.md` | Spec shows: plan JSON shape + cap rules + “no web/agent execution” constraint |
| P03-04 | Implement tool: `deep_research_wave1_plan` (reads `perspectives.json`; produces a wave plan artifact + intended agent prompts) | Engineer | Architect | P03-03 | Tool implementation + wave plan artifact format | `bun test .opencode/tests/entities/deep_research_wave1_plan.test.ts` passes |
| P03-T2 | Add entity tests + fixtures for `deep_research_wave1_plan` (deterministic plan ordering; cap enforcement) | Engineer | QATester | P03-04 + testing strategy | `.opencode/tests/entities/deep_research_wave1_plan.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_wave1_plan.test.ts` passes |
| P03-05 | Define **wave output contract validation** (parseable sections; source hygiene; size + source caps; Gate B input) | Architect | Engineer | `spec-router-summary-schemas-v1.md` + testing strategy | `spec-tool-deep-research-wave-output-validate-v1.md` | Spec includes required sections, source format, and failure codes |
| P03-06 | Implement tool: `deep_research_wave_output_validate` (validates a single perspective output markdown against contract) | Engineer | Architect | P03-05 | Tool implementation + return JSON contract | `bun test .opencode/tests/entities/deep_research_wave_output_validate.test.ts` passes |
| P03-T3 | Add entity tests + fixtures for `deep_research_wave_output_validate` (missing sections; too many sources; malformed sources) | Engineer | QATester | P03-06 + testing strategy | `.opencode/tests/entities/deep_research_wave_output_validate.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_wave_output_validate.test.ts` passes |
| P03-07 | Draft **pivot rubric + decision artifact** (gap detection → decide Wave 2; explainable and stored) | Architect | Engineer | Phase 03 scope + `spec-stage-machine-v1.md` | `pivot-rubric-v1.md` + `spec-pivot-decision-schema-v1.md` | Docs include decision rules + example pivot decision artifact |
| P03-08 | Implement tool: `deep_research_pivot_decide` (deterministic: inputs are validated Wave 1 outputs + gaps; writes pivot decision artifact) | Engineer | Architect | P03-07 + P03-06 | Tool implementation + pivot decision artifact | `bun test .opencode/tests/entities/deep_research_pivot_decide.test.ts` passes |
| P03-T4 | Add entity tests + fixtures for `deep_research_pivot_decide` (Wave2 on/off; stable decision output) | Engineer | QATester | P03-08 + testing strategy | `.opencode/tests/entities/deep_research_pivot_decide.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_pivot_decide.test.ts` passes |
| P03-09 | Implement reviewer enforcement scaffold (builder→validator pairing): run validators, emit PASS/FAIL + retry directive for each perspective | Engineer | Architect | P03-06 + Phase 02 | `spec-tool-deep-research-wave-review-v1.md` + tool/command scaffold | `bun test .opencode/tests/entities/deep_research_wave_review.test.ts` passes (fixture-driven, no agents) |
| P03-T5 | Add entity tests + fixtures for reviewer enforcement scaffold (PASS/FAIL aggregation; retry directives bounded) | Engineer | QATester | P03-09 + testing strategy | `.opencode/tests/entities/deep_research_wave_review.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_wave_review.test.ts` passes |
| P03-X1 | Phase 03 checkpoint + **Gate B signoff** | Architect | QATester | all P03-* | `PHASE-03-CHECKPOINT-GATE-B.md` | Reviewer PASS + Wave contracts + pivot integrity verified + Phase 04 unblocked |

## Notes
- Phase 03 must keep Wave 1 “fan-out” **plan/execution scaffolding** deterministic and testable without network or real agent work.
- Every new entity introduced in Phase 03 must have a **seconds-fast** contract test + fixtures (per `deep-research-option-c-testing-strategy-v1.md`).
- Use `spec-stage-machine-v1.md` invariants: `init` cannot transition to `wave1` unless `perspectives.json` exists and validates.
