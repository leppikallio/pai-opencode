# Option C — Glossary (operator + engineer)

Date: 2026-02-16

## Core objects

### Run root
A directory that contains the canonical artifacts for one deep research run.

Canonical location:
- `/Users/zuul/.config/opencode/research-runs/<run_id>`

### Manifest (`manifest.json`)
The run’s state ledger (schema `manifest.v1`), including:
- current stage
- status (running/completed/failed/paused)
- revision + history

### Gates (`gates.json`)
The recorded gate decisions/metrics/warnings for Gates A–F (schema `gates.v1`).

### Audit log (`logs/audit.jsonl`)
Append-only operational log of tool actions, stage transitions, and key decisions.

---

## Operator-critical artifacts (by filename)

These are the “touchpoints” an operator/debugger will look for in the run root.

### `perspectives.json`
Deterministic list of perspectives/angles to run, with caps and required sections.

### `wave-1/wave1-plan.json`
Deterministic wave1 execution plan artifact (entries include prompt_md and output_md paths).

### `wave-1/<perspective_id>.md`
Wave 1 research output markdown for a single perspective.

### `wave-review.json`
Aggregated validator/reviewer result for Wave 1 (PASS/FAIL + retry directives).

### `pivot.json`
Pivot decision artifact explaining whether Wave 2 is required and listing gaps.

### `wave-2/<gap_id>.md`
Wave 2 output markdown (gap-only specialist responses).

### `citations/citations.jsonl`
Validated citation pool used downstream for synthesis grounding.

### `summaries/summary-pack.json`
Bounded synthesis input pack (Gate D enforced).

### `synthesis/final-synthesis.md`
Final synthesis artifact that must exist before review.

### `review/review-bundle.json`
Reviewer bundle describing PASS/CHANGES_REQUIRED and required edits.

### `review/terminal-failure.json`
Written when review iteration cap is hit and Gate E still fails; used to mark run failed.

---

## Stages (from `spec-stage-machine-v1.md`)

- `init` — run created, base artifacts written
- `wave1` — parallel perspective execution (primary research)
- `pivot` — decide whether Wave 2 is needed
- `wave2` — gap-only specialist execution
- `citations` — build and validate citation pool (Gate C)
- `summaries` — build bounded summary pack (Gate D)
- `synthesis` — produce final synthesis draft/final
- `review` — reviewer loop (CHANGES_REQUIRED loops back)
- `finalize` — terminal completed state

---

## Waves

### Wave 1
The first parallel fan-out of perspectives/angles.

### Wave 2
A second fan-out limited to explicit gaps identified at pivot.

---

## Pivot

The deterministic decision artifact (`pivot.json`) that explains:
- whether to run Wave 2
- which gaps require filling

---

## Gates

### Gate A
Planning completeness / schemas and baseline invariants.

### Gate B
Wave output contract compliance (validators + wave review) and readiness to pivot.

### Gate C
Citation pool validity/thresholds.

### Gate D
Summary pack boundedness + coverage.

### Gate E
Synthesis quality metrics + reviewer outcome; governs finalize vs terminal failure.

### Gate F
Rollout safety (feature flags, caps, emergency disable, drills).

---

## Fixture bundle

A captured, deterministic artifact set that allows offline replay/regression testing.

---

## Driver boundary

The explicit interface that allows the orchestrator to:
- use a fixture driver (deterministic outputs)
- use a live driver (Task tool agent spawning + retrieval)

This is the mechanism that enables step isolation.
