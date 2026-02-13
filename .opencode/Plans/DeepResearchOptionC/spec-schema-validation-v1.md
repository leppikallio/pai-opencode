# spec-schema-validation-v1 (P01-05)

## Purpose
Define how we validate run artifacts (manifest/gates/perspectives/summary pack) to keep the system deterministic.

## Scope (v1)
Schemas to validate:

Phase 01 implements strong validation for:
- `manifest.v1` (`manifest.json`)
- `gates.v1` (`gates.json`)

Later phases add validators for:
- `perspectives.v1` (`perspectives.json`)
- `summary_pack.v1` (`summary-pack.json`)
- `citation.v1` (`citations.jsonl` records)

## When validation runs
1. **On every write** of manifest/gates.
2. **Before stage transitions** (stage machine must refuse to advance if inputs invalid).
3. **Before synthesis** (hard gate: summary pack + citations pool valid).

## Failure behavior
- Validation failure is a HARD stop for the current stage.
- Record failure into `manifest.failures[]` with `kind=invalid_output`.
- Emit a user-visible summary (todo blocked + artifact pointer).

## Acceptance criteria
- Invalid **manifest/gates** examples in `schema-examples-v1.md` are rejected.
- Validation errors are actionable (point to field/path and expected type).

## Evidence
This file defines the validation trigger points and failure semantics.
