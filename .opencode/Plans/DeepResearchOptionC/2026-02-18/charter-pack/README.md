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

## Rendering the DAG

```bash
dot -Tsvg dependency-dag.dot > dependency-dag.svg
```
