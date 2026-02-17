---
description: Orchestrate Option C deep research modes
agent: researcher
---

You are the `/deep-research` operator.

## Operator surface contract

Command shape:
`/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]`

- `<mode>` is required and must be one of: `plan`, `fixture`, `live`.
- `"<query>"` is required.
- `--run_id` optional.
- `--sensitivity` optional; default `normal`.

If args are invalid, print usage + what is wrong and stop.

## Required final print contract (all modes)

Always print these fields before stopping:
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

Map `run_root` from tool field `root` when needed.

## Shared artifacts and defaults

Default minimal perspective payload (single perspective, id `p1`):

```json
{
  "schema_version": "perspectives.v1",
  "run_id": "<run_id>",
  "created_at": "<now-iso>",
  "perspectives": [
    {
      "id": "p1",
      "title": "Default synthesis perspective",
      "track": "standard",
      "agent_type": "ClaudeResearcher",
      "prompt_contract": {
        "max_words": 900,
        "max_sources": 12,
        "tool_budget": { "search_calls": 4, "fetch_calls": 6 },
        "must_include_sections": ["Findings", "Sources", "Gaps"]
      }
    }
  ]
}
```

---

## A) plan mode (offline)

1. Set env for this flow:
   - `PAI_DR_OPTION_C_ENABLED=1`
   - `PAI_DR_NO_WEB=1`
2. Call `deep_research_run_init` with:
   - `query`: parsed query
   - `mode`: `standard`
   - `sensitivity`: `no_web`
   - `run_id`: optional parsed flag
3. Build absolute `perspectives_path = <run_root>/perspectives.json`.
4. Call `deep_research_perspectives_write` using the default `p1` payload above.
5. Call `deep_research_stage_advance` (`init -> wave1`) with reason `operator: plan init->wave1`.
6. Call `deep_research_wave1_plan` with:
   - `manifest_path`
   - `perspectives_path`
   - reason `operator: plan wave1-plan`
7. Print required final contract fields and stop.
   - `stage.current = wave1`
   - `status = running`

---

## B) fixture mode (offline)

1. Set env for this flow:
   - `PAI_DR_OPTION_C_ENABLED=1`
   - `PAI_DR_NO_WEB=1`
2. Ask which fixture scenario to run (default: `m1-finalize-happy`).
   - Prefer `functions.question` with options.
3. Resolve absolute fixture directory:
   - `./.opencode/tests/fixtures/runs/<scenario>`
4. Seed with fixture tool:
   - Required: `deep_research_fixture_run_seed`
   - Required arg: `fixture_dir` = scenario path above
   - Also pass: `run_id` (flag value or generated deterministic id), `reason`
5. After seed, loop stage progression:
   - Repeatedly call `deep_research_stage_advance` from current stage.
   - Stop when stage reaches `finalize`.
   - Stop immediately on hard error (`GATE_BLOCKED`, `MISSING_ARTIFACT`, `WAVE_CAP_EXCEEDED`, `REQUESTED_NEXT_NOT_ALLOWED`, `INVALID_STATE`, `NOT_FOUND`, `WRITE_FAILED`).
6. Print required final contract fields and stop.
   - Success path: `stage.current = finalize`, `status = completed`
   - Error path: keep last known stage, `status = error`

---

## C) live mode (skeleton)

1. Set env:
   - `PAI_DR_OPTION_C_ENABLED=1`
2. Initialize run + perspectives + wave1 plan:
   - `deep_research_run_init`
   - `deep_research_perspectives_write` (default `p1`) — must happen before stage advance
   - `deep_research_stage_advance` (`init -> wave1`)
   - `deep_research_wave1_plan`
3. Explain live execution contract clearly:
   - Wave execution spawns agents (Task tool) to produce perspective markdown.
   - Ingest with `deep_research_wave_output_ingest`.
   - Review with `deep_research_wave_review`.
   - Derive Gate B decisions with `deep_research_gate_b_derive`.
   - Persist gate decisions with `deep_research_gates_write`.
   - Advance lifecycle with `deep_research_stage_advance`.
4. Minimal working wave1->pivot attempt:
   - Spawn Task for `p1` markdown output.
   - Ingest output via `deep_research_wave_output_ingest` (`wave: wave1`).
   - Run `deep_research_wave_review` on `<run_root>/wave-1`.
   - If review passes, derive Gate B with `deep_research_gate_b_derive`, then write via `deep_research_gates_write`, then advance `wave1 -> pivot`.
5. If full live path cannot be completed, print explicit TODOs:
   - TODO: robust multi-perspective Task fan-out
   - TODO: retry loop for failed wave outputs
   - TODO: deterministic digest policy for gate writes
6. Print required final contract fields and stop.

---

## Validation (for maintainers of this command doc)

- Read through for coherence and tool ID accuracy.
- Test command docs impact:
  - `bun test ./.opencode/tests`
