# Deep Research Option C — 2026-02-19 Plan

Scope: **Plan + status** (this file is kept in sync with repo reality).

Note: **Epic 3 (known-issues fixes) is already implemented** in this repo; remaining work is Epic 1–2 and Epic 4.

This plan targets **exactly** the three requested outcomes:

1) **Remove `/deep-research` slashcommand docs** and move operator logic into a **single unified skill** (merging the two existing deep-research skills).
2) **Refactor the operator CLI** so each module is ~500 lines (meaningful splits).
3) **Fix known issues immediately** (Wave2 synthetic markdown + stage routing bug).

Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`

## Current reality (evidence)

- Slashcommand docs: removed (`.opencode/commands/deep-research*.md` no longer present)
- Operator CLI (bloated): `.opencode/pai-tools/deep-research-option-c.ts` (**3667 lines**)
- Deep research tools surface: `.opencode/tools/deep_research_cli/index.ts`
- Two skills (must be merged):
  - `.opencode/skills/deep-research-option-c/`
  - `.opencode/skills/deep-research-production/`
- Previously validated known issues (now resolved):
  1) Wave2 markdown was synthetic (example.com)
     - Resolved by task-driver seam + ingestion contract.
     - Evidence: `.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts`
  2) CLI tick routing for `stage=wave2` was incorrect
     - Resolved by correct stage routing + regression coverage.
     - Evidence: `.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts`

Additional seams already implemented (beyond original known-issues scope):
- Summaries task-driver: `.opencode/tests/entities/deep_research_operator_cli_summaries_task_driver.test.ts`
- Synthesis task-driver: `.opencode/tests/entities/deep_research_operator_cli_synthesis_task_driver.test.ts`

---

## Ideal State Criteria (ISC) — binary completion gates

### Global ISC

- [x] **Slashcommand deprecated; unified skill provides full logic now**
- [x] **Deep research skills merged into single canonical skill**
- [ ] **Operator CLI refactored into modules under 500 lines**
- [x] **Wave2 prompts real; no synthetic example.com markdown remains**
- [x] **CLI tick routes wave2 stage to post-pivot correctly**
- [ ] **Architect and QA gates pass before completion always**
- [ ] **Test suite passes after refactor and fixes implemented**

### Definition of DONE (program-level)

The work is not “done” until:

1) **Architect Gate = PASS** (design/contract sign-off) and
2) **QA Gate = PASS** (tests + targeted regressions) and
3) All Global ISC items above are checked.

---

## Execution model (subagent-driven, with gates)

This is written for an **orchestrator** that can spawn subagents:

- **Architect**: approves contracts + module boundaries + compatibility strategy.
- **Engineer(s)**: implement scoped tasks (builders).
- **QATester**: runs verification contracts and signs QA gate (validator).

### Orchestrator rule: Builder → Architect/QA gates

For every task:
1) Builder implements + self-verifies with the task’s validation contract.
2) Architect reviews any contract/schema/API/module-boundary changes.
3) QA runs tests and produces evidence.

### Orchestrator: recommended composition patterns

- Use **Pipeline** for contract-first work: `Architect → Engineer → QATester`.
- Use **Fan-out** for independent workstreams (docs/skill merge vs CLI refactor vs bugfix).
- Use **Pair** (builder+validator) on high-risk tasks (routing + wave2 changes).

---

## Progress tracker (update during implementation)

Statuses: `TODO | IN_PROGRESS | DONE | ARCH_PASS | QA_PASS | BLOCKED(<reason>)`

| ID | Item | Owner | Status | Evidence (command/output/path) | Notes |
|---|---|---|---|---|---|
| E1 | Remove `/deep-research` slashcommand docs | Eng | DONE | `.opencode/commands/` is empty | Slashcommand surface removed |
| E2 | Merge skills into one canonical skill | Eng/Writer | DONE | `.opencode/skills/deep-research/` + stubbed legacy skills | Canonical skill is operator source-of-truth |
| E3 | Fix: wave2 stage routed incorrectly | Eng | DONE | `.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts` | Covered by entity tests |
| E4 | Fix: wave2 synthetic markdown (example.com) | Eng | DONE | `.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts` | Task-driver seam + ingestion |
| E4b | Add: summaries+synthesis task-driver seams | Eng | DONE | `.opencode/tests/entities/deep_research_operator_cli_{summaries,synthesis}_task_driver.test.ts` | Extra hardening beyond initial bug list |
| E5 | Refactor CLI into ~500-line modules | Eng | TODO |  | No behavior change except E3/E4; tests must stay green |
| G-ARCH | Architect gate | Architect | TODO |  | PASS required before QA gate |
| G-QA | QA gate | QATester | TODO |  | PASS required before completion |

---

## EPIC 1 — Remove `/deep-research` slashcommand docs; skills replace logic

### Goal

- `/deep-research` command docs are removed, and the **unified skill** becomes the operator surface.

### Design decision (Architect) — required early

**D1 (recommended):** Create a canonical skill named **`deep-research`** and keep the two old skills as *deprecated aliases*.

Rationale:
- Avoids breaking any existing installs or docs that reference the old skill IDs.
- Still achieves “single source of truth” because all real workflows live in one place.

### Tasks

#### E1-T1 — Ensure operator contract lives in the canonical skill

**Builder changes**
- Ensure the canonical operator surface contract is present inside the canonical skill:
  - `.opencode/skills/deep-research/SKILL.md`
  - and/or `.opencode/skills/deep-research/Workflows/*`

**Validation contract**
- `rg -n "Operator surface contract|plan \(offline-first\)|Required final print contract" .opencode/skills/deep-research -S` finds the canonical guidance.

#### E1-T2 — Remove `.opencode/commands/deep-research*.md` (slashcommand surface)

**Builder changes**
- Delete `.opencode/commands/deep-research.md` and `.opencode/commands/deep-research-status.md`.

**Validation contract**
- `test ! -f .opencode/commands/deep-research.md`
- `test ! -f .opencode/commands/deep-research-status.md`

#### E1-T3 — Update references that pointed at deleted slashcommand docs

**Builder changes**
- Replace references to `.opencode/commands/deep-research*.md` with:
  - `.opencode/skills/deep-research/SKILL.md` (canonical)
  - `.opencode/Plans/DeepResearchOptionC/deep-research-option-c-progress-tracker.md` (progress tracker)

**Validation contract**
- `rg -n "commands/deep-research(\.md|-status\.md)" .opencode/skills .opencode/commands -S` returns **0 matches**.
- (Optional hygiene) Historical plans may still reference the removed docs; avoid updating history unless needed.

---

## EPIC 2 — Merge the two deep-research skills into one

### Goal

- There is **one canonical deep-research skill** that contains:
  - CLI mechanics (init/tick/run/inspect/triage/pause/resume)
  - production operator behavior (perspectives authoring, wave execution policy, citations ladder policy, synthesis/review loop)

### Current state (why two exist)

From the existing skill headers:
- `deep-research-option-c`: “CLI mechanics / operator surface”
- `deep-research-production`: “production playbook / quality contracts”

This split made sense for incremental rollout but now creates duplication and routing ambiguity.

### Tasks

#### E2-T1 — Create canonical skill `deep-research`

**Builder changes**
- Add `.opencode/skills/deep-research/SKILL.md` describing:
  - primary surface = skill workflows (not slashcommand)
  - canonical CLI entrypoint (still used for actual execution)
  - no-env-var + scratchpad policy
- Merge workflows from both skills into `.opencode/skills/deep-research/Workflows/`:
  - RunPlan
  - DraftPerspectivesFromQuery
  - RunWave1WithTaskDriver
  - OnlineCitationsLadderPolicy
  - SynthesisAndReviewQualityLoop
  - RunFixtureToFinalize
  - TickUntilStop
  - PauseRun / ResumeRun

**Validation contract**
- `eza -la .opencode/skills/deep-research/Workflows` shows all merged workflows.
- No workflow references the deprecated slashcommand as a primary surface.

#### E2-T2 — Deprecate the two old skills (compatibility stubs)

**Builder changes**
- Update `.opencode/skills/deep-research-option-c/SKILL.md` and `.opencode/skills/deep-research-production/SKILL.md`:
  - mark as “DEPRECATED — use `deep-research`”
  - keep minimal pointers to the canonical workflows
  - remove duplicated “source-of-truth” content

**Validation contract**
- `rg -n "DEPRECATED" .opencode/skills/deep-research-*/SKILL.md -n` shows both stubs.
- `rg -n "name: deep-research$" .opencode/skills/deep-research/SKILL.md -n` confirms canonical ID.

#### E2-T3 — Update references across plans/docs

**Builder changes**
- Replace references to `deep-research-production` and `deep-research-option-c` (when meaning “the skill”) with `deep-research`.
- Keep references to the CLI path unchanged.

**Validation contract**
- `rg -n "deep-research-production" .opencode -S` returns only historical docs (or none, if you choose to update all).

### Architect Gate input

Architect confirms:
- canonical skill ID choice
- compatibility strategy (stubs vs deletion)
- that skill text is now the operator source-of-truth

---

## EPIC 3 — Fix known issues immediately

### Issue A — `stage=wave2` routed incorrectly by CLI tick

#### E3-T1 — Fix `runOneOrchestratorTick` stage routing

Status: **DONE** (see progress tracker E3).

**Builder changes**
- In `.opencode/pai-tools/deep-research-option-c.ts`, update `runOneOrchestratorTick` so:
  - `stage ∈ { pivot, wave2, citations }` routes to `orchestrator_tick_post_pivot`
  - `stage ∈ { summaries, synthesis, review, finalize }` routes to `orchestrator_tick_post_summaries`
  - `stage ∈ { init, wave1 }` routes to `orchestrator_tick_live`

**QA validation contract**
- Add a regression entity test that forces `manifest.stage.current="wave2"` and asserts the correct tick path is used.
- Run: `bun test ./.opencode/tests/entities` (or the most specific new test) → **PASS**.

### Issue B — Wave2 markdown is synthetic (example.com)

#### E4-T1 — Remove synthetic Wave2 markdown generation

Status: **DONE** (see progress tracker E4).

**Builder changes**
- In `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`, stop producing placeholder Wave2 outputs by default.
- Replace “synthetic wave2 markdown” with a **real agent seam**:
  - Wave2 work items are prompt-out tasks derived from pivot gaps.
  - Outputs must be ingested deterministically as artifacts under `wave-2/`.

**Implementation shape (recommended)**
- Extend the existing **task-driver** pattern beyond Wave1:
  - `tick --driver task` when `stage.current=wave2`:
    - write prompts to `operator/prompts/wave2/<gap_id>.md`
    - halt with `RUN_AGENT_REQUIRED` + `next_commands[]` skeletons
  - Extend `agent-result` to accept `--stage wave2`:
    - write `wave-2/<gap_id>.md` + `wave-2/<gap_id>.meta.json`
  - Only after all gaps are ingested should the deterministic pipeline stage-advance toward citations.

**QA validation contract**
- Add an entity test that:
  1) seeds a run that requires wave2,
  2) runs `tick --driver task` and observes prompt-out + halt,
  3) ingests at least one gap via `agent-result --stage wave2`,
  4) resumes and verifies stage progression.
- Add a targeted check that `example.com` is not emitted:
  - `rg -n "example\.com/wave2" <run_root>` → **0 matches**.

---

## EPIC 4 — Refactor the operator CLI into ~500-line modules

### Goal

Make `.opencode/pai-tools/deep-research-option-c.ts` maintainable by LLMs:

- Keep the **same entrypoint path** (backwards compatible)
- Split implementation into meaningful modules (~500 LOC each)
- Keep behavior unchanged **except** where E3/E4 require fixes

### Proposed module map (Architect must approve)

Create a directory:

`/.opencode/pai-tools/deep-research-option-c/`

Recommended modules (names illustrative; final names decided in Architect gate):

1) `main.ts` — CLI boot + dispatch (thin)
2) `cmd/*.ts` — one file per command (init/tick/run/agent-result/status/inspect/triage/pause/resume/...)
3) `drivers/*.ts` — `fixture`, `live`, `task` drivers (prompt-out + halt + resume)
4) `run-handle.ts` — resolving `run_id`, `runs_root`, paths
5) `io/*.ts` — JSON output envelope + human printing + error formatting
6) `halt/*.ts` — halt artifact schema, writer, helpers
7) `validation/*.ts` — shared validators (absolute paths, run-root containment, schema checks)
8) `utils/*.ts` — small helpers (digest, timestamps, file ops wrappers)

Entrypoint strategy (compatibility):
- Keep `.opencode/pai-tools/deep-research-option-c.ts` as the executable entry, but reduce it to a thin wrapper that imports and calls `main()`.

### Refactor steps (safe, test-driven)

#### E5-T1 — Extract structure without logic change

Order:
1) Create new module directory + move **pure helpers** first (no behavior change).
2) Extract each command handler one-by-one.
3) Extract driver logic (live/task/fixture) last.

**Validation contract (every step)**
- Run the smallest relevant test set after each extraction:
  - `bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts`
  - `bun test ./.opencode/tests/entities/deep_research_operator_cli_task_driver.test.ts`
- After the full refactor: `bun test ./.opencode/tests` → **PASS**.

#### E5-T2 — Enforce the “~500 LOC per module” constraint

**Builder changes**
- Ensure each newly created module stays roughly ≤ 500 lines.
- If a file must exceed 500 lines, require an Architect-approved justification comment at top:
  - `// EXCEPTION: >500 lines because ... (Architect approved)`

**Validation contract**
- `wc -l .opencode/pai-tools/deep-research-option-c/**/*.ts` shows no egregious outliers.

### QA Gate (after Epic 3 + Epic 4)

QA must produce evidence:
- `bun test ./.opencode/tests` → PASS
- Targeted wave2 tests (new) → PASS
- At least one smoke test:
  - `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts` (if stable in CI) → PASS

---

## Orchestrator instructions (concrete subagent prompts)

### Step 0 — Architect preflight (required)

Spawn **Architect** with:

1) Canonical skill strategy (`deep-research` + deprecated stubs)
2) CLI module map approval
3) Stage routing truth table approval
4) Wave2 seam strategy approval (task-driver extension vs tool-only)

Architect output must include:
- approved module list + ownership boundaries
- approved compatibility plan (what stays, what deprecates)

### Step 1 — Engineers (parallel where safe)

Fan-out engineers into three independent builders:

- Eng A: Epic 1–2 (slashcommand deprecation + skill merge)
- Eng B: Epic 3 (bug fixes + tests)
- Eng C: Epic 4 (CLI refactor, after Eng B lands or in a worktree)

### Step 2 — QA gate (required)

Spawn **QATester** to run:

- `bun test ./.opencode/tests`
- plus any targeted new entity tests for wave2 + routing

QA must report PASS/FAIL with command output evidence.

---

## Notes / Inputs to reuse

This directory already contains two orchestrator-ready plans with deeper detail:

- `architect-review-raw-plan.md`
- `engineer-review-raw-plan.md`

During implementation, engineers should reuse those plans for the deeper “task-driver beyond wave1” scaffolding, but **this file is the authoritative plan for the three requested epics**.
