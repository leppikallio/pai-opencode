# Deep Research Option C — Readiness Gates (A–E)

Date: 2026-02-18

This document is the **planning translation** of the Architect readiness rubric (see `../architect-review-raw.md`, section “Readiness rubric”).

Each gate is **binary**. If a gate is not PASS, we do not proceed to the next milestone.

## Gate A — Tool wiring & schema invariants (must remain PASS)

### Intent

The tool layer is reliable, up-to-date (no stale module cache), and schema-safe. No `NOT_IMPLEMENTED` traps.

### PASS conditions

- [ ] In-chat tool calls execute the real implementations:
  - `deep_research_run_init`
  - `deep_research_perspectives_write`
  - `deep_research_stage_advance`
  - `deep_research_wave1_plan`
  - `deep_research_gates_write`
- [ ] `manifest.json` and `gates.json` remain valid v1 after every stage transition.
- [ ] Stage movement occurs via `deep_research_stage_advance` only.

### Evidence artifacts

- Run root exists under configured runs root (default `~/.config/opencode/research-runs/<run_id>`).
- `manifest.json`, `gates.json`, `logs/audit.jsonl` exist.

### Verification commands

Repo checks:

```bash
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

Runtime sanity (operator run): create a new run and attempt `init -> wave1`.

## Gate B — Live Wave 1 completeness (M2 prerequisite)

### Intent

Wave 1 is truly **multi-perspective** and stable: fan-out, ingest, validate, review, Gate B derive/write, stage advance.

### PASS conditions

- [ ] Live execution runs **all** entries in `wave-1/wave1-plan.json` (not only `entries[0]`).
- [ ] For each planned perspective entry:
  - [ ] agent markdown exists at `wave-1/<perspective_id>.md`
  - [ ] passes `deep_research_wave_output_validate`
  - [ ] ingest succeeded and did not permit path traversal
- [ ] `wave-review.json` exists and covers **all** planned perspectives.
- [ ] Retry directives are either empty OR are consumed deterministically with bounded retries.
- [ ] `gates.json` shows Gate B `status=pass` with `checked_at`.
- [ ] `deep_research_stage_advance` succeeds from `wave1 -> pivot`.

### Evidence artifacts

- `wave-1/wave1-plan.json`
- `wave-1/*.md` (one per planned perspective)
- `wave-review.json`
- `gates.json` (Gate B pass)
- `manifest.json` (`stage.current = pivot`)

### Verification

- Provide an M2 evidence run root path.
- Run-level check: `deep_research_stage_advance` rejects `wave1->pivot` unless wave-review exists and Gate B is pass (already true in stage machine).

## Gate C — Online citations integrity (M3a prerequisite)

### Intent

We can do real web citations in a bounded, reproducible-enough way.

### PASS conditions

- [ ] Citations pipeline can run in **online** mode (not dry-run) under a deterministic ladder policy.
- [ ] Citations results are persisted:
  - `citations/citations.jsonl`
  - `citations/url-map.json`
  - `citations/extracted-urls.txt`
- [ ] Online reproducibility artifact exists:
  - `citations/online-fixtures.<ts>.json` (or equivalent)
- [ ] Gate C computed and written with `checked_at`.
- [ ] `deep_research_stage_advance` succeeds from `citations -> summaries`.

### Evidence artifacts

- `citations/*` directory populated as above
- `gates.json` (Gate C pass)
- `manifest.json` (`stage.current = summaries`)

## Gate D — Summaries boundedness (M3b prerequisite)

### Intent

Summary pack is produced from live artifacts with boundedness constraints enforced.

### PASS conditions

- [ ] `deep_research_summary_pack_build` supports `mode=generate` (no fixture dirs required for live).
- [ ] `summaries/summary-pack.json` exists.
- [ ] Gate D evaluated and written.
- [ ] `deep_research_stage_advance` succeeds from `summaries -> synthesis`.

### Evidence artifacts

- `summaries/summary-pack.json`
- `gates.json` (Gate D pass)

## Gate E — Final synthesis + review loop + finalize (M3 completion)

### Intent

Run reaches finalize without fixtures: synthesis and reviewer outputs are generated and bounded.

### PASS conditions

- [ ] `deep_research_synthesis_write` supports `mode=generate` and writes `synthesis/final-synthesis.md`.
- [ ] `deep_research_review_factory_run` supports `mode=generate` (or a live reviewer driver) producing `review/review-bundle.json`.
- [ ] Gate E evaluated + reports generated and written.
- [ ] `deep_research_revision_control` + `deep_research_stage_advance` enforce bounded review iterations.
- [ ] `deep_research_stage_advance` succeeds `review -> finalize`.

### Evidence artifacts

- `synthesis/final-synthesis.md`
- `review/review-bundle.json`
- `reports/*gate-e*`
- `gates.json` (Gate E pass)
- `manifest.json` (`status=completed`, `stage.current=finalize`)

## Ops Gate (cross-cutting) — Pause/Resume + long-run safety

This is treated as a must-have before claiming “production-ready for 1h+ runs”.

### PASS conditions

- [ ] Run lock/lease prevents concurrent orchestrators.
- [ ] `pause` and `resume` are first-class operator actions.
- [ ] Watchdog is enforced at tick boundaries; pause semantics don’t trigger false timeouts.
- [ ] Operator has `inspect`/`triage` commands that surface `stage_advance` evaluated blockers.
