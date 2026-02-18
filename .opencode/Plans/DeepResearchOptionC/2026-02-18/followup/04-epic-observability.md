# Epic E4 — Tick ledger + telemetry defaults

Status: DONE

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (observability sections + “derive progress from artifacts”)
- Architect: `../architect-review-raw-2.md` (tick ledger requirement + telemetry integration)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e4`
- Epic branch: `ws/epic-e4-observability`

## Target files
- Existing tools:
  - `.opencode/tools/deep_research/telemetry_append.ts`
  - `.opencode/tools/deep_research/run_metrics_write.ts`
- CLI operator loop:
  - `.opencode/pai-tools/deep-research-option-c.ts`
- Logs dir resolution helpers:
  - `.opencode/pai-tools/deep-research-option-c.ts` (safeResolveManifestPath + logs_dir)

## Outcome (what “done” means)
1) Every tick attempt writes a structured ledger entry to `logs/ticks.jsonl`.
2) Operator loop emits telemetry events per tick and periodic run metrics snapshots.
3) Observability does not compromise determinism (timestamps not included in digests; ledger is append-only).

## Bite-sized tasks

### E4-T0 — Define tick ledger schema (v1)
Create a small schema doc under followup (or inline in code):
Fields (minimum):
- `ts` (iso)
- `tick_index`
- `stage_before`, `stage_after`
- `status_before`, `status_after`
- `result.ok`
- `result.error.code` (optional)
- `inputs_digest` (if available)
- `artifacts`: important paths (manifest, gates, any newly-written artifacts)

Acceptance:
- Schema is explicit and referenced from code.

### E4-T1 — Implement tick ledger append helper
Add a helper (suggested location):
- `.opencode/tools/deep_research/tick_ledger_append.ts`

Requirements:
- Append-only JSONL
- Safe logs directory resolution using manifest paths
- Best-effort append is OK, but failures must be visible (telemetry warning or CLI warning line)

Acceptance:
- Tool exists and is exported in `.opencode/tools/deep_research/index.ts` and/or used directly by CLI.

### E4-T2 — Wire tick ledger into CLI `tick` and `run`
Steps:
- In CLI, around each tick execution:
  - ledger entry: start
  - ledger entry: finish
- Ensure we capture the tick result summary and key artifacts.

Acceptance:
- After running any tick, `logs/ticks.jsonl` has new entries.

### E4-T3 — Telemetry defaults
Steps:
- In CLI `tick`/`run`, call `deep_research_telemetry_append`:
  - `stage_started`
  - `stage_finished`
  - `stage_retry_planned` (when applicable)
- Every N ticks (or at stage boundaries), call `deep_research_run_metrics_write`.

Acceptance:
- Run root contains telemetry and metrics artifacts.

### E4-T4 — Tests
Add deterministic entity tests:
- Running a fixture tick produces `logs/ticks.jsonl` entries.
- Telemetry append is invoked (can be verified via artifact or tool output).

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E4-T0 Ledger schema | DONE | Marvin | `36ba9d0` | Added `followup/tick-ledger-schema-v1.md` with required fields and determinism notes. |
| E4-T1 Ledger append helper | DONE | Marvin | `36ba9d0` | Added `.opencode/tools/deep_research/tick_ledger_append.ts` and exported in tool index. |
| E4-T2 CLI wiring | DONE | Marvin | `36ba9d0` | CLI `tick`/`run` now appends `logs/ticks.jsonl` start+finish entries for every tick attempt. |
| E4-T3 Telemetry wiring | DONE | Marvin | `36ba9d0` | CLI now emits `stage_started`/`stage_finished`/conditional `stage_retry_planned` and writes `run-metrics.json`. |
| E4-T4 Tests | DONE | Marvin | `36ba9d0` | Added `deep_research_tick_ledger_cli.test.ts`; validates ledger + telemetry + metrics artifacts. |
| Architect PASS | DONE | Marvin | `36ba9d0` | Observability writes isolated to logs/metrics; gate/manifest digests unchanged by ledger timestamps. |
| QA PASS | DONE | Marvin | `36ba9d0` | `bun test ./.opencode/tests` and `bun Tools/Precommit.ts` passed in this worktree. |

## Validator gates

### Architect gate
- Confirms ledger/telemetry do not change deterministic gate digests.
- Confirms logs directory containment is safe.

### QA gate
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e4"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
