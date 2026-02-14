# PHASE-03-WAVE1-ARCH-REVIEW — Spec Compliance Review (Wave 1)

Scope: Phase 03 Wave 1 tools implemented in `.opencode/tools/deep_research.ts`:
- `wave1_plan` (tool name: `deep_research_wave1_plan`)
- `wave_output_validate` (tool name: `deep_research_wave_output_validate`)

Date: 2026-02-14

---

## 1) Tool: `deep_research_wave1_plan` (export: `wave1_plan`)

### Spec compliance: PASS (with minor notes)

#### Inputs (args)
Spec requires:
- `manifest_path` (absolute, required)
- `perspectives_path` (absolute, optional; default from manifest `<runRoot>/<perspectives_file>`)
- `reason` (required)

Implementation matches, with an additive safety check (run_id mismatch error), which is acceptable.

#### Outputs
Matches spec success shape:
- `ok`, `plan_path`, `inputs_digest`, `planned`

#### Artifact path + shape
Matches spec:
- writes `<runRoot>/<wave1_dir>/wave1-plan.json`
- `schema_version: "wave1_plan.v1"`
- `entries[]` sorted by `perspective_id`

#### Error codes
Implements the expected failure modes (INVALID_ARGS, NOT_FOUND, INVALID_JSON, SCHEMA_VALIDATION_FAILED, WAVE_CAP_EXCEEDED, WRITE_FAILED).

---

## 2) Tool: `deep_research_wave_output_validate` (export: `wave_output_validate`)

### Spec compliance: PASS (with one small contract note)

#### Inputs (args)
Matches spec:
- `perspectives_path`, `perspective_id`, `markdown_path`

#### Outputs
Matches spec:
- `ok`, `perspective_id`, `markdown_path`, `words`, `sources`, `missing_sections`

#### Validation rules
Matches spec:
- required section headings from `must_include_sections[]`
- word cap (`max_words`)
- sources parsing/enforcement (`max_sources`) when Sources section required

#### Error codes
Matches spec enumerated codes:
- `MISSING_REQUIRED_SECTION`, `TOO_MANY_WORDS`, `TOO_MANY_SOURCES`, `MALFORMED_SOURCES`, `PERSPECTIVE_NOT_FOUND` (+ base codes)

Small note:
- Catch-all uses `WRITE_FAILED` even though tool is read/validate-only; consider `INTERNAL_ERROR` later.

---

## 3) Test sufficiency assessment

### `deep_research_wave1_plan` tests
Good baseline coverage:
- artifact location + schema basics
- deterministic ordering by perspective id
- cap-exceeded branch (`WAVE_CAP_EXCEEDED`)

Suggested additions:
- failure mode coverage (NOT_FOUND, INVALID_JSON)
- determinism pinning for `inputs_digest`
- explicit assertion that `prompt_md` contains no timestamps

### `deep_research_wave_output_validate` tests
Strong coverage of expected failures and codes.

Suggested additions:
- INVALID_ARGS (non-absolute path)
- NOT_FOUND / INVALID_JSON / SCHEMA_VALIDATION_FAILED cases

---

## Evidence pointers

1) Implementation — `wave1_plan`:
- `.opencode/tools/deep_research.ts` (wave1_plan implementation section)

2) Implementation — `wave_output_validate`:
- `.opencode/tools/deep_research.ts` (wave_output_validate implementation section)

3) Spec — wave1 plan:
- `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-wave1-plan-v1.md`

4) Spec — wave output validate:
- `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-wave-output-validate-v1.md`

5) Tests — wave1 plan:
- `.opencode/tests/entities/deep_research_wave1_plan.test.ts`

6) Tests — wave output validate:
- `.opencode/tests/entities/deep_research_wave_output_validate.test.ts`

---

## Verdict

- `deep_research_wave1_plan`: PASS
- `deep_research_wave_output_validate`: PASS
