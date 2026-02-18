# Epic E1 — Production `runAgent` driver (Task-backed)

## Why
Architect raw-2: live mode still defaults to an operator-input driver, not autonomous Task-spawned agents.

## Outcome
Provide an autonomous, Task-backed `runAgent` driver that:
- spawns one agent per perspective (or per plan entry)
- captures `agent_run_id` + raw markdown output
- enforces output contract + tool budgets
- writes prompts/outputs/sidecars deterministically into the run root
- uses retry directives + `deep_research_retry_record` for bounded retries

## Constraints
- Preserve determinism boundary: orchestrator tools stay deterministic; driver is the dynamic seam.
- Record all driver inputs (prompt, directives, budgets) in run artifacts.

## Deliverables
- New driver implementation selectable for live runs (keep operator-input as fallback).
- Driver writes:
  - `operator/prompts/<stage>/<perspective>.md`
  - `operator/outputs/<stage>/<perspective>.md`
  - metadata sidecar: `agent_run_id`, prompt digest, retry directive digest

## Tests / Verification
- Deterministic tests using stub driver outputs (no real agent calls in CI).
- Manual canary runbook demonstrating Task-backed driver in OpenCode runtime.

## Acceptance criteria
- M2 canary reaches `pivot` without manual file editing.
- Retry directives are recorded and only failing perspectives rerun.

## Validator gates
- Architect PASS, QA PASS.
