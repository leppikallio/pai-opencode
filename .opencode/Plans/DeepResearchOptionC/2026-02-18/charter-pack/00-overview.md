# Deep Research Option C — Workstream Charter Pack (v1)

Date: 2026-02-18

This directory contains **orchestration-ready planning artifacts** derived from (but not modifying) the authoritative deep reviews:

- Architect review (rubric + risks + readiness criteria):
  - `../architect-review-raw.md`
- Engineer review (practical gaps + operator UX + acceptance criteria):
  - `../engineer-review-raw.md`

## Purpose

Turn the deep reviews into an **executable program of work**:

1) **Readiness Gates** that define “done” (no shortcuts).
2) A **dependency DAG** so we can run parallel workstreams safely.
3) One **workstream charter per track** with:
   - explicit scope and non-goals
   - exact deliverables (files + artifacts)
   - verification commands and expected evidence
   - acceptance criteria aligned to the Architect readiness rubric
   - integration plan (review + merge gates)

## Why a subdirectory is justified

The `DeepResearchOptionC/` folder already contains long-lived specs, checkpoints, and historical artifacts. A dedicated subdirectory:

- prevents confusion between **reviews/specs** and **execution plans**
- allows iterative improvements to planning artifacts without rewriting the raw reviews
- makes it easy to locate the “current plan of record” for implementation orchestration

## Governance (non-negotiable)

- **Do not edit** the raw architect/engineer reviews. All follow-on plans are separate files.
- Implementation changes are gated by:
  - Architect review PASS
  - QA review PASS
  - `bun test ./.opencode/tests` PASS
  - `bun Tools/Precommit.ts` PASS
- No changes to OpenCode core.

## Contents

- `01-readiness-gates.md` — the pass/fail gates (A–E) and required evidence
- `02-dependency-dag.md` — dependency DAG and parallelization plan
- `workstreams/WS*.md` — one charter per workstream track
