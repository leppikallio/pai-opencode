# pivot-rubric-v1 (P03-07)

## Purpose
Define a **deterministic, offline** rubric for the Option C **pivot** stage: decide whether the run must execute **Wave 2** (targeted follow-up) or **skip Wave 2** and proceed to `citations`.

This rubric is designed to be implemented as a tool:
`deep_research_pivot_decide` in `.opencode/tools/deep_research.ts`.

Stage alignment: `spec-stage-machine-v1.md` stage IDs are lowercase: `wave1 -> pivot -> wave2|citations`.

---

## Decision Inputs

### Required inputs
The pivot decision is computed from **validated Wave 1 outputs**.

| Input | Type | Required | Notes |
|---|---:|:---:|---|
| `wave1_outputs[]` | array | ✅ | Wave 1 output markdown artifacts (one per `perspective_id`) |
| `wave1_validation_reports[]` | array | ✅ | One report per output (from `deep_research_wave_output_validate`, `ok=true`) |

Each `wave1_outputs[]` entry MUST include:
- `perspective_id` (string)
- `output_md_path` (absolute or run-root-relative path)

Each `wave1_validation_reports[]` entry MUST include the validator success fields:
- `ok=true`, `perspective_id`, `markdown_path`, `words`, `sources`, `missing_sections`.

### Optional inputs

| Input | Type | Required | Notes |
|---|---:|:---:|---|
| `explicit_gaps[]` | array | ❌ | Operator-supplied gaps (when Wave 1 “Gaps” section is missing/unparseable or you want to override) |

`explicit_gaps[]` items MUST be **already normalized** (no natural-language inference needed):
- `gap_id` (string, unique)
- `priority` (`P0|P1|P2|P3`) — deterministic severity
- `text` (string)
- optional `tags[]` (strings)
- optional `from_perspective_id` (string)

---

## Determinism Rules

The pivot decision MUST be deterministic for fixed inputs.

1. **No web fetches, no agent calls.** Only local reads of provided artifacts.
2. **Stable ordering:**
   - sort all per-perspective items by `perspective_id` (lexicographic)
   - sort all gaps by `(priority asc, gap_id asc)` where priority order is `P0,P1,P2,P3`
3. **No timestamps inside decision text:** timestamps may exist only in `generated_at` fields.
4. **Normalization:**
   - trim whitespace on `gap_id`, `text`, `tags`
   - collapse internal whitespace in `text` to single spaces
5. **Inputs digest:** compute `inputs_digest = sha256(<canonical JSON of inputs>)` using:
   - the sorted, normalized `wave1_validation_reports` (and `explicit_gaps` if present)
   - exclude any `generated_at` timestamps

---

## Decision Rules

The pivot decision produces **one** of two outcomes:
- `wave2_required = true` (stage machine should execute `wave2`)
- `wave2_required = false` (stage machine should mark `wave2` skipped and proceed to `citations`)

### Step 0 — Preconditions
Fail fast (hard error) if any of the following hold:
1. Any validation report has `ok=false`.
2. Any report has `missing_sections.length > 0`.
3. Any report’s `perspective_id` does not match its paired output.

Rationale: `spec-stage-machine-v1.md` requires Gate B pass to reach `pivot`. Pivot assumes Wave 1 artifacts are contract-compliant.

### Step 1 — Build the normalized gap set
The rubric supports two deterministic gap sources.

**Source precedence (v1):**
1) If `explicit_gaps[]` is provided and non-empty → use `explicit_gaps` and **ignore** markdown gap extraction.
2) Else → extract gaps from Wave 1 markdown outputs using the **syntactic** rules below.

#### Wave 1 markdown gap extraction (v1, syntactic)

For each `wave1_outputs[]` entry:
1. Read the markdown file.
2. Locate the `Gaps` section by finding the first markdown heading whose text equals `Gaps` (case-sensitive). Any heading level `#`..`######` is allowed.
3. Parse gap lines from the content **until** the next heading or EOF.
4. A gap line MUST be a bullet beginning with `-` and MUST encode a priority in one of these exact forms:
   - `- (P0) <text>`
   - `- (P1) <text>`
   - `- (P2) <text>`
   - `- (P3) <text>`

Extraction output per parsed line:
- `gap_id` = `gap_<perspective_id>_<n>` (1-indexed within that perspective)
- `priority` from the parsed prefix
- `text` = remaining text trimmed, with internal whitespace collapsed
- `tags[]` = all `#tags` in `<text>` matching `#[a-z0-9_-]+` with the `#` removed
- `from_perspective_id` = the originating `perspective_id`
- `source = "parsed_wave1"`

If the `Gaps` section exists but contains any bullet line that does not match the required priority format, the tool MUST fail with `GAPS_PARSE_FAILED` (unless `explicit_gaps[]` was provided).

### Step 2 — Compute gap metrics
From `gaps[]` compute deterministic metrics:
- `p0_count`, `p1_count`, `p2_count`, `p3_count`
- `total_gaps`

### Step 3 — Decide Wave 2

Apply rules in order; first match wins.

1) **Wave2Required.P0**
- If `p0_count >= 1` → `wave2_required = true`.

2) **Wave2Required.P1**
- Else if `p1_count >= 2` → `wave2_required = true`.

3) **Wave2Required.Volume**
- Else if `total_gaps >= 4` AND `(p1_count + p2_count) >= 3` → `wave2_required = true`.

4) **Wave2Skip.NoGaps**
- Else → `wave2_required = false`.

### Step 4 — Produce required explanations (template-based)
The decision artifact MUST include:
- `rule_hit` (the rule ID above)
- `explanation` (generated from a fixed template, e.g.:
  - `"Wave 2 required because p0_count=1 (rule Wave2Required.P0)."`
  - `"Wave 2 skipped because total_gaps=0 (rule Wave2Skip.NoGaps)."`)

The explanation MUST NOT include any content derived from open-ended interpretation.

---

## Failure Modes

| Code | When |
|---|---|
| `INVALID_ARGS` | required inputs missing or malformed |
| `NOT_FOUND` | any referenced artifact path missing |
| `WAVE1_NOT_VALIDATED` | any validation report has `ok=false` |
| `WAVE1_CONTRACT_NOT_MET` | any report has `missing_sections.length > 0` |
| `MISMATCHED_PERSPECTIVE_ID` | output/report pairing mismatch |
| `DUPLICATE_GAP_ID` | `explicit_gaps` contains duplicate `gap_id` |
| `INVALID_GAP_PRIORITY` | gap priority not in `P0|P1|P2|P3` |
| `GAPS_SECTION_NOT_FOUND` | no `Gaps` heading found in a Wave 1 output when extraction is required |
| `GAPS_PARSE_FAILED` | unparseable gap bullet line found under `Gaps` section |

---

## References
- `spec-stage-machine-v1.md` (pivot → wave2 or skip)
- `spec-tool-deep-research-wave-output-validate-v1.md` (Wave 1 validation reports)
- `spec-manifest-schema-v1.md` (`pivot_file` canonical pointer)
