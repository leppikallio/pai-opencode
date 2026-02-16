## Maximum steps reached

This reviewer hit a maximum tool-step limit mid-turn; review is based on the v2 plan + tool surface + tests inventory.

## Feasibility verdict (v2)

**PASS (conditional).**

Reason: the deterministic substrate is already substantial (stage machine, gates, citations/summaries/synthesis/review tools, entity tests). The remaining gaps are orchestration glue + one new ingest primitive + a real smoke path.

---

## Smallest concrete code changes implied by v2

### M1 — Offline end-to-end finalize smoke (fixture-run)

1) **Add one canonical smoke test**
- Suggested path: `.opencode/tests/regression/deep_research_operator_finalize_smoke.test.ts`
- Must assert:
  - run root created
  - stage transitions reach `finalize`
  - required artifacts exist (`manifest.json`, `gates.json`, `logs/audit.jsonl`, stage artifacts)

2) **Add one finalize-capable fixture bundle/case**
- Suggested path: `.opencode/tests/fixtures/dry-run/case-finalize-smoke/`
- Include minimal artifacts to satisfy staged preconditions.

3) **Likely helper adjustment**
- `dry_run_seed.ts` currently copies only `wave-1`, `wave-2`, `citations`.
- For finalize smoke, either extend the seeded artifact set or copy remaining artifacts in the smoke test setup.

### M2 — Wave output ingest/commit tool (batch writes + validation)

1) **Add new tool module**
- Suggested file: `.opencode/tools/deep_research/wave_output_ingest.ts`
- Behavior:
  - accept batch outputs
  - write `wave-1/<perspective_id>.md` (or wave-2 equivalent)
  - validate each via `wave_output_validate`
  - emit ingest report artifact + audit entry
  - return pass/fail + retry directives

2) **Export wiring**
- Update `.opencode/tools/deep_research/index.ts` and optionally `wave.ts`.

3) **Entity test for ingest tool**
- Suggested file: `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts`

4) **Deterministic driver seam**
- Minimal driver interface for `runAgent()` injection (fixture mode vs live mode).

---

## Missing file/module references to call out in v2

1) M0 deliverables referenced but missing in repo now:
- `01-operator-runbook.md`
- `02-pipeline-step-catalog.md`
- `03-orchestrator-design.md`

2) M1 smoke artifact path is not concretely named.

3) M2 ingest tool is required but unnamed in the plan.

4) `runAgent()` driver is referenced conceptually but has no concrete interface path.

5) Tool naming in matrix is conceptual and should map to concrete tool IDs.

---

## Recommended next actions

1) Lock exact file paths for:
- M1 smoke test
- M2 ingest tool
- orchestrator driver interface
2) Implement M2 ingest tool first.
3) Build M1 finalize smoke on top of that primitive and existing tools.
4) Write M0 docs with explicit tool-name mapping + artifact path table.
