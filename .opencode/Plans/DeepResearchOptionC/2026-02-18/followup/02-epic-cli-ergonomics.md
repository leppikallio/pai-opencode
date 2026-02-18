# Epic E2 — Operator CLI ergonomics (resume-first)

Status: TODO

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (see P0.1/P0.2/P1.1 sections)
- Architect: `../architect-review-raw-2.md` (see CLI deltas: derive gates, `--until`, enrich inspect, cancel)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e2`
- Epic branch: `ws/epic-e2-cli-ergonomics`

## Target files (where changes will land)
- Operator CLI: `.opencode/pai-tools/deep-research-option-c.ts`
- Deterministic helpers referenced by CLI:
  - `.opencode/tools/deep_research/lifecycle_lib.ts`
  - `.opencode/tools/deep_research/manifest_write.ts`
  - `.opencode/tools/deep_research/stage_advance.ts`

## Outcomes (what “done” means)
The CLI becomes “run-id-first, resume-first”:
1) Every subcommand can take `--run-id` OR `--run-root` and resolve manifest/gates paths automatically.
2) `tick`/`run` do not require `--gates`; they can derive from manifest.
3) `run --until <stage|finalize>` exists.
4) `cancel` exists, writes a checkpoint, and orchestrators treat it as terminal.
5) If a tick/run is blocked, CLI prints a compact blockers summary automatically.
6) `inspect` surfaces operator guidance:
   - citations blocked URLs (if present)
   - retry directives (if present)
   - latest online fixtures pointer (if present)

## Bite-sized tasks

### E2-T0 — Add run-handle resolver (`run-id` / `run-root`)
Goal: introduce a single resolver used by *all* commands.

Implementation sketch:
- Add a helper `resolveRunHandle({ runId?, runRoot?, manifest?, gates? })` that returns:
  - `run_root`
  - `manifest_path`
  - `gates_path`
- Resolution rules:
  1) if `--manifest` provided: read manifest, derive run_root + gates_path
  2) else if `--run-root` provided: use `run_root/manifest.json` and derive gates via manifest
  3) else if `--run-id` provided: compute run root under `resolveDeepResearchFlagsV1().runsRoot` (or derive from `PAI_DR_RUNS_ROOT` if that’s the chosen root), then same as run-root path

Acceptance:
- `status/inspect/triage/pause/resume/tick/run` can operate with only `--run-id`.

### E2-T1 — Make `--gates` optional everywhere
Goal: reduce operator friction.

Steps:
- Update cmd-ts arg definitions for `tick`/`run` to accept optional `--gates`.
- Implement derivation:
  - read manifest and resolve `manifest.artifacts.paths.gates_file` via existing safe path resolution.

Acceptance:
- `tick --manifest <abs> --reason ... --driver fixture` works without `--gates`.

### E2-T2 — Add `run --until <stage|finalize>`
Goal: run loop can stop at stage boundaries (M2 wants stop at pivot; M3 wants stop at finalize).

Steps:
- Add cmd-ts option `--until`.
- In `run`, after each tick, read manifest and stop if:
  - `manifest.stage.current === until`, OR
  - terminal status reached.

Acceptance:
- Manual runbook can stop at `pivot` reliably.

### E2-T3 — Add `cancel` command
Goal: productize cancellation for long runs.

Steps:
- Implement `cancel` subcommand:
  - acquire run lock
  - `manifest_write` patch: `{ status: "cancelled" }`
  - write `logs/cancel-checkpoint.md` with stage + reason + next steps
- Update orchestrator tick entrypoints to early-return terminal when cancelled (pattern used for paused).

Acceptance:
- After cancel, `run` stops immediately and reports status.

### E2-T4 — Auto-triage on block
Goal: whenever tick/run fails, print compact blockers summary.

Steps:
- In `tick` and `run`, when a tick result is `ok:false`, call the existing dry-run stage-advance triage and print:
  - requested transition (`from` -> `to`)
  - missing artifacts (path)
  - blocked gates
  - remediation hint text

Acceptance:
- Operators do not need to remember `triage` manually.

### E2-T5 — Enrich `inspect`
Goal: surface the next action when citations are blocked or retries exist.

Steps:
- If present under run root:
  - `citations/blocked-urls.json`
  - `retry/retry-directives.json`
  - `citations/online-fixtures.latest.json` (or equivalent pointer)
- Print concise “what to do next” sections.

Acceptance:
- A blocked citations run shows actionable items in `inspect` output.

### E2-T6 — Tests + QA
Add entity tests under `.opencode/tests/entities/`:
- run-id resolver behavior
- gates derivation from manifest
- cancel terminal behavior

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E2-T0 Run-handle resolver | DONE | Marvin |  | CLI now resolves `--run-id/--run-root/--manifest` via shared run-handle helper |
| E2-T1 Optional gates | DONE | Marvin |  | `tick`/`run` accept omitted `--gates` and derive from manifest safely |
| E2-T2 `--until` | DONE | Marvin |  | Added `run --until <stage>` boundary stop with contract output |
| E2-T3 `cancel` | DONE | Marvin |  | Added `cancel` command, manifest status mutation, cancel checkpoint artifact |
| E2-T4 Auto-triage | DONE | Marvin |  | `tick`/`run` failures now print compact auto-triage blocker summary |
| E2-T5 Inspect enrich | DONE | Marvin |  | `inspect` now surfaces blocked URLs, retry directives, latest fixtures pointer |
| E2-T6 Tests | DONE | Marvin | `231c35a`, `4a7c2d5`, `848edd3` | Entity tests added; full suite passes after `.opencode` deps install + env snapshot fix |
| Architect PASS | DONE | Marvin | `39b6529` | CLI remains path-safe (`safeResolveManifestPath` uses realpath containment) and policy-safe (`ensureOptionCEnabledForCli` blocks when disabled); cancel writes durable `status=cancelled` checkpoint. |
| QA PASS | DONE | Marvin | `848edd3` | `bun test ./.opencode/tests`: 152 pass, 3 skip, 0 fail; `bun Tools/Precommit.ts` PASS |

## Validator gates

### Architect gate (PASS required)
- Confirm CLI changes do not weaken path containment or determinism.
- Confirm cancel semantics are correct and terminal.

### QA gate (PASS required)
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e2"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
