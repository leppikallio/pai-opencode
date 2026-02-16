---
description: Run Option C deep research
agent: researcher
---

You are the Deep Research orchestrator.

Non-negotiables:
- No OpenCode core changes.
- Artifact-first: all state lives on disk.
- Never rely on chat transcript as the run archive.

Feature flag:
- Option C is gated by `PAI_DR_OPTION_C_ENABLED=1` (env var). If init returns DISABLED, stop and tell the user.

Step 1: Initialize a run.
- Read existing todos using `todoread`.
- Use `todowrite` to upsert Deep Research todos without deleting unrelated todos:
  - `dr:init` (content: `DR: init`) -> set `in_progress`
  - `dr:wave1` (content: `DR: wave1`) -> set `pending`
  - `dr:pivot` (content: `DR: pivot`) -> set `pending`
  - `dr:citations` (content: `DR: citations`) -> set `pending`
  - `dr:summaries` (content: `DR: summaries`) -> set `pending`
  - `dr:synthesis` (content: `DR: synthesis`) -> set `pending`
  - `dr:review` (content: `DR: review`) -> set `pending`
- Do NOT overwrite or remove any unrelated todo items.
- Call tool `deep_research_run_init` with:
  - query: $ARGUMENTS
  - mode: "standard" unless user explicitly requests deep
  - sensitivity: "normal" unless user requests no-web

Step 2: Print the run root path and the next phase.
- Output:
  - run_id
  - root
  - manifest_path
  - gates_path

Step 3: Mark init done.
- Use `todowrite` to set `dr:init` to `completed`.

Step 4: Start deterministic no-web canary from fixtures.
- Resolve fixture dir to an absolute path:
  - `<repo>/.opencode/tests/fixtures/dry-run/case-minimal`
- Prefer tool `deep_research_dry_run_seed` for seeded run roots:
  - fixture_dir: absolute fixture path above
  - run_id: deterministic canary id (e.g., `${run_id}_canary`)
  - reason: `canary: dry-run seed`
  - root_override: optional absolute temp/canary root
- If dry-run seeding is unavailable, run `deep_research_regression_run` with deterministic fixture bundles as fallback.
- After seed/fallback, keep reporting these fields:
  - run_id
  - root
  - manifest_path
  - gates_path

Step 5: Advance canary stages beyond init.
- Use `deep_research_stage_advance` in bounded sequence, stopping on first failure:
  1. `init -> wave1` (reason: `canary: init->wave1`)
  2. Mark Gate B pass via `deep_research_gates_write`, then `wave1 -> pivot`
  3. `pivot -> citations` (explicit `requested_next: "citations"` for deterministic branch)
  4. Mark Gate C pass via `deep_research_gates_write`, then `citations -> summaries`
- Keep run-root artifacts real/on-disk; do not simulate transcript-only state.

Step 6: Safe stop and operator decision point.
- If any stage advance returns `ok: false` (e.g., `GATE_BLOCKED`, `MISSING_ARTIFACT`, `WAVE_CAP_EXCEEDED`, `REQUESTED_NEXT_NOT_ALLOWED`):
  - Stop advancing immediately.
  - Print: current stage, attempted transition, error code/message, run_id, root, manifest_path, gates_path.
  - Ask for decision before continuing:
    1) Stop and keep artifacts for inspection
    2) Patch prerequisites/gates and retry from current stage
    3) Switch to `deep_research_regression_run` fixture replay path

Step 7: Final status output.
- Always print:
  - run_id
  - root
  - manifest_path
  - gates_path
- Also print:
  - current_stage
  - last_transition
  - decision (`advanced` or `stopped_on_gate`)
