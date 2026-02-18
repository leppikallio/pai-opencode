# Deep Research Option C — Follow-up Plan Pack (2026-02-18)

Date: 2026-02-18

Inputs (do not modify):
- `engineer-review-raw-2.md`
- `architect-review-raw-2.md`

## What this pack is

This pack turns the two reviews into **actionable follow-up work**.

Key reconciliation:
- The **pipeline plumbing is largely implemented** (Wave1 fan-out, pivot→wave2/citations, Phase05 generate-mode) per architect review.
- What remains to reach “real runs” is mostly **operationalization + quality + autonomous driving** (Task-backed agent driver, long-run semantics, operator UX surfacing), per both reviews.

## Scope and non-scope

In-scope follow-ups:
- Make “live” runs possible without manual operator editing (Task-backed `runAgent` driver).
- Make long runs safe (timeouts/heartbeat semantics, tick ledger, cancel, telemetry/metrics default integration).
- Make citations online reproducible and operator-actionable by default.
- Reduce doc drift (planning artifacts reflect current implementation reality).

Non-scope (explicitly deferred):
- “High-quality narrative synthesis” beyond the current bounded generate-mode (can come later).
- Large refactors of deterministic tool layer unless required by operational goals.

## Primary targets

Milestones (see `01-success-criteria-and-milestones.md`):
- **M2:** Live Wave1 reaches `pivot` with auditable artifacts (autonomous driver optional, but strongly preferred).
- **M3:** Live end-to-end reaches `finalize` with citations online fixtures + Phase05 generate artifacts.

Workstreams (see `02-workstreams.md`):
- WS-A: Task-backed agent driver (Wave1/Wave2)
- WS-B: Long-run ops hardening (timeouts/ledger/cancel/telemetry)
- WS-C: Citations online operationalization (config + blockers + fixtures)
- WS-D: Docs/plans alignment (charter pack drift)
- WS-E: Gate A/F decision (implement vs demote)
