# Deep Research Option C — Follow-up Master Plan
Date: 2026-02-18

## Context links (source reviews)
Do not edit; these are the authoritative context:
- Engineer: `../engineer-review-raw-2.md`
- Architect: `../architect-review-raw-2.md`

## Repo baseline
Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
Primary branch: `graphviz`

## Goal
Turn Option C from “mechanically complete” into **operator-grade real research**.

Milestones:
- **M2:** Live Wave 1 autonomy reaches `pivot` with Gate B pass and auditable artifacts.
- **M3:** End-to-end live finalize with online citations reproducibility and long-run safety.

## Execution constraints (binding)
- Work must progress **in parallel** across epics.
- Each epic must end with **Architect PASS** and **QA PASS**.
- Integration back to `graphviz` happens only after all epics PASS (see `90-integration-and-final-review.md`).

## Epic worktrees (already created)
| Epic | Worktree | Branch |
|---|---|---|
| E1 | `/private/tmp/pai-dr-epic-e1` | `ws/epic-e1-runagent-driver` |
| E2 | `/private/tmp/pai-dr-epic-e2` | `ws/epic-e2-cli-ergonomics` |
| E3 | `/private/tmp/pai-dr-epic-e3` | `ws/epic-e3-longrun-timeouts` |
| E4 | `/private/tmp/pai-dr-epic-e4` | `ws/epic-e4-observability` |
| E5 | `/private/tmp/pai-dr-epic-e5` | `ws/epic-e5-config-citations` |
| E6 | `/private/tmp/pai-dr-epic-e6` | `ws/epic-e6-canaries` |
| E7 | `/private/tmp/pai-dr-epic-e7` | `ws/epic-e7-production-skill` |
| E8 | `/private/tmp/pai-dr-epic-e8` | `ws/epic-e8-charter-refresh` |

## Dependency DAG (high level)
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

## Program-level Definition of Done

### PASS gates (required)
For each epic:
- Architect validator returns **PASS** with file evidence pointers.
- QA validator returns **PASS** with `bun test ./.opencode/tests` + `bun Tools/Precommit.ts` outputs.

### Evidence runs (required before final integration sign-off)
Produce two run roots under the scratch runs root:
- `dr_m2_live_wave1_001`: stage reaches `pivot`, Gate B pass, retry directives empty or consumed.
- `dr_m3_live_finalize_001`: stage reaches `finalize`, Gate C/D/E pass, fixture bundle captured.

### Final review (required after integration)
After merging all epics into `graphviz`, run:
- Architect+QA final review (see `90-integration-and-final-review.md`)
- Capture findings into a follow-up doc under this folder.
