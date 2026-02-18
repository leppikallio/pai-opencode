# Option C — Follow-up Workstreams

Priority labels:
- **P0:** blocks M2/M3 evidence runs or makes iteration painful
- **P1:** materially improves operator safety/UX but not strictly blocking

Dependencies are listed per workstream.

---

## WS-A (P0): Task-backed agent driver for Wave1/Wave2

Goal: Replace “operator-input” as the only practical live driver with a production driver that spawns agents and captures outputs deterministically.

Deliverables:
- A `runAgent` driver implementation that:
  - spawns one agent per perspective/plan entry
  - captures `{ markdown, agent_run_id, started_at, finished_at }`
  - writes prompts + raw outputs into run root
  - supports bounded retries (and records retries via existing retry tooling)

Suggested implementation targets (from reviews):
- Driver boundary is injected into:
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts` (Wave1)
  - `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts` (Wave2)
- The CLI currently defaults to an operator-input driver:
  - `.opencode/pai-tools/deep-research-option-c.ts`

Acceptance checks:
- Run reaches M2 using autonomous driver (preferred).
- Retry directives are consumed deterministically and recorded.

Dependencies:
- None, but should align with WS-B long-run semantics to avoid watchdog false failures.

---

## WS-B (P0): Long-run ops hardening

Goal: Make 1h+ runs safe and observable without requiring manual pause/resume babysitting.

Tasks:
- Decide and implement **timeout semantics** for deep mode:
  - Option 1: per-mode/per-stage larger timeouts
  - Option 2: progress-heartbeat semantics (timeout since last progress)
- Add **cancel** to operator CLI (`manifest.status="cancelled"`) and orchestrator handling.
- Add a **tick ledger** (`logs/ticks.jsonl`) with one entry per tick (start/end/outcome/digests).
- Integrate **telemetry + metrics** into CLI `run` loop by default.

Acceptance checks:
- A long Wave1 run does not fail merely due to watchdog thresholds while producing progress.
- Operator can cancel safely and resume behavior remains correct.

Dependencies:
- None.

---

## WS-C (P0): Citations online operationalization (config + blockers + fixtures)

Goal: Online citations are reproducible, and when blocked they produce clear operator actions.

Tasks:
- Make effective citations configuration **run-local and inspectable** (prefer run-config/manifest-captured config over ambient env post-init).
- Ensure online mode always emits:
  - `citations/online-fixtures.*.json`
  - `citations/blocked-urls.json` (even if empty)
- Surface citations blockers in operator `inspect` output.
- Decide policy: do blocked URLs hard-fail Gate C or stop with “operator action required” while resumable?

Acceptance checks:
- M3 evidence run either passes citations or stops with actionable artifacts and remains resumable.

Dependencies:
- None.

---

## WS-D (P1): Docs/plans alignment (reduce drift)

Goal: Planning artifacts reflect current code reality so future work isn’t planned twice.

Tasks:
- Update/replace planning docs that still expect `Tools/` CLI where the real operator CLI is `.opencode/pai-tools/deep-research-option-c.ts`.
- Refresh readiness gates language to match what is actually implemented (Wave1 fan-out, generate-mode).
- Add a single “operator canary runbook” that matches current CLI flags and artifacts.

Acceptance checks:
- No primary plan claims “missing” work that is already implemented.

Dependencies:
- None.

---

## WS-E (P1): Gate A / Gate F decision

Goal: Resolve mismatch between conceptual gates and enforced pipeline reality.

Decision options:
1) Implement Gate A and Gate F evaluators/derivers and enforce via `stage_advance`.
2) Demote Gate A/F to “documentation-only readiness checks” and remove from hard claims.

Acceptance checks:
- Stage machine + readiness docs are consistent with whichever option is chosen.

Dependencies:
- WS-D (doc alignment) should incorporate this decision.
