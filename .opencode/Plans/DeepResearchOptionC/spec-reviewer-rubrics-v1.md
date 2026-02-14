# spec-reviewer-rubrics-v1 (P00-B02)

## Purpose
Defines what reviewers check at each gate and what evidence is required for a PASS.

## Rubric format
Each gate rubric includes:
- PASS requirements (checklist)
- FAIL conditions
- Required evidence artifacts

---

## Gate A Rubric — Planning completeness

### PASS checklist
- [ ] `spec-manifest-schema-v1.md` defines invariants + allowed stages + JSON example
- [ ] `spec-gates-schema-v1.md` defines gate lifecycle rules + JSON example
- [ ] `spec-router-summary-schemas-v1.md` defines both schemas with size caps + examples
- [ ] `spec-citation-schema-v1.md` includes normalization rules + provenance + examples
- [ ] `spec-gate-thresholds-v1.md` includes measurable thresholds for A–F
- [ ] `spec-pause-resume-v1.md` includes canonical read order + checkpoint template

### FAIL conditions
- Any schema lacks an example.
- Any gate lacks measurable thresholds.

### Required evidence
- Links to each spec file above.

---

## Gate B Rubric — Wave contract compliance

### PASS checklist
- [ ] Wave output template exists (required sections enumerated)
- [ ] Validator detects missing sections deterministically
- [ ] Retry policy is defined and bounded
- [ ] Canary run shows >= thresholds in `spec-gate-thresholds-v1.md`

### FAIL conditions
- Agents can produce free-form outputs with no parseability.

### Required evidence
- `perspectives.json` (shows must_include_sections)
- Sample wave outputs (at least 3) showing required headings
- Validator report output with computed Gate B metrics
- `gates.json` excerpt showing Gate B status + warnings (if any)

---

## Gate C Rubric — Citation validation integrity

### PASS checklist
- [ ] `citations.jsonl` generated for every extracted URL
- [ ] Every citation has a status (no unknown)
- [ ] Synthesis blocks if Gate C fails
- [ ] Invalid/mismatch citations surface reasons

Status semantics (v1):
- `valid` and `paywalled` count toward `validated_url_rate`.
- `invalid`, `blocked`, and `mismatch` count toward `invalid_url_rate`.
- Any other status counts toward `uncategorized_url_rate` and fails the gate.

### Required evidence
- `citations/citations.jsonl` sample (at least 5 lines)
- Proof that every extracted URL has a status (no unknown)
- `gates.json` excerpt showing Gate C status

---

## Gate D Rubric — Summary pack boundedness

### PASS checklist
- [ ] Summary pack has hard size caps
- [ ] Summaries reference citations by cid (not raw URLs)
- [ ] Synthesis reads only summary pack + validated citations

### Required evidence
- `summaries/summary-pack.json`
- Byte/KB size report for summary pack and per-summary files
- `gates.json` excerpt showing Gate D status

---

## Gate E Rubric — Synthesis quality

### PASS checklist
- [ ] Required report sections present
- [ ] 0 uncited numeric claims
- [ ] Utilization computed and warnings emitted for soft failures

### Required evidence
- `synthesis/final-synthesis.md`
- Numeric-claim check output proving `uncited_numeric_claims = 0`
- Citation utilization report output (with utilization + duplicate rate)
- `gates.json` excerpt showing Gate E status + warnings (if any)

---

## Gate F Rubric — Rollout safety

### PASS checklist
- [ ] Feature flags exist and are documented
- [ ] Canary plan exists with rollback triggers
- [ ] Fallback path exists and preserves artifacts

### Required evidence
- Feature flags doc (`spec-feature-flags-v1.md`)
- Canary/rollout playbook (Phase 07 deliverable)
- Rollback triggers and fallback procedure proof (Phase 07 deliverable)

---

## Evidence (P00-B02)
This file provides explicit checklists for Gate A–F.
