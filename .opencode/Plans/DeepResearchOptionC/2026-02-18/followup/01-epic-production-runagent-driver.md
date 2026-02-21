# Epic E1 — Production `runAgent` driver (autonomous)

Status: DONE

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (see “P0.7 blessed wave runner” + M2/M3 sections)
- Architect: `../architect-review-raw-2.md` (see “No autonomous in-runtime agent driver” + readiness rubric)
- Decision record: `./E1-decision-record.md`

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e1`
- Epic branch: `ws/epic-e1-runagent-driver`

## Problem statement
The orchestrator supports a `drivers.runAgent` boundary, but the **default live driver is operator-input** (manual edit + ENTER). We need an autonomous driver that can produce wave outputs without manual editing while preserving deterministic orchestration.

## Outcome (what “done” means)
Introduce an autonomous `runAgent` driver that:
1) Produces markdown outputs for each planned perspective
2) Captures `agent_run_id` (or equivalent) and prompt/inputs digests
3) Preserves determinism boundaries: tools remain deterministic; driver is the dynamic seam
4) Integrates with retry directives: only failing perspectives rerun, with `deep_research_retry_record`

## Design constraints (non-negotiable)
- The orchestrator tick functions must remain idempotent and safe to resume.
- Driver inputs must be persisted to the run root:
  - prompt text
  - retry directives applied
  - budgets/constraints used
- CI tests must remain deterministic and **must not require network**.

## Critical design decision (T0)
There are multiple viable implementations; this epic starts with a bounded discovery task.

### Options
**Option A (recommended): “assistant-orchestrated driver”**
- Implemented as a workflow in a new/updated command doc + skill (E7), where Marvin uses `functions.task` to spawn subagents, then ingests outputs using deterministic tools.
- Pros: no new runtime APIs needed.
- Cons: lives in “agent behavior,” not a pure Node CLI.

**Option B: “local inference driver”**
- Implement a driver that shells out to the PAI inference tool (`bun ~/.config/opencode/skills/PAI/Tools/Inference.ts ...`) to generate markdown per perspective.
- Pros: autonomous without Task.
- Cons: adds a new execution path; harder to guarantee identical behavior across environments.

**Option C: “OpenCode runtime driver API”**
- Implement a new internal runtime tool that can spawn agents programmatically.
- Pros: cleanest long-term.
- Cons: may require OpenCode changes outside this repo.

**Deliverable of T0**: pick Option A/B/C and record the choice in this epic (and in the decision log file you create).

## Bite-sized tasks (implementation-ready)

### E1-T0 — Discovery + decision record
**Goal:** Confirm which driver option is feasible in this repo/runtime.

Where to look:
- Orchestrator driver boundary: `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
- CLI operator-input driver: `.opencode/pai-tools/deep-research-option-c.ts`
- Command doc entrypoint: `.opencode/commands/deep-research.md`
- Existing skills and workflows: `.opencode/skills/deep-research-option-c/**`

Steps:
1) `rg "drivers:\s*\{\s*runAgent" .opencode/tools/deep_research_cli/orchestrator_tick_live.ts -n`
2) Identify exactly what the driver must return (type shape).
3) Identify where “agent spawning” can happen today (tooling available in OpenCode runtime vs Node scripts).
4) Write a short decision record file:
   - Create: `.opencode/Plans/DeepResearchOptionC/2026-02-18/followup/E1-decision-record.md`
   - Include: chosen option, rationale, constraints.

Acceptance:
- Decision record exists and is linked from this epic.

### E1-T1 — Driver input/output artifact contract
**Goal:** Define the on-disk artifacts that the driver must write for each perspective.

Create/Update:
- If Option A: add a doc contract under `.opencode/commands/deep-research.md` and/or E7 skill workflow.
- If Option B/C: add a schema doc under `.opencode/Plans/.../followup/`.

Required artifacts per perspective:
- `operator/prompts/<stage>/<perspective_id>.md`
- `operator/outputs/<stage>/<perspective_id>.md` (raw output)
- `operator/outputs/<stage>/<perspective_id>.meta.json` containing:
  - `agent_run_id` (string)
  - `prompt_digest`
  - `retry_directives_digest` (or null)
  - `started_at`, `finished_at`

Acceptance:
- Contract is explicit enough that a new engineer can implement without reading the whole repo.

### E1-T2 — Implement autonomous driver (chosen option)
**Goal:** Implement the driver and integrate it into the live wave orchestration path.

If Option A (assistant-orchestrated):
- Add a new workflow doc (or update E7) that instructs Marvin to:
  1) load perspectives + wave1 plan
  2) spawn one `functions.task` per perspective with a strict validation contract
  3) write outputs to run root
  4) call `.opencode/tools/deep_research_cli/wave_output_ingest.ts` to ingest
  5) run wave review + retry directives loop

If Option B (inference):
- Implement a Node/Bun driver module under `.opencode/pai-tools/` that:
  - calls the inference tool to generate markdown
  - writes artifacts
  - returns results to orchestrator tick.

Acceptance:
- A live run can progress wave1 without manual edits.

### E1-T3 — Deterministic tests + QA harness
**Goal:** Add tests that validate the integration without real agent execution.

Add/Update tests:
- `.opencode/tests/entities/**`:
  - stub driver returns deterministic markdown
  - orchestrator ingests outputs, runs review, derives Gate B, stage advances

Acceptance:
- `bun test ./.opencode/tests` passes.

### E1-T4 — Architect + QA gates
Run validator gates (see below) and record PASS evidence.

## Progress tracker (multi-session)

Update this table as work proceeds.

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E1-T0 Decision record | DONE | Marvin |  | `.opencode/Plans/DeepResearchOptionC/2026-02-18/followup/E1-decision-record.md` |
| E1-T1 Artifact contract | DONE | Marvin |  | `.opencode/commands/deep-research.md` + `.opencode/skills/deep-research-option-c/Workflows/RunLiveWave1ToPivot.md` |
| E1-T2 Implement driver | DONE | Marvin | 5256e8c | Updated `/deep-research live` to document Task-backed Wave 1 driver + artifacts |
| E1-T3 Deterministic tests | DONE | Marvin | 5256e8c | Existing entity tests cover injected `runAgent` boundary + retry directives (`.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts`) |
| E1-T4 Architect PASS | DONE | Marvin |  | PASS (Architect validator): determinism boundary + artifact contract + retry + explicit enablement |
| E1-T4 QA PASS | DONE | Marvin |  | `bun test ./.opencode/tests` => 144 pass, 3 skip, 0 fail; `bun Tools/Precommit.ts` => no leaks |

## Validator gates (must PASS)

### Architect gate
Architect must confirm:
- determinism boundary is preserved
- artifacts are sufficient for replay/audit
- retry directives are properly consumed and recorded

Architect evidence must include file pointers.

### QA gate
QA must run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e1"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
and attach outputs.
