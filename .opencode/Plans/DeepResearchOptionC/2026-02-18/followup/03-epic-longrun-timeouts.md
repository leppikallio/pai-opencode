# Epic E3 — 1h+ long-run timeout semantics

Status: DONE

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (see long-run strategy + watchdog guidance)
- Architect: `../architect-review-raw-2.md` (see “Stage watchdog defaults incompatible with 1h+ runs” + recommendations)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e3`
- Epic branch: `ws/epic-e3-longrun-timeouts`

## Target files
- Timeout constants: `.opencode/tools/deep_research/lifecycle_lib.ts`
- Watchdog enforcement: `.opencode/tools/deep_research/watchdog_check.ts`
- Manifest writer: `.opencode/tools/deep_research/manifest_write.ts`
- Orchestrators (to emit progress):
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts`

## Outcome (what “done” means)
Long-running live stages do not fail deterministically just because they take > 10 minutes.

Two acceptable designs (choose one):
1) **Mode-based timeouts**: manifest.mode=`deep` -> longer stage timeouts.
2) **Progress heartbeat**: watchdog uses “time since last progress” rather than “time since stage start.”

## Bite-sized tasks

### E3-T0 — Choose timeout semantics + write policy note
Create: `.opencode/Plans/DeepResearchOptionC/2026-02-18/followup/E3-timeout-policy.md`
Include:
- chosen design (mode-based vs heartbeat)
- why
- what fields are authoritative
- how it preserves determinism

Acceptance:
- Policy doc exists and is linked from this epic.
- Policy: `./E3-timeout-policy.md`

### E3-T1 — Implement chosen semantics

If mode-based:
- Extend `lifecycle_lib.ts` to compute stage timeouts using manifest.mode.
- Ensure the chosen values are explicit (no “magic multipliers”).

If heartbeat-based:
- Add a new field to manifest stage (example):
  - `manifest.stage.last_progress_at` (ISO)
- Implement a deterministic progress update tool or use `manifest_write` patches from orchestrators.
- Update `watchdog_check.ts` to:
  - use `last_progress_at ?? stage.started_at` as the timer origin
  - keep PAUSED behavior unchanged

Acceptance:
- Watchdog no longer fails a stage if progress is being emitted.

### E3-T2 — Emit progress from orchestrators
Goal: define “progress” points and emit them consistently.

Minimum progress events (suggested):
- after each wave output ingested (wave1/wave2)
- after citations validated
- after summary-pack built
- after synthesis written
- after review iteration completes

Implementation notes:
- Keep progress writes deterministic: writing a timestamp is fine, but don’t include it in any digest inputs.

Acceptance:
- A synthetic long stage in tests can keep watchdog satisfied.

### E3-T3 — Tests
Add entity tests:
1) **Heartbeat prevents timeout**:
   - seed a manifest with `stage.started_at` far in the past
   - set `last_progress_at` recent
   - `watchdog_check` should return `timed_out=false`
2) **No progress still times out**:
   - both timestamps old
   - should `timed_out=true` and checkpoint written

Acceptance:
- `bun test ./.opencode/tests` passes.

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E3-T0 Policy doc | DONE | Marvin | pending | `followup/E3-timeout-policy.md` |
| E3-T1 Implementation | DONE | Marvin | pending | heartbeat watchdog + stage heartbeat schema/write support |
| E3-T2 Progress emission | DONE | Marvin | pending | progress writes in live/post-pivot/post-summaries orchestrators |
| E3-T3 Tests | DONE | Marvin | pending | watchdog heartbeat/no-progress tests + full `.opencode/tests` pass |
| Architect PASS | TODO |  |  |  |
| QA PASS | DONE | Marvin | pending | `bun test ./.opencode/tests`, `bun Tools/Precommit.ts` |

## Validator gates

### Architect gate
- Confirms determinism is preserved and stage digests aren’t polluted by timestamps.

### QA gate
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e3"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
