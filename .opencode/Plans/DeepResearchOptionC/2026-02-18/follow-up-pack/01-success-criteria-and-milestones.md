# Option C — Follow-up Success Criteria & Milestones

This is the acceptance definition for follow-up work.

## Ideal State Criteria (ISC)

1. A live Option C run can reach `pivot` without re-running prior stages.
2. A live Option C run can reach `finalize` and `manifest.status="completed"`.
3. Citations online validation emits reproducibility artifacts (fixtures + blocked list) by default.
4. Long-running research is safe: the run does not fail solely due to watchdog timers during legitimate progress.
5. Operator UX surfaces blockers as first-class outputs (triage + citations blockers).
6. Planning docs reflect implementation reality (no “already done” work presented as missing).
7. Review input files remain unmodified (`engineer-review-raw-2.md`, `architect-review-raw-2.md`).

## Milestone M2 — Live Wave1 to Pivot (evidence run)

**Definition:** A run created in `sensitivity=normal` can execute Wave1 (multi-perspective), derive Gate B, and stage-advance to `pivot`.

### Minimum artifact checklist

- `manifest.json`:
  - `stage.current == "pivot"`
  - `status in {"running","paused"}`
- `gates.json`:
  - Gate B status `pass`
- `wave-1/wave1-plan.json`
- `wave-1/*.md` for all plan entries (or a clearly recorded retry history)
- `wave-review.json`
- `logs/audit.jsonl` includes manifest and gates writes

### Acceptable drivers

- **Preferred:** Task-backed agent driver (autonomous).
- **Acceptable for M2 evidence:** operator-input driver (manual) *as long as artifacts and retry recording are correct*.

## Milestone M3 — Live End-to-End Finalize (evidence run)

**Definition:** A run in `sensitivity=normal` reaches `finalize` with citations validated online (or a typed operator stop), then summaries/synthesis/review artifacts produced via generate-mode.

### Minimum artifact checklist

- `manifest.json`:
  - `stage.current == "finalize"`
  - `status == "completed"`
- `gates.json`:
  - Gate C, D, E statuses are not `not_run` (pass or fail with recorded reasons)
- `citations/`:
  - `citations.jsonl`
  - `blocked-urls.json` (can be empty but must exist in online mode)
  - `online-fixtures.*.json` (and/or a stable `latest` pointer, if implemented)
- `summaries/summary-pack.json`
- `synthesis/final-synthesis.md`
- `review/review-bundle.json`
- `reports/` Gate E evidence artifacts (whatever current tools emit)
- `logs/audit.jsonl`

### Notes

- If citations block on paywalls/CAPTCHA, the system must stop with **actionable artifacts** and remain resumable.
- Generate-mode is acceptable for M3 scaffolding; quality improvements are a later milestone.
