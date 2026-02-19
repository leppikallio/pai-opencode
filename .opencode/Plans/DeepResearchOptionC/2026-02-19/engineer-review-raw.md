# Deep Research Option C — Engineer Review (DEEP)

Date: 2026-02-19  
Repo: `/Users/zuul/Projects/pai-opencode-graphviz` (branch: `graphviz`)  
Scope: concrete, implementation-minded review of the **current Option C pipeline**, with proposals to make it pleasant, efficient, and iteration-friendly for real research.

---

## Executive summary

Option C’s **deterministic core is already strong** (typed stage machine + gates + bounded artifacts), but the “pleasant for real research” experience is blocked by three practical gaps:

1) **The live agent seam isn’t first-class**: the core orchestrators expect a `drivers.runAgent`, but the CLI’s `--driver live` currently uses an **operator-input/manual draft driver** (`createOperatorInputDriver()` in `.opencode/pai-tools/deep-research-option-c.ts`), not a Task-backed research driver. That makes real runs slow, manual, and error-prone.

2) **Iteration primitives exist but aren’t wired into an operator loop**: fixture capture is present (`fixture_bundle_capture`), online citation fixtures exist (`citations/online-fixtures.*.json`), retry directives exist (`retry/retry-directives.json`), but the UX doesn’t yet make “rerun only what changed” the default mental model.

3) **Config and observability are close, but not cohesive**: there’s `run-config.json` written by the CLI and audit/telemetry/ledger writers, yet operators still face “which config is authoritative?” and “what do I do next?” moments.

### P0 improvements (biggest time-waste killers)

- **Make Task-backed `runAgent` a first-class operator path** with a stable artifact contract and partial rerun controls (details below). (No OpenCode changes required; this can be implemented in Option C tooling + production skill workflows.)
- **Digest-aware caching** for wave outputs: do not skip reruns just because `<p>.md` exists—skip only if `prompt_digest` matches current plan prompt (leveraging the existing `.meta.json` written by `orchestrator_tick_live`).
- **“Blocked? Do this next.”** as a typed halt artifact per tick: the CLI already does auto-triage using `stage_advance` dry-run (`runInspect`/`runTriage`); extend that pattern to produce an operator-readable next-step artifact (see Observability + UX).

### Scope alignment before Wave 1 (what’s missing today)

Option C currently has a **mode knob** (`--mode quick|standard|deep`) and **per-perspective budgets** (`prompt_contract.max_words`, `max_sources`, `tool_budget`) via `perspectives.json` → `wave1_plan` (`.opencode/tools/deep_research/wave1_plan.ts`). What it lacks is an explicit, durable “research scope contract” artifact that gets carried into every prompt.

Concrete need (pleasantness + time-savings):

- Before wave1 starts, capture (and persist) a scope contract:
  - research question(s) and subquestions
  - explicit non-goals / exclusions
  - time budget + desired depth
  - citation policy (web allowed? reproducibility posture?)
  - deliverable format (memo, brief, annotated bibliography, etc.)

Concrete proposal:

1) Add a run-root artifact: `<run_root>/operator/scope.md` (or `scope.json`) written during `init`.
2) Persist the same payload into `manifest.query.constraints.scope` (manifest already has `query.constraints` in `.opencode/tools/deep_research/run_init.ts`).
3) Update `wave1_plan` prompt generation to include `scope` text in every `prompt_md` (currently built via `buildWave1PromptMd()` in `wave1_plan.ts`).
4) Introduce a deterministic “Gate A: Planning completeness” evaluator that checks:
   - `scope` exists
   - `perspectives.json` exists and count <= `manifest.limits.max_wave1_agents`
   - every perspective has non-zero tool budgets aligned with the time budget
   - wave1 plan exists and matches perspectives ordering
   Then write Gate A via `gates_write`.

This shifts failures from “late wave1 retries” to “early plan correction,” which is where researchers want them.

---

## Where we are today (facts)

### Operator surfaces (doc + CLI)

- `/deep-research` operator doc routes to the Option C CLI:
  - `.opencode/commands/deep-research.md` (routes `plan|fixture|live` → `bun ".opencode/pai-tools/deep-research-option-c.ts" ...`).
  - No env vars required; use CLI flags and run artifacts.

- The primary CLI implementation is:
  - `.opencode/pai-tools/deep-research-option-c.ts`
  - Commands: `init|tick|run|status|inspect|triage|pause|resume|cancel|capture-fixtures` (see lines ~2110+).

### Deterministic stage machine + “blocking” semantics

- Stage advancement is deterministic and checks artifacts + gates:
  - `.opencode/tools/deep_research/stage_advance.ts`
  - It evaluates required artifacts/gates per transition (e.g., `wave1 -> pivot` requires wave dir non-empty, `wave-review.json`, and `Gate B pass`).
  - It records a **decision inputs digest** (`inputs_digest`) and writes a structured `decision.evaluated[]` list (see `digestInput` in `stage_advance.ts`).

### Orchestrator “ticks” by lifecycle phase

The orchestrator is split into three tick drivers:

- **Wave1 live tick (init/wave1 → pivot)**:
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts`
  - Expects `drivers.runAgent(...)` and performs:
    - `wave1_plan` creation if missing
    - agent execution (via `drivers.runAgent`)
    - `wave_output_ingest` + `wave_output_validate`
    - `wave_review` → retry directives
    - `gate_b_derive` → `gates_write`
    - bounded retries via `retry_record` and `retry/retry-directives.json`
    - `stage_advance("pivot")` on success
  - Writes output metadata sidecars next to each markdown output: `*.meta.json` with `prompt_digest` and `retry_count`.

- **Post-pivot tick (pivot/wave2/citations → summaries)**:
  - `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`
  - Creates `pivot.json` via `pivot_decide` if missing.
  - Generates deterministic Wave2 outputs (no agent seam yet; currently generates placeholder markdown in-code).
  - Runs citations pipeline:
    - `citations_extract_urls` → `citations_normalize` → `citations_validate` → `gate_c_compute` → `gates_write`
  - In `sensitivity=no_web`, it writes deterministic offline fixtures (`offline-fixtures.orchestrator.json`) and passes them to `citations_validate`.

- **Post-summaries tick (summaries/synthesis/review → finalize)**:
  - `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts`
  - Runs:
    - `summary_pack_build` → `gate_d_evaluate` → `gates_write` → `stage_advance("synthesis")`
    - `synthesis_write` → `stage_advance("review")`
    - `review_factory_run` → `gate_e_reports` → `gate_e_evaluate` → `gates_write` → `revision_control` → `stage_advance()`

### Web citations system already has reproducibility primitives

- URL extraction from wave markdown sources sections:
  - `.opencode/tools/deep_research/citations_extract_urls.ts` writes:
    - `citations/extracted-urls.txt`
    - `citations/found-by.json` (bounded “found-by” mapping)

- Online/offline citation validation:
  - `.opencode/tools/deep_research/citations_validate.ts`
  - Key behaviors:
    - Mode is resolved from `manifest` + optional `run-config.json` + env (via `resolveCitationsConfig()` in `citations_validate_lib.ts`).
    - Writes `citations/citations.jsonl`.
    - In online mode, also writes:
      - `citations/online-fixtures.<ts>.json`
      - `citations/online-fixtures.latest.json`
      - `citations/blocked-urls.json` with “action” hints.
    - Supports deterministic replay by passing `online_fixtures_path` back into `citations_validate`.

### Observability exists (but is not yet “operator-friendly”)

- Audit log: tools append to `<run_root>/logs/audit.jsonl` via helpers in `.opencode/tools/deep_research/lifecycle_lib.ts` (see `appendAuditJsonl`).
- CLI adds tick-level observability:
  - `.opencode/pai-tools/deep-research-option-c.ts`:
    - `beginTickObservability()` and `finalizeTickObservability()`
    - uses tools `tick_ledger_append`, `telemetry_append`, `run_metrics_write` (imported from `../tools/deep_research.ts`).

### Acceptance tests already exist (offline canaries)

- **M2 (wave1 → pivot)**: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
  - Seeds a deterministic `perspectives.json` fixture and uses a `runAgent` stub returning `fixtures/wave-output/valid.md`.

- **M3 (finalize)**: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
  - Drives through the lifecycle by calling `orchestrator_tick_live`, `orchestrator_tick_post_pivot`, and `orchestrator_tick_post_summaries` depending on stage.

- Fixture finalize stage-machine tests:
  - `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`
  - Validates typed blocking errors (e.g., `MISSING_ARTIFACT`, `GATE_BLOCKED`) and review-loop caps.

---

## Biggest gaps blocking real research

### Gap 1: The “real research” agent seam is not productized

Facts:

- The orchestrator supports a driver seam (`drivers.runAgent`) in `.opencode/tools/deep_research/orchestrator_tick_live.ts`.
- The CLI `--driver live` uses a **manual operator edit loop** (`createOperatorInputDriver()` in `.opencode/pai-tools/deep-research-option-c.ts`, writes `operator/prompts/...` and `operator/drafts/...`, then waits for ENTER).

Why it blocks research:

- Deep research needs **parallel perspective runs**, tool budgeting, and quick retries.
- The current CLI live path is “human in the loop” by design; it is not pleasant for iterative research.

Concrete need:

- A first-class, non-manual `runAgent` implementation that:
  - launches agents reliably (Task-backed or equivalent)
  - captures outputs deterministically under run root
  - supports bounded retries and partial reruns
  - emits evidence artifacts that the deterministic tools already expect.

### Gap 2: Caching exists but is not digest-aware (risk of “silent stale outputs”)

Facts:

- `orchestrator_tick_live` decides whether to call `runAgent` primarily on “does output markdown exist?” and “is there an active retry note?” (see logic around `outputAlreadyExists` in `.opencode/tools/deep_research/orchestrator_tick_live.ts`).
- It writes a sidecar with `prompt_digest` (see `writeOutputMetadataSidecar()` in `orchestrator_tick_live.ts`).

Risk:

- If `perspectives.json` changes or Wave1 prompt generation changes, existing `<perspective>.md` could be inconsistent with the current plan, but the orchestrator might still skip rerunning it.

Concrete need:

- “Skip” must mean **(output exists) AND (sidecar prompt_digest matches the current planned prompt digest)**.

### Gap 3: Config authority is still easy to misunderstand

Facts:

- Flags resolution happens in multiple places:
  - `.opencode/tools/deep_research/flags_v1.ts` has `resolveDeepResearchFlagsV1()`.
  - `.opencode/tools/deep_research/lifecycle_lib.ts` *also* defines `resolveDeepResearchFlagsV1()`.
- `run_init` bakes a snapshot of flags into `manifest.query.constraints.deep_research_flags` (`.opencode/tools/deep_research/run_init.ts`, lines ~161–179).
- The CLI writes `run-config.json` (`writeRunConfig()` in `.opencode/pai-tools/deep-research-option-c.ts`), and `citations_validate.ts` attempts to read it.

Pain:

- Operators will lose time debugging “why did citations run offline/online?” or “which endpoint did it use?” unless the system makes the effective config explicit at each stage and stable across reruns.

### Gap 4: Iteration UX isn’t yet “researcher-native”

Iteration-friendly research needs:

- partial reruns (one perspective, one stage)
- deterministic replay after failures
- fixture capture at the *right* points (citations + synthesis)
- crisp triage that tells you what to change and where

Pieces exist (retry directives, online fixtures, fixture bundles), but the default operator path is still “rerun and hope” unless you already know the internals.

---

## Concrete improvements (prioritized)

Below are proposals that map to concrete repo paths and existing tool seams.

### P0 — Time-waste killers

#### P0.1 Digest-aware Wave output caching (skip only when safe)

Problem:

- In `.opencode/tools/deep_research/orchestrator_tick_live.ts`, the rerun decision is “output exists?” instead of “output exists AND matches current prompt.”

Concrete implementation:

- When the plan is loaded, compute `prompt_digest = sha256(prompt_md)` for each planned entry.
- If `<output>.meta.json` exists, compare stored `prompt_digest` to the current planned digest.
- Only skip `runAgent` when they match; otherwise rerun and overwrite.

Why this kills time waste:

- Prevents “mysteriously wrong” results caused by stale artifacts.
- Makes reruns deterministic and intentional.

Where to implement:

- `.opencode/tools/deep_research/orchestrator_tick_live.ts` (skip logic near `outputAlreadyExists`).

#### P0.2 First-class Task-backed Wave1 runAgent (pleasant live research)

Goal:

- Turn “run wave1” into a single operator action that reliably:
  - launches N perspectives (bounded)
  - collects outputs + metadata
  - validates, reviews, retries, then advances to pivot

Constraints:

- Do not change OpenCode itself.

Concrete proposal (two-layer approach):

1) **Production workflow contract** (immediate, no code changes required):
   - Formalize the Task-backed driver described in `.opencode/commands/deep-research.md` (Wave1 Option A) into the production skill:
     - `.opencode/skills/deep-research-production/Workflows/RunWave1WithTaskDriver.md` is close, but it currently calls the CLI tick directly.
   - Expand it into an explicit “fan-out + gather + write” contract:
     - Read `<run_root>/wave-1/wave1-plan.json`
     - For each entry, spawn the configured agent type (e.g., `ClaudeResearcher`) via `functions.task`.
     - Write raw outputs to the **exact orchestrator output path** (e.g., `wave-1/<pid>.md`) and write a `*.meta.json` sidecar compatible with the orchestrator.
     - Then run `bun ".opencode/pai-tools/deep-research-option-c.ts" tick --driver fixture` (or call deterministic tools directly) to ingest/review/gate.

2) **CLI helper mode** (next, in-repo implementation):
   - Add a `--driver task` to `.opencode/pai-tools/deep-research-option-c.ts` that does **not** spawn tasks (since the CLI can’t call `functions.task`), but:
     - writes prompts (`operator/prompts/wave1/<id>.md`)
     - halts with a typed status `RUN_AGENT_REQUIRED` and prints the exact next commands
     - provides `agent-result --perspective <id> --path <md>` (or `--stdin`) to ingest results and create the correct `*.meta.json`
   - This converts the ad-hoc “Marvin does it in chat” into a stable operator loop.

Where the seam already exists:

- `orchestrator_tick_live` already supports any `drivers.runAgent`.
- The CLI already writes prompt + draft files and has an observability model.

#### P0.3 Make “blocked” states low-noise and actionable

Problem:

- The CLI prints many lines, and errors can be “tool failed” without a crisp next step.

Concrete implementation:

- On every `tick` failure, write a **single “halt artifact”** under `<run_root>/operator/halt/<tick_index>.json` containing:
  - `code`, `message`, `stage`, `blocked_transition`, `missing_artifacts`, `blocked_gates`, `retry_directives_path`, `blocked_urls_path`
  - and a `next_commands[]` list (shell-ready) generated from existing CLI knowledge.

Leverage existing pieces:

- `stage_advance` dry-run triage already extracts `missingArtifacts`, `blockedGates`, etc. (`triageFromStageAdvanceResult()` in `.opencode/pai-tools/deep-research-option-c.ts`).
- `citations_validate` already writes `citations/blocked-urls.json` and the CLI’s `inspect` already summarizes it.

Why it kills time waste:

- Operators stop guessing what to do next.
- Makes runs resumable even after long pauses.

---

### P1 — Iteration mechanics (avoid re-research)

#### P1.1 Stage-local “inputs_digest” caching and skip semantics

Current state:

- Many tools compute `inputs_digest` and/or write audit events (`wave1_plan` includes `inputs_digest`; `stage_advance` produces `inputs_digest`; citations tools compute digests).
- However, skip/no-op semantics are not consistently based on those digests.

Proposal:

- Standardize an artifact per stage:
  - `<run_root>/.stage-cache/<stage>.json` storing:
    - `inputs_digest`
    - `produced_artifacts[]`
    - `timestamp`
- Each orchestrator tick:
  - computes the digest for that stage
  - if unchanged and artifacts exist, it **skips expensive work**
  - still runs cheap validation if needed

Mapping to existing code:

- `orchestrator_tick_post_pivot.ts` (citations stage)
- `orchestrator_tick_post_summaries.ts` (summary pack + synthesis + review)

#### P1.2 First-class “partial rerun” commands

Operator need:

- “Only rerun citations with a new online fixtures file.”
- “Only rerun perspective p3 in wave1.”
- “Rerun review iteration once with updated draft.”

Concrete CLI additions (typed, stable):

- `rerun wave1 --perspective p3 --reason "..."` → writes a retry directive file compatible with `orchestrator_tick_live` (`retry/retry-directives.json`) and increments retry count via `retry_record(gate_id=B)`.
- `rerun citations --online-fixtures <abs> [--dry-run]` → calls `citations_validate` with explicit `online_fixtures_path` (and then `gate_c_compute` + `gates_write`).
- `rerun synthesis --draft <abs>` → runs `synthesis_write` and returns to `review` stage.

This is iteration-friendly because it prevents full reruns and makes changes explicit.

#### P1.3 Fixture capture at two “researcher-native” points

Current:

- CLI supports `capture-fixtures` → `fixture_bundle_capture` (`.opencode/pai-tools/deep-research-option-c.ts`).
- Bundle currently requires presence of synthesis + Gate E reports (`.opencode/tools/deep_research/fixture_bundle_capture.ts`).

Proposal:

- Add **two** fixture capture modes:
  1) `capture-fixtures --stage citations` (captures url-map + citations + online fixtures + blocked urls + audit)
  2) `capture-fixtures --stage finalize` (existing full bundle)

Why:

- Citations are often the most brittle (blocking/paywalls). Capturing them early enables deterministic reruns for the rest of the pipeline.

---

### P1 — LLM + agent orchestration reliability

#### P1.4 Standardize an agent output contract (beyond wave markdown)

Current wave contract:

- Enforced by `wave_output_validate` (`.opencode/tools/deep_research/wave_output_validate.ts`):
  - required headings
  - max words
  - max sources
  - parseable `Sources` bullets

What’s missing for real-world operations:

- A consistent metadata record for each agent execution:
  - start/end timestamps
  - model/agent identity
  - tool usage counts
  - prompt digest
  - retry directive digest (if applied)

Concrete path:

- Extend/standardize the existing sidecar written by `orchestrator_tick_live` (`writeOutputMetadataSidecar()`):
  - include `agent_run_id`, `started_at`, `finished_at` when available
  - add `retry_directives_digest` when used
  - ensure the operator Task-backed driver writes the same shape

Why:

- Makes debugging and quality audits practical.

#### P1.5 Parallelism policy for wave execution

Problem:

- Wave 1 execution in `orchestrator_tick_live` is currently sequential over planned entries.

Proposal:

- Implement bounded parallel execution (fan-out) at the driver level:
  - spawn up to `manifest.limits.max_wave1_agents` concurrently
  - enforce per-agent budgets (`prompt_contract.tool_budget`) at the driver layer
  - gather results, then ingest/validate/review

Why:

- Wall-clock time is the #1 “pleasantness” lever for research.

---

### P1 — Web citations (blocking, paywalls, reproducibility)

#### P1.6 Make online citation validation reproducible by default

Current:

- `citations_validate.ts` already produces:
  - `citations/online-fixtures.<ts>.json`
  - `citations/online-fixtures.latest.json`
  - `citations/blocked-urls.json`

Proposal:

- Treat `online-fixtures.latest.json` as the **default replay input** for all later reruns:
  - when a run re-enters citations stage, the orchestrator should preferentially pass `online_fixtures_path=<latest>` into `citations_validate`.

Why:

- Web changes and transient blocks stop being run-killers.

#### P1.7 Paywall + block handling ladder: turn “blocked” into a work queue

Current:

- Blocked URLs are emitted with suggested actions (`blockedUrlAction()` in `citations_validate.ts`).

Proposal:

- Add an operator-visible “blocked citations queue” artifact:
  - `<run_root>/citations/blocked-urls.queue.md` containing:
    - URL, reason, recommended action, found_by contexts
  - and a deterministic “resolved” mechanism:
    - operator edits a `citations/url-replacements.json` file mapping normalized_url → replacement_url
    - rerun citations stage; record changes in audit

Why:

- Researchers naturally work from a queue; this reduces thrash.

---

### P2 — Observability + operator UX

#### P2.1 One-line JSON status for every command

Current:

- CLI prints many lines (human-readable).

Proposal:

- Add `--json` to `status|inspect|triage|tick|run` that prints a single JSON object containing:
  - contract fields (`run_id`, `run_root`, `manifest_path`, `gates_path`, `stage`, `status`)
  - plus stage-specific details (gate statuses, blockers, tick outcome)

Why:

- Enables scripting, dashboards, and stable integration without scraping.

#### P2.2 Log-tail commands (progress for long runs)

Leverage existing logs:

- `<run_root>/logs/audit.jsonl`
- CLI telemetry path: `<run_root>/<logs_dir>/telemetry.jsonl` (see `beginTickObservability()` in `.opencode/pai-tools/deep-research-option-c.ts`).
- tick ledger: `<run_root>/<logs_dir>/ticks.jsonl`

Add CLI commands:

- `logs tail --manifest <abs> --n 50` (audit)
- `telemetry tail --manifest <abs> --n 50` (telemetry)
- `ticks tail --manifest <abs> --n 50` (ledger)

#### P2.3 Run lock UX

Current:

- Locking exists and is robust (`.opencode/tools/deep_research/run_lock.ts` supports stale lock eviction).
- But there’s no “operator command” to inspect/clear locks.

Add:

- `lock status --run-root <abs>` → calls `detectRunLock()` and prints staleness
- `lock break --run-root <abs> --force` → removes stale lock only (never break non-stale)

---

## Proposed operator UX (commands + examples)

This section proposes *stable, typed* command shapes that align with the existing CLI structure (`cmd-ts`) in `.opencode/pai-tools/deep-research-option-c.ts`.

### Baseline (already exists)

```bash
# init
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal

# single tick
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --reason "operator tick" --driver fixture

# run loop
bun ".opencode/pai-tools/deep-research-option-c.ts" run --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --reason "operator run" --driver fixture --max-ticks 200

# blockers
bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<ABS_MANIFEST>"
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<ABS_MANIFEST>"

# pause/resume
bun ".opencode/pai-tools/deep-research-option-c.ts" pause  --manifest "<ABS_MANIFEST>" --reason "break"
bun ".opencode/pai-tools/deep-research-option-c.ts" resume --manifest "<ABS_MANIFEST>" --reason "continue"

# fixture capture
bun ".opencode/pai-tools/deep-research-option-c.ts" capture-fixtures --manifest "<ABS_MANIFEST>" --reason "post-run capture"
```

### Additions (recommended)

#### 1) `driver=task` as an operator loop (no OpenCode changes)

```bash
# Produce prompts + halt with typed next steps
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --reason "wave1" --driver task

# For each perspective, run your Task-backed agent externally (Marvin) and then ingest:
bun ".opencode/pai-tools/deep-research-option-c.ts" agent-result --manifest "<ABS_MANIFEST>" --stage wave1 --perspective p2 --path "/abs/output.md" --agent-run-id "..." --reason "wave1 p2"

# Then resume deterministic tick to gate to pivot
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --reason "wave1 gate" --driver fixture
```

#### 2) Stage reruns

```bash
# Rerun just citations using latest online fixtures
bun ".opencode/pai-tools/deep-research-option-c.ts" rerun citations --manifest "<ABS_MANIFEST>" --reason "retry citations" --use-latest-online-fixtures

# Rerun just one wave1 perspective
bun ".opencode/pai-tools/deep-research-option-c.ts" rerun wave1 --manifest "<ABS_MANIFEST>" --perspective p3 --reason "fix missing sources"
```

#### 3) Observability

```bash
# Machine-readable status
bun ".opencode/pai-tools/deep-research-option-c.ts" status --manifest "<ABS_MANIFEST>" --json

# Tail audit
bun ".opencode/pai-tools/deep-research-option-c.ts" logs tail --manifest "<ABS_MANIFEST>" --n 50
```

---

## Acceptance tests (M2, M3) with artifact checklist

You already have strong offline smoke tests; the next step is to turn them into operator-facing evidence runs with crisp triage.

### M2 (Wave1 → Pivot) — evidence run

Existing test:

- `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`

Evidence artifacts expected under run root:

- `manifest.json`
- `gates.json`
- `wave-1/wave1-plan.json`
- `wave-review.json`
- `wave-1/*.md` (at least one)
- `wave-1/*.meta.json` (sidecars)
- `logs/audit.jsonl`

Failure triage steps:

1) `bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<ABS_MANIFEST>"`
2) If `RETRY_REQUIRED`: open `retry/retry-directives.json`, rerun only those perspectives.
3) If `wave_output_validate` failures (missing headings/too many words): adjust prompt template in `wave1_plan` prompt builder (`buildWave1PromptMd()` in `.opencode/tools/deep_research/wave_tools_shared.ts`, via `wave1_plan.ts`).

### M3 (Finalize) — evidence run

Existing test:

- `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

Evidence artifacts expected under run root:

- `summaries/summary-pack.json`
- `synthesis/final-synthesis.md`
- `review/review-bundle.json`
- `reports/gate-e-status.json`
- `logs/audit.jsonl`

Failure triage steps:

1) `inspect` to see blocked gates and missing artifacts.
2) If Gate C fails due to blocked citations:
   - inspect `citations/blocked-urls.json`
   - supply `online_fixtures_path` (deterministic) or replace sources and rerun citations.
3) If Gate E fails:
   - inspect Gate E reports directory (`reports/gate-e-*.json`), then rerun synthesis/review loop.

### Missing acceptance test (recommended): Live citations canary

Add an M4 canary that exercises online citations in a deterministic way:

- Run citations stage in online mode with a small set of stable public URLs.
- Require that `citations/online-fixtures.latest.json` is produced and that replay with `online_fixtures_path=<latest>` yields identical `citations.jsonl`.

Why:

- This is where real research fails in practice (blocking/paywalls). Making it testable is critical.

---

## Long-run (1h+) strategy

Long runs fail for two reasons: (1) web brittleness, (2) human context loss. The pipeline already has the raw ingredients to solve both.

### Operational strategy

1) **Stage-level checkpoints** (already partially present):
   - after `wave1`: ensure `wave-review.json` exists and Gate B is pass
   - after `citations`: ensure online fixtures are written (online) or offline fixtures are captured (no_web)
   - after `synthesis/review`: capture fixture bundle

2) **Pause/resume as normal workflow**:
   - Use CLI `pause`/`resume` which writes checkpoint artifacts (`pause-checkpoint.md`, `resume-checkpoint.md`) in `.opencode/pai-tools/deep-research-option-c.ts`.

3) **Reproducibility-first web posture**:
   - Online citations: treat `citations/online-fixtures.latest.json` as the frozen record for later reruns.
   - If blocking occurs: convert it to a queue; resolve by replacement URLs or fixture capture.

4) **Convergence policy**:
   - Wave outputs: bounded retries via `retry_record` caps (Gate B cap in `GATE_RETRY_CAPS_V1` in `.opencode/tools/deep_research/schema_v1.ts`).
   - Review loop: bounded by `manifest.limits.max_review_iterations` and enforced by `stage_advance.ts`.

---

## Suggested roadmap

### Week 1: Pleasant Wave1 live runs

- P0.1 digest-aware wave caching in `orchestrator_tick_live`.
- P0.2 Task-backed driver workflow contract (skill + runbook) + typed halt artifacts.
- Add partial rerun for wave1 perspectives (retry directives + `retry_record` integration).

### Week 2: Citations as a reproducible subsystem

- Make “use latest online fixtures” the default replay path.
- Introduce `blocked citations queue` + deterministic URL replacement mechanism.
- Add M4 live citations canary.

### Week 3: Operator UX + observability polish

- `--json` output mode.
- `logs/telemetry/ticks tail` commands.
- `lock status/break` commands.

### Week 4: Long-run hardening

- Stage-level `.stage-cache` digests and skip semantics.
- Two-stage fixture capture (citations + finalize).
- Regression replay suite integration (`regression_run` already exists under `.opencode/tools/deep_research/regression_run.ts`).

---

## Appendix: concrete tool + file references (selected)

- Operator doc: `.opencode/commands/deep-research.md`
- Option C CLI: `.opencode/pai-tools/deep-research-option-c.ts`
- Stage machine: `.opencode/tools/deep_research/stage_advance.ts`
- Wave1 orchestrator: `.opencode/tools/deep_research/orchestrator_tick_live.ts`
- Post-pivot orchestrator: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`
- Post-summaries orchestrator: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts`
- Citations validate: `.opencode/tools/deep_research/citations_validate.ts`
- Fixture capture: `.opencode/tools/deep_research/fixture_bundle_capture.ts`
- Smoke tests: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`, `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
