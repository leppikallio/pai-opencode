# spec-deep-research-regression-suite-v1 (P06-07)

## Purpose
Define the **Phase 06–07 offline regression suite** for Deep Research Option C.

This spec is **definition-only**:
- It defines baseline fixture bundle IDs and expectations.
- It defines expected **Gate E** outcomes (pass/fail + warnings behavior).
- It defines a runtime budget target (**“seconds-fast”**).
- It defines latency envelope checks **if telemetry exists** (otherwise explicitly **PENDING**).

## Non-goals
- Implementing the regression runner (see P06-08).
- Changing any gate metric formulas or thresholds.

## Terms

### Fixture bundle (suite)
A **fixture bundle** is a stable, versioned dataset used for deterministic regression checks.

In this repo, fixture bundles live under:
`/.opencode/tests/fixtures/`

Bundles may be:
- **Run-tree fixtures** (preferred): directory mirrors a real run root (manifest, gates, artifacts).
- **Partial fixtures** (allowed temporarily): directory contains the minimal subset of artifacts needed.

### Gate E (authoritative)
Gate E thresholds and warning semantics are defined in:
- `.opencode/Plans/DeepResearchOptionC/spec-gate-thresholds-v1.md` (Gate E)

Gate E warning strings (current implementation contract):
- `LOW_CITATION_UTILIZATION`
- `HIGH_DUPLICATE_CITATION_RATE`

## Baseline fixture bundle inventory

The regression suite MUST use a **small** baseline set (fast + stable). Each bundle has a stable ID.

> Note: the Phase 04–07 testing plan proposes run-tree fixtures under `fixtures/runs/*`.
> This repo currently has partial fixtures for Gate E under `fixtures/summaries/phase05/`.

### Table — baseline bundles (v1)

| Bundle ID | Lives under `.opencode/tests/fixtures/` | Bundle type | Gate E status | Gate E warnings expectation | Notes |
|---|---|---|---|---|---|
| `p05_gate_e_pass_warn_dup` | `summaries/phase05/` (uses `citations.jsonl` + `synthesis/final-synthesis-pass.md`) | partial | **pass** | MUST include `HIGH_DUPLICATE_CITATION_RATE`; MUST NOT include `LOW_CITATION_UTILIZATION` | Hard metrics pass; soft duplicate rate intentionally warns |
| `p05_gate_e_fail_uncited_numeric` | `summaries/phase05/` (uses `citations.jsonl` + `synthesis/final-synthesis-fail-uncited.md`) | partial | **fail** | MUST be `[]` (empty) | Hard metric failure via an uncited numeric claim |
| `p05_review_bundle_pass` | `summaries/phase05/review-fixture/pass/` | partial | N/A | N/A | Review bundle used by revision control; not a Gate E evaluator input |
| `p05_review_bundle_changes_required` | `summaries/phase05/review-fixture/changes/` | partial | N/A | N/A | Review bundle used by revision control; not a Gate E evaluator input |

### Planned run-tree fixtures (declared now; may be missing today)

These bundles are **baseline candidates** and MUST be added under `fixtures/runs/` before Phase 06 is considered complete.
They are listed here so the regression runner can key off stable IDs.

| Bundle ID (planned) | Expected path | Gate E status | Gate E warnings expectation | State |
|---|---|---|---|---|
| `p05-synthesis-template-pass` | `runs/p05-synthesis-template-pass/` | pass | warnings MAY include `HIGH_DUPLICATE_CITATION_RATE` (depends on template), utilization warning MUST NOT be present | **PENDING in this repo** |
| `p06-telemetry-minimal` | `runs/p06-telemetry-minimal/` | N/A | N/A | **PENDING in this repo** |

## Expected Gate E outcomes (suite rules)

### Outcome assertion shape
For each Gate E bundle, the regression suite MUST assert:
- `status` is exactly `pass` or `fail`.
- `warnings` is present and is an array of strings.
- Warnings are treated as **behavioral contract**, not mere logging.

### Gate E hard vs soft semantics
- **Hard metrics** failing ⇒ `status=fail`.
- **Soft metrics** failing ⇒ `status` unchanged (pass/fail determined by hard metrics) AND warnings MUST be emitted.

## Runtime budget target (“seconds-fast”)

Targets (v1):
- Full offline regression suite (baseline bundles only): **<= 15 seconds** on a typical dev laptop.
- Per Gate E evaluation bundle: **<= 1 second** wall-clock.

## Latency envelope checks (telemetry)

### Current state
No stable telemetry fixture bundle is present under `.opencode/tests/fixtures/` in this repo at the time this spec was written.

Therefore:
- Latency envelope enforcement is **PENDING**.
- The regression suite MUST NOT fail solely due to missing telemetry until telemetry fixtures exist.

### When telemetry exists (future enforcement)
When `p06-telemetry-minimal` (or equivalent) exists, the regression suite MUST add envelope checks:

- Verify telemetry completeness.
- Verify latency envelope (v1 suggested bounds; tune as data arrives):
  - `deep_research_gate_e_evaluate` p95 duration <= **200ms**
  - full fixture replay p95 duration <= **2s** per bundle
  - end-to-end regression suite p95 duration <= **15s**

## References
- `.opencode/Plans/DeepResearchOptionC/spec-gate-thresholds-v1.md` (Gate E thresholds + formulas)
- `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-gate-e-evaluate-v1.md` (Gate E evaluator contract)
- `.opencode/Plans/DeepResearchOptionC/deep-research-option-c-phases-04-07-testing-plan.md` (fixture conventions)
