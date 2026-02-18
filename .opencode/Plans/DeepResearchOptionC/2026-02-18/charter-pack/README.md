# Workstream Charter Pack (2026-02-18)

This directory contains the **Workstream Charter Pack** (one page per track) and a **dependency DAG** for DeepResearch Option C.

## Contents (two layers)

This pack now includes **two complementary slices** to reduce confusion:

1) **Execution workstreams (WS1–WS6)** — implementation-oriented tracks derived from the deep reviews.
   - Source of truth for *what we build next*.

2) **Program tracks (T00–T07)** — master-plan oriented tracks aligned to the phase documents.
   - Useful for *where the work fits* in the overall Option C architecture.

Files:

- `00-overview.md` — purpose and governance
- `01-readiness-gates.md` — gate-based “done” definition
- `02-dependency-dag.md` — Mermaid DAG (WS-level)
- `dependency-dag.dot` — Graphviz DAG (program/track-level)
- `workstreams/` — one-page charters (both `WS*.md` and `T*.md`)

## Implementation status snapshot (from raw-2)

### WS tracks

| Track | Status | Evidence pointer |
|---|---|---|
| WS1 Operator CLI + run loop | DONE | `../architect-review-raw-2.md` (CLI command set + `/deep-research` routing) |
| WS2 Wave1 fan-out + retries | DONE | `../architect-review-raw-2.md` (wave1 fan-out, retry directives, Gate B), `../architect-review-raw-2.md` tests section |
| WS3 Pivot routing + Wave2 | DONE | `../architect-review-raw-2.md` (pivot→wave2/citations routing + wave2 tests) |
| WS4 Online citations + reproducibility | PARTIAL | `../architect-review-raw-2.md` (online ladder exists; endpoint/env and policy seams remain) |
| WS5 Phase05 generate mode | DONE | `../architect-review-raw-2.md` (generate mode in summaries/synthesis/review + post-summaries orchestration) |
| WS6 Long-run ops | PARTIAL | `../architect-review-raw-2.md` (locks/pause/resume/watchdog present; 1h+ timeout/telemetry integration gaps remain) |

### T tracks

| Track | Status | Evidence pointer |
|---|---|---|
| T00 Governance & specs | DONE | `../architect-review-raw-2.md` (artifact core + stage authority + schema invariants) |
| T01 Platform core | DONE | `../architect-review-raw-2.md` (atomic writers, run lock/lease, deterministic run-root substrate) |
| T02 Orchestrator engine | PARTIAL | `../architect-review-raw-2.md` (orchestrator plumbing implemented; live driver still operator-input) |
| T03 Agent contracts & waves | DONE | `../architect-review-raw-2.md` (wave validation/review + multi-perspective tests) |
| T04 Citation system | PARTIAL | `../architect-review-raw-2.md` (online citations functional; env/config and blocked-url policy gaps remain) |
| T05 Summary/synthesis/review factory | DONE | `../architect-review-raw-2.md` (generate mode + bounded review loop) |
| T06 Observability + quality | PARTIAL | `../architect-review-raw-2.md` (tools exist; not fully integrated in operator loop) |
| T07 Rollout + hardening | MISSING | `../architect-review-raw-2.md` (Gate F evaluator/runbook completion not yet implemented) |

## Rendering the DAG

```bash
dot -Tsvg dependency-dag.dot > dependency-dag.svg
```
