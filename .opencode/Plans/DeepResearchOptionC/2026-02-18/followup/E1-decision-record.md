# E1 Decision Record — Production `runAgent` driver

Date: 2026-02-18
Epic: `01-epic-production-runagent-driver.md`
Branch: `ws/epic-e1-runagent-driver`

## Decision

Choose **Option A: assistant-orchestrated driver**.

## Why this option

1. **Feasible in this repo/runtime now**
   - `orchestrator_tick_live` already exposes a `drivers.runAgent` seam and only requires a structured return.
   - The existing live path already wires `drivers: { runAgent: driver }` from `deep-research-option-c.ts`.
2. **No OpenCode runtime API changes required**
   - Option C would require runtime/tooling changes outside this repository.
3. **Lower environment risk than local inference shelling**
   - Option B adds a second generation path that is harder to keep behaviorally consistent across environments.
4. **Fits deterministic boundary model**
   - Deterministic tools/orchestrator remain unchanged; driver remains the dynamic seam.

## Evidence from repo inspection

- Driver seam and required types:
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts`
  - `OrchestratorLiveRunAgentInput` (run/stage/run_root/perspective/agent/prompt/output fields)
  - `OrchestratorLiveRunAgentResult` (requires non-empty `markdown`; optional `agent_run_id`, `started_at`, `finished_at`)
- Current live wiring:
  - `.opencode/pai-tools/deep-research-option-c.ts`
  - `createOperatorInputDriver()` is manual (`readline`, edit draft, press ENTER)
  - live ticks pass `drivers: { runAgent: driver }` into `orchestrator_tick_live`
- Current command contract confirms manual live mode:
  - `.opencode/commands/deep-research.md` (`run --driver live` with operator draft editing)

## Constraints carried forward

- Keep orchestrator tick functions idempotent/resumable.
- Persist driver inputs/outputs in run-root artifacts.
- Preserve deterministic CI tests with no network requirement.

## Follow-on implication for E1-T1+

- Define and document a stable artifact contract for:
  - `operator/prompts/<stage>/<perspective_id>.md`
  - `operator/outputs/<stage>/<perspective_id>.md`
  - `operator/outputs/<stage>/<perspective_id>.meta.json`
- Include `agent_run_id`, prompt and retry digests, and timing fields so replay/audit can be validated deterministically.
