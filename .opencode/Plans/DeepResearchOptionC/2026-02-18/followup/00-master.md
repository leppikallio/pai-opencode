# Deep Research Option C — Follow-up Master Plan
Date: 2026-02-18

## Goal
Turn Option C from “mechanically complete” into **operator-grade real research**.

Milestones:
- **M2:** Live Wave 1 autonomy reaches `pivot` with Gate B pass and auditable artifacts.
- **M3:** End-to-end live finalize with online citations reproducibility and long-run safety.

## Baseline (from raw-2 reviews)
The pipeline plumbing is largely implemented (Wave1 fan-out, pivot→wave2 routing, citations artifacts, Phase05 generate-mode), but true “real runs” need operationalization:
- autonomous `runAgent` driver (Task-backed)
- long-run timeout semantics
- CLI ergonomics (run-id-first, until/cancel)
- observability defaults (tick ledger, telemetry)
- config precedence (post-init: run-config/manifest over env)
- executable canaries + runbooks
- production skill for prompting/policy

## Epics and dependency order

### Dependency DAG (high level)
```
E1 Production runAgent driver  ─┐
                               ├─> E6 M2/M3 canaries + runbooks
E2 CLI ergonomics ──────────────┘
E5 Config + citations guidance ─┬─> E6
E3 Long-run timeouts ───────────┘
E4 Observability ───────────────┘
E7 deep-research-production skill ─> E6 (optional for first canary; required for “pleasant runs”)
E8 Charter pack refresh (parallel; docs-only)
```

## Definition of Done (program-level)

### Mandatory PASS gates
Each epic must end with:
- **Architect PASS**: aligns with raw-2 recommendations and preserves determinism boundaries.
- **QA PASS**: `bun test ./.opencode/tests` + `bun Tools/Precommit.ts` pass, plus epic-specific checks.

### Evidence runs
Produce two run roots under the scratch runs root:
- `dr_m2_live_wave1_001`: stage reaches `pivot`, Gate B pass, retry directives empty or consumed.
- `dr_m3_live_finalize_001`: stage reaches `finalize`, Gate C/D/E pass, fixture bundle captured.

## Execution pattern
- Use separate worktrees per epic when file overlap would collide.
- Builder = Engineer; Validators = Architect + QA; merge only after both PASS.
