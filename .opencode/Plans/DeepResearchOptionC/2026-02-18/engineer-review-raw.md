# Deep Research Option C — Engineer Review (raw)

Date: 2026-02-18

Repo: `/Users/zuul/Projects/pai-opencode-graphviz` (branch: `graphviz`)

This is a *concrete, implementation-minded* review of the current Option C pipeline, focused on making it pleasant, efficient, and iteration-friendly for real research.

---

## Executive summary

Option C is already a serious **artifact-first, deterministic stage machine** with strong lifecycle invariants, and it has credible **offline/fixture proofs**. The main reason it is *not yet pleasant for real research* is that the “live” path is still missing a cohesive operator loop that:

1) **aligns scope before Wave 1** (budgets, constraints, deliverable shape),
2) **runs Wave 1 with real agents** (fan-out + retries) and records enough state to avoid re-research,
3) **runs citations online** with predictable blocking behavior and reproducibility,
4) **generates (not fixtures) summaries/synthesis/review** beyond Wave 1,
5) makes long runs observable (progress + timeouts + drill-ready logs).

The good news: the repo already contains most of the *substrate* needed to make iteration cheap: stable run roots, atomic writers, gate digests, stage advancement authority, idempotent orchestrator ticks, fixture bundle capture, and a growing entity test lattice.

If I had to pick the smallest “pleasantness” critical path:

- **P0:** Make `/deep-research live` a real operator loop that can drive *at least* `init → wave1 → pivot → citations → summaries` with real agent spawning + ingestion.
- **P0:** Add *preflight scope calibration* that writes a run-local “brief” into `manifest.query.constraints` + `perspectives.json` before Wave 1.
- **P0:** Eliminate manual env-var fiddling from operator flows by shifting all flags to `.opencode/settings.json` + run-local overrides.
- **P1:** Implement “generate” mode for Phase 05 tools (today many are fixture-only), so live runs can reach `finalize`.
- **P1:** Add an operator-grade “inspect + resume + retry” UX that surfaces stage blockers using the already-rich `stage_advance` decision payload.

---

## Where we are today (facts)

### Operator surface (docs)

- Primary operator command doc:
  - `.opencode/commands/deep-research.md`
    - Contract: `/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]`.
    - Modes: `plan`, `fixture`, `live`.
    - **Important:** `live` is explicitly labeled “skeleton” and stops after a minimal wave1→pivot attempt.

- Status command:
  - `.opencode/commands/deep-research-status.md` (reads the program tracker doc, not a run-root).

### Canonical tool surface (implementation)

The Option C tool barrel is:

- `.opencode/tools/deep_research/index.ts`

Operator-critical tool IDs referenced throughout command/docs (examples):

- Run substrate:
  - `deep_research_run_init` (`.opencode/tools/deep_research/run_init.ts`)
  - `deep_research_manifest_write` (`.opencode/tools/deep_research/manifest_write.ts`)
  - `deep_research_gates_write` (`.opencode/tools/deep_research/gates_write.ts`)
  - `deep_research_stage_advance` (`.opencode/tools/deep_research/stage_advance.ts`) — authoritative stage transition gatekeeper

- Wave 1:
  - `deep_research_wave1_plan` (`.opencode/tools/deep_research/wave1_plan.ts`)
  - `deep_research_wave_output_validate` (`.opencode/tools/deep_research/wave_output_validate.ts`)
  - `deep_research_wave_output_ingest` (`.opencode/tools/deep_research/wave_output_ingest.ts`)
  - `deep_research_wave_review` (`.opencode/tools/deep_research/wave_review.ts`)
  - `deep_research_gate_b_derive` (`.opencode/tools/deep_research/gate_b_derive.ts`)

- Pivot/citations:
  - `deep_research_pivot_decide` (`.opencode/tools/deep_research/pivot_decide.ts`)
  - `deep_research_citations_extract_urls` (`.opencode/tools/deep_research/citations_extract_urls.ts`)
  - `deep_research_citations_normalize` (`.opencode/tools/deep_research/citations_normalize.ts`)
  - `deep_research_citations_validate` (`.opencode/tools/deep_research/citations_validate.ts`)
  - `deep_research_gate_c_compute` (`.opencode/tools/deep_research/gate_c_compute.ts`)

- Summaries/synthesis/review/finalize:
  - `deep_research_summary_pack_build` (`.opencode/tools/deep_research/summary_pack_build.ts`)
  - `deep_research_gate_d_evaluate` (`.opencode/tools/deep_research/gate_d_evaluate.ts`)
  - `deep_research_synthesis_write` (`.opencode/tools/deep_research/synthesis_write.ts`)
  - `deep_research_review_factory_run` (`.opencode/tools/deep_research/review_factory_run.ts`)
  - `deep_research_revision_control` (`.opencode/tools/deep_research/revision_control.ts`)
  - `deep_research_gate_e_evaluate` (`.opencode/tools/deep_research/gate_e_evaluate.ts`)
  - `deep_research_gate_e_reports` (`.opencode/tools/deep_research/gate_e_reports.ts`)

### Orchestrators exist (but “real live” is not proven)

There are orchestrator drivers/ticks for multiple parts of the stage machine:

- Wave 1 live tick and run loop:
  - `.opencode/tools/deep_research/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research/orchestrator_run_live.ts`
  - **Fact:** `orchestrator_tick_live` currently executes **only the first wave1 plan entry** (it reads `entries[0]`).
  - **Fact:** it depends on an injected `drivers.runAgent(...)` function; it is not wired to the OpenCode `Task` tool from within tool code.

- Post-pivot tick and run loop (pivot → citations → summaries):
  - `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research/orchestrator_run_post_pivot.ts`

- Post-summaries tick and run loop (summaries → synthesis → review → finalize):
  - `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts`
  - `.opencode/tools/deep_research/orchestrator_run_post_summaries.ts`
  - **Fact:** current tick implementation hard-requires *fixture inputs* (see below).

- Fixture tick:
  - `.opencode/tools/deep_research/orchestrator_tick_fixture.ts` (stage advancement using a `fixture_driver`).

### Phase 05 is currently “fixture-only” (blocks true live end-to-end)

Several Phase 05 tools explicitly reject `mode=generate`:

- `.opencode/tools/deep_research/summary_pack_build.ts`
  - `if (mode !== "fixture") return err("INVALID_ARGS", "only fixture mode is supported", { mode });`

- `.opencode/tools/deep_research/synthesis_write.ts`
  - same pattern: fixture-only.

- `.opencode/tools/deep_research/review_factory_run.ts`
  - same pattern: fixture-only.

This is the key “not pleasant yet” blocker: a real research run needs the system to **generate** summaries, synthesis, and reviews (or integrate with a real reviewer pool), not require fixture directories.

### Offline/fixture proofs already exist (tests + fixtures)

Entity tests show deterministic paths across the stage machine:

- Wave1 live run to pivot (using a fake driver that returns valid markdown):
  - `.opencode/tests/entities/deep_research_orchestrator_run_live.test.ts`

- Pivot → citations → summaries (offline citations dry-run path + Gate C enforced):
  - `.opencode/tests/entities/deep_research_orchestrator_pivot_to_summaries.test.ts`

- Summaries → finalize (fixture summaries + fixture synthesis + fixture reviewer bundle):
  - `.opencode/tests/entities/deep_research_orchestrator_summaries_to_finalize.test.ts`

Fixtures directory is already structured for replay:

- `.opencode/tests/fixtures/runs/` includes scenarios like:
  - `m1-finalize-happy/`
  - `m1-gate-b-blocks/`
  - `m1-gate-c-blocks/`
  - `m1-review-loop-one-iteration/`
  - `m1-review-loop-hit-cap/`

There is also a deterministic fixture runner script:

- `Tools/deep-research-option-c-fixture-run.ts`
  - **Fact (historical):** previously set `PAI_DR_OPTION_C_ENABLED` and `PAI_DR_NO_WEB` via environment variables; env flags are now unsupported.
  - Drives a full path to `finalize` using fixture summaries/synthesis/reviews.

### Flags/config: settings-only (env unsupported)

- `.opencode/tools/deep_research/flags_v1.ts` (via `lifecycle_lib.ts`) reads flags from:
  - `.opencode/settings.json` under `settings.deepResearch.flags.*` **or** `settings.pai.deepResearch.flags.*`
  - Environment variables are intentionally unsupported for Option C flags.

Default run root:

- `runsRoot` default is `~/.config/opencode/research-runs` (`flags_v1.ts`).

---

## Biggest gaps blocking real research

1) **No end-to-end live operator loop that reaches a useful terminal state.**
   - The documented entrypoint `.opencode/commands/deep-research.md` acknowledges `live` is a skeleton.
   - Even where orchestrators exist, the system lacks the cohesive “driver” that binds:
     - *agent spawning* → *wave output ingestion* → *gate derivation* → *stage advance* → *post-pivot* → *post-summaries*.

2) **Wave 1 orchestration is single-entry and not retry-friendly.**
   - `orchestrator_tick_live.ts` runs only `entries[0]` and does not manage:
     - fan-out (multiple perspectives)
     - per-perspective retries
     - partial completion (some perspectives succeed, others fail)
     - convergence strategies when Gate B fails.

3) **Phase 05 “generate mode” is missing.**
   - `summary_pack_build.ts`, `synthesis_write.ts`, `review_factory_run.ts` are fixture-only.
   - This prevents live research runs from reaching `finalize` without manual artifact injection.

4) **Scope is not calibrated before Wave 1, so the system will overrun budgets or under-deliver.**
   - There is a default perspective payload in `.opencode/commands/deep-research.md`, but there is no standardized “brief” artifact or preflight Q/A.

5) **Web citations in true online mode are not operationalized and not reproducible.**
   - `citations_validate.ts` supports an “online ladder” (`direct_fetch → bright_data → apify`) via `citations_validate_lib.ts`, but:
     - endpoints are env-only today (`PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT`, `PAI_DR_CITATIONS_APIFY_ENDPOINT`)
     - paywalls/CAPTCHAs are treated as “blocked” with notes, but operator UX for what to do next is not standardized.

6) **Observability exists on paper + as tools, but is not stitched into the operator loop.**
   - Telemetry tooling exists:
     - `deep_research_telemetry_append` (`.opencode/tools/deep_research/telemetry_append.ts`)
     - `deep_research_run_metrics_write` (`.opencode/tools/deep_research/run_metrics_write.ts`)
   - But the orchestrator ticks are not emitting stage lifecycle telemetry consistently today.

7) **Operator UX is still “developer UX.”**
   - Too many steps require absolute paths and env vars.
   - The system already computes rich rejection evidence in `deep_research_stage_advance` (it returns `decision.evaluated[]`), but no stable command surfaces that as a human-friendly “what’s blocking me?” diagnosis.

---

## Concrete improvements (prioritized)

This section is intentionally concrete: each item has a clear “what to implement” and points at the repo locations to attach it.

### P0 — Time-waste killers (stop burning minutes per iteration)

#### 1) Kill “rerun everything” by making stage ticks *resume-first* everywhere

**Where time is wasted today:**
- Operators will re-run early stages after minor changes because the entrypoint doesn’t provide a clean “resume” loop.

**Existing substrate you already have:**
- Idempotence patterns exist in orchestrator ticks:
  - `orchestrator_tick_live.ts` checks:
    - wave1 plan existence (`wave-1/wave1-plan.json`)
    - output markdown existence (`wave-1/<perspective>.md`)
    - `wave-review.json` existence
    - Gate B pass in `gates.json`

**Fix:**
- Implement a *single* operator-level loop in `.opencode/commands/deep-research.md` (for live) that:
  1) loads `manifest.json` + `gates.json`
  2) switches on `manifest.stage.current`
  3) calls the appropriate orchestrator tick/run (live/post-pivot/post-summaries)
  4) prints “what changed” + paths after each tick.

**Concrete check:**
- A restarted session can continue a run by supplying only `--run_id` and does not re-run prior stages.

#### 2) Reduce “noisy failures” by promoting `stage_advance.decision.evaluated[]` into operator-facing output

**Where time is wasted today:**
- When stage advance fails (missing artifact, gate blocked), the operator often has to open multiple files to find *which artifact/gate* caused the block.

**Existing substrate:**
- `.opencode/tools/deep_research/stage_advance.ts` builds an `evaluated[]` array and returns a `decision` object in error details.

**Fix:**
- Add an operator command (doc + optionally a CLI wrapper) that prints:
  - current stage
  - requested transition
  - a compact table of `decision.evaluated` entries with `ok=false`
  - exact file paths (relative to run root) that are missing.

**Concrete repo locations:**
- Command doc: `.opencode/commands/deep-research.md` (add a `status`/`inspect` sub-mode)
- Existing wrapper inspiration: `Tools/deep-research-option-c-stage-advance.ts`

#### 3) Make Gate-related retries cheap and consistent

**Where time is wasted today:**
- Gate failures can lead to ad-hoc reruns without a consistent “material change” record.

**Existing substrate:**
- `deep_research_retry_record` (`.opencode/tools/deep_research/retry_record.ts`) enforces bounded retries per gate (caps in `schema_v1.ts`).

**Fix:**
- In the operator loop, whenever a stage’s critical gate fails (B/C/D/E), do two things:
  1) require a `change_note` (what is *materially different*)
  2) call `deep_research_retry_record` before re-running the stage

This forces iteration hygiene and prevents silent “try again” loops.

---

### P0 — Scope alignment before run (preflight that makes Wave 1 sane)

#### 1) Introduce a run-local “brief” stored in the manifest and linked from wave prompts

**Problem:** the system can’t be pleasant if it doesn’t know *what success looks like* before Wave 1.

**Concrete implementation approach (no schema change required):**
- Use `manifest.query.constraints` (already allowed as a plain object by `validateManifestV1` in `.opencode/tools/deep_research/schema_v1.ts`) to store:
  - target deliverable (“answer type”): memo vs annotated bibliography vs position paper
  - time budget: e.g. `time_budget_minutes: 20|60|180`
  - depth: quick/standard/deep (separate from `manifest.mode` if you want)
  - disallowed sources / must-use sources
  - “unknowns tolerated”: what you can’t claim without evidence

**Mechanics:**
- On `/deep-research live` start, prompt (via `functions.question`) for a small set of calibration choices.
- Persist the chosen constraints via `deep_research_manifest_write`.

#### 2) Calibrate perspective contracts to the scope

**Existing substrate:**
- `perspectives.json` schema supports:
  - `prompt_contract.max_words`, `prompt_contract.max_sources`, `prompt_contract.tool_budget`, and required sections
  - validated by `validatePerspectivesV1` in `.opencode/tools/deep_research/schema_v1.ts`

**Fix:**
- Define 3–4 canonical “tracks” (already allowed values: `standard|independent|contrarian`) with default budgets.
- A scope preflight picks:
  - number of perspectives
  - which tracks
  - max words/sources per perspective

This reduces wasted cycles where the first wave outputs are invalid purely due to a mismatch between expected sections/budgets and what the agent produces.

---

### P0 — Iteration mechanics (avoid re-research and make partial reruns trivial)

#### 1) Standardize “resume from run root” as the primary iteration unit

**Existing substrate:**
- Stable run roots created by `deep_research_run_init` (`.opencode/tools/deep_research/run_init.ts`).
- Stage authority enforced by `deep_research_stage_advance`.

**Fix:**
- Expand `/deep-research` so that `--run_id` is not just for init, but for:
  - status
  - resume
  - retry
  - capture fixtures

**Operator expectation:**
- When you tweak perspective prompts or retry a gate, you do it *in-place in the same run root* unless you explicitly fork.

#### 2) Add “partial rerun” primitives at the wave level

**Existing substrate:**
- `deep_research_wave_output_ingest` is transactional and supports overwriting outputs safely (`.bak.*` flow) while validating staged writes.

**Fix:**
- Add an explicit operator flow:
  - re-run only the subset of perspectives that failed Wave output validation or Wave review
  - leave successful markdown outputs untouched
  - regenerate `wave-review.json` and re-derive Gate B.

#### 3) Make reproducibility a one-liner: fixture bundle capture at stage boundaries

**Existing substrate:**
- `deep_research_fixture_bundle_capture` (`.opencode/tools/deep_research/fixture_bundle_capture.ts`).

**Fix:**
- In live runs, capture fixture bundles automatically at least at:
  - `pivot` reached
  - `summaries` reached
  - `finalize` reached

This makes “it was good yesterday but not today” debuggable.

---

### P0 — LLM + agent orchestration (reliable launch, capture, validate, retry, converge)

#### 1) Implement a real `runAgent` driver in the `/deep-research live` operator

**Existing substrate:**
- `orchestrator_tick_live` requires `drivers.runAgent({ agent_type, prompt_md, output_md, ... })`.

**Fix (operator-level):**
- For each plan entry:
  1) spawn an agent using the OpenCode `Task` tool with the specified `agent_type`
  2) pass the `prompt_md` (plus the run brief) as the agent prompt
  3) collect the agent’s markdown output
  4) call `deep_research_wave_output_ingest` with `{ perspective_id, markdown, agent_type, prompt_md }`
  5) validate/review/derive Gate B, then `deep_research_gates_write`, then `deep_research_stage_advance`.

**Key pleasantness detail:**
- The operator must print progress after each perspective completes; Wave 1 fan-out must not feel like a black box.

#### 2) Expand Wave 1 from single-entry to multi-entry fan-out

**Fact:** `orchestrator_tick_live.ts` reads only `entries[0]` today.

**Fix:**
- Update the orchestrator tick (or the operator loop) to iterate all plan entries, with:
  - concurrency cap = `manifest.limits.max_wave1_agents`
  - per-perspective retry budget aligned with Gate B retry caps (`GATE_RETRY_CAPS_V1.B` in `schema_v1.ts`).

#### 3) Standardize agent output contracts to minimize Gate B churn

**Existing substrate:**
- Perspective prompt contracts already include `must_include_sections` and `max_words/max_sources`.
- Wave output validation exists (`deep_research_wave_output_validate`).

**Fix:**
- Make the prompt contract *operator-enforced*:
  - if output violates contract, the retry prompt should be automatically synthesized from the validation error (missing sections, too many sources, etc.)
  - record the retry via `deep_research_retry_record` with a crisp `change_note`.

---

### P0 — Web citations (real web, blocking/paywalls, reproducibility)

#### 1) Stop using env vars as the primary operator interface

**Facts:**
- Offline/online mode currently hinges on `PAI_DR_NO_WEB` in `citations_validate.ts`.
- Online endpoints are env-only:
  - `PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT`
  - `PAI_DR_CITATIONS_APIFY_ENDPOINT`

**Fix:**
- Extend `.opencode/tools/deep_research/flags_v1.ts` (or create a parallel citation flags resolver) to read endpoints from `.opencode/settings.json`.
  - This keeps the operator UX “typed, stable, no env vars”.

#### 2) Make blocking outcomes actionable

**Existing substrate:**
- Online ladder returns `status: "blocked"` with `notes` containing step outcomes (`citations_validate_lib.ts`).

**Fix:**
- Standardize a follow-up artifact:
  - `citations/blocked-urls.json` with:
    - normalized_url
    - ladder attempt string
    - recommended operator action (`add fixture`, `enable brightdata`, `skip`, etc.)

#### 3) Reproducibility policy for online runs

**Goal:** online runs should be reproducible *enough* for iteration.

**Concrete policy:**
- After a successful online run, emit:
  - `citations/online-fixtures.<date>.json` containing the ladder classification outputs (status, http_status, title, publisher, evidence_snippet).
- On reruns, prefer those fixtures unless the operator explicitly requests a refresh.

This mirrors how `citations_validate.ts` already supports `online_fixtures_path`.

---

### P0 — Observability (logs, audit, progress updates; long-run operator UX)

#### 1) Wire stage lifecycle telemetry into orchestrator execution

**Existing substrate:**
- Telemetry spec: `.opencode/Plans/DeepResearchOptionC/spec-run-telemetry-schema-v1.md`.
- Tool: `deep_research_telemetry_append`.
- Metrics tool: `deep_research_run_metrics_write`.

**Fix:**
- At minimum, the operator loop should append:
  - `run_status: created` (once)
  - `run_status: running` (once)
  - for each stage attempt: `stage_started` and `stage_finished`
  - on retry: `stage_retry_planned`
  - on watchdog timeout: call `deep_research_watchdog_check` and append `watchdog_timeout`

This makes “1h+ runs” debuggable without reading raw code.

#### 2) Provide a single “run snapshot” view

**Fix:**
- Add `/deep-research inspect --run_id ...` that prints:
  - `manifest.stage.current`, `manifest.status`
  - `gates.gates.*.status`
  - last 10 lines of `logs/audit.jsonl`
  - artifact existence summary (`wave-1/*.md`, `citations/citations.jsonl`, etc.)

---

### P0 — CLI/operator UX (stable, typed, no env vars)

You already have precedents for typed wrappers:

- `Tools/deep-research-option-c-stage-advance.ts`
- `Tools/deep-research-option-c-fixture-run.ts`

#### Proposed command suite (concrete)

1) **In-chat operator command** (OpenCode command doc):
   - `/deep-research plan|fixture|live "<query>" [--run_id ...] [--sensitivity ...]`
   - Evolve `.opencode/commands/deep-research.md` into a full driver loop.

2) **Typed local CLI** (bun scripts) for determinism + CI:

   - `bun ".opencode/pai-tools/deep-research-option-c.ts" init --query "..." --mode standard --sensitivity no_web [--run-id ...]`
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" resume --run-id <id> [--until summaries|finalize]`
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --run-id <id>`
   - `bun ".opencode/pai-tools/deep-research-option-c.ts" capture-fixtures --run-id <id> --bundle-id <id> --out <abs>`

3) **Config without env vars**

- Put all “operator knobs” into `.opencode/settings.json` under one namespace (supported by `flags_v1.ts`):
  - `deepResearch.flags.PAI_DR_OPTION_C_ENABLED`
  - `deepResearch.flags.PAI_DR_NO_WEB`
  - `deepResearch.flags.PAI_DR_RUNS_ROOT`
  - (extend similarly for citation endpoints)

---

## Proposed operator UX (commands + examples)

This section describes the target experience, not the current behavior.

### A) Quick scope-calibrated live run (in chat)

```
/deep-research live "How reliable are LLM agent benchmarks in 2026?" --sensitivity normal
```

Expected flow:

1) Preflight questions (3–6 prompts max):
   - desired output type (memo / lit review / decision brief)
   - max time budget
   - allow web? (yes/no)
   - preferred sources (optional)

2) Writes:
   - `<run_root>/manifest.json` updated with `query.constraints.*`
   - `<run_root>/perspectives.json`
   - `<run_root>/wave-1/wave1-plan.json`

3) Live wave execution:
   - spawn agents per plan entry
   - ingest markdown via `deep_research_wave_output_ingest`
   - `deep_research_wave_review` → `deep_research_gate_b_derive` → `deep_research_gates_write`
   - stage advance to `pivot`

4) Post-pivot:
   - `deep_research_citations_*` → Gate C → stage advance to `summaries`

5) If generate mode is implemented:
   - `summaries → synthesis → review → finalize`
   - else: stop at `summaries` with a clear next instruction.

### B) Offline deterministic fixture run (local)

```
bun Tools/deep-research-option-c-fixture-run.ts --run-id dr_fixture_smoke_001
```

Expected artifacts:

- `manifest.stage.current = finalize`
- `gates.gates.B/C/D/E.status = pass`
- `wave-1/*.md`, `wave-review.json`, `pivot.json`
- `citations/citations.jsonl`
- `summaries/summary-pack.json`
- `synthesis/final-synthesis.md`
- `reports/gate-e-status.json`

---

## Acceptance tests (M2, M3) with artifact checklist

The repo already has a strong entity-test lattice. The acceptance tests below are framed as “evidence runs” with clear artifacts and triage.

### Milestone M2 — Deterministic offline end-to-end finalize

**Goal:** Prove the stage machine + gate lattice is stable and replayable without network.

**Evidence run options (existing):**

1) Entity tests:

```
bun test ./.opencode/tests/entities/deep_research_orchestrator_run_live.test.ts
bun test ./.opencode/tests/entities/deep_research_orchestrator_pivot_to_summaries.test.ts
bun test ./.opencode/tests/entities/deep_research_orchestrator_summaries_to_finalize.test.ts
```

2) Deterministic fixture runner:

```
bun Tools/deep-research-option-c-fixture-run.ts --run-id dr_fixture_m2_001
```

**Success artifacts checklist (run root):**

- `manifest.json`:
  - `status = completed`
  - `stage.current = finalize`

- `gates.json`:
  - Gate B/C/D/E: `status = pass`, `checked_at` non-empty

- Files exist:
  - `wave-1/*.md`
  - `wave-review.json`
  - `pivot.json`
  - `citations/citations.jsonl`
  - `summaries/summary-pack.json`
  - `synthesis/final-synthesis.md`
  - `reports/gate-e-status.json`
  - `logs/audit.jsonl` (non-empty)

**Failure triage steps:**

1) Run `deep_research_stage_advance` for the intended transition and inspect `decision.evaluated[]`.
2) Confirm that the blocked artifact path matches `manifest.artifacts.paths.*` (path mapping errors are common).
3) If Gate C fails: inspect `citations/url-map.json` and the fixture file passed to `deep_research_citations_validate`.
4) If Gate E fails: inspect `reports/gate-e-*.json` and the citations utilization report.

### Milestone M3 — Live research canary with real web + real agents

Because Phase 05 is fixture-only today, I recommend splitting M3 into two explicit sub-milestones.

#### M3a — Live to summaries (real wave agents + online citations)

**Goal:** prove the “live core” works end-to-end through citations with reproducible artifacts.

**Required capabilities:**
- `/deep-research live` operator loop spawns real agents and ingests outputs (Wave 1).
- `citations_validate` runs in online mode (no `PAI_DR_NO_WEB`).

**Success artifacts checklist:**
- `manifest.stage.current = summaries`
- `wave-1/*.md` generated by real agent runs
- `citations/citations.jsonl` with non-empty validated pool
- `gates.gates.B.status = pass` and `gates.gates.C.status = pass`
- `citations/online-fixtures*.json` (new) captured for reproducibility

**Failure triage:**
- If Wave outputs invalid: use `deep_research_wave_output_validate` error to drive a bounded retry.
- If citations blocked: inspect `citations.jsonl` records where `status=blocked` and the ladder notes.

#### M3b — Live to finalize (requires Phase 05 generate mode)

**Goal:** prove a true research run can produce summaries/synthesis/review without fixture inputs.

**Work required:**
- Implement `mode=generate` in:
  - `.opencode/tools/deep_research/summary_pack_build.ts`
  - `.opencode/tools/deep_research/synthesis_write.ts`
  - `.opencode/tools/deep_research/review_factory_run.ts`

**Success artifacts checklist:**
- `manifest.stage.current = finalize`
- `summaries/*.md` generated
- `synthesis/final-synthesis.md` generated
- `review/review-bundle.json` generated
- Gate D/E passed with reports present under `reports/`

---

## Long-run (1h+) strategy

For 1h+ runs, “pleasant” means: predictable pauses, clear progress, safe resumes, bounded retries, and non-catastrophic web flakiness.

Concrete strategy:

1) **Stage-level checkpoints are the unit of work.**
   - The operator loop should stop cleanly at stage boundaries unless explicitly told to continue.
   - The run root is the “project folder”; do not re-init for small changes.

2) **Watchdog enforced with actionable checkpoint artifacts.**
   - `deep_research_watchdog_check` already writes `logs/timeout-checkpoint.md`.
   - Extend it (or the operator loop) to include “last known subtask” and pointers to the last audit/telemetry events.

3) **Telemetry-driven progress and postmortems.**
   - Emit stage lifecycle telemetry via `deep_research_telemetry_append`.
   - Periodically compute metrics via `deep_research_run_metrics_write`.
   - A single glance at `metrics/run-metrics.json` should tell you where time went.

4) **Reproducibility is default, not a special action.**
   - Capture fixture bundles at major boundaries using `deep_research_fixture_bundle_capture`.
   - For online citations, capture `online-fixtures` after each successful run.

5) **Bounded retries with explicit changes.**
   - Use `deep_research_retry_record` for gates.
   - Use manifest constraints deltas for scope changes (“tighten sources”, “reduce max sources”, etc.).

---

## Suggested roadmap

### Week 1 — Make it runnable and resumable (pleasant core)

- Implement `/deep-research live` as a full operator loop to `summaries` (M3a), using:
  - `deep_research_run_init`
  - `deep_research_perspectives_write`
  - `deep_research_wave1_plan`
  - Task-spawned agents → `deep_research_wave_output_ingest`
  - `deep_research_wave_review` → `deep_research_gate_b_derive` → `deep_research_gates_write`
  - `deep_research_stage_advance` (authority)
  - `deep_research_orchestrator_run_post_pivot`

- Add `inspect/resume` operator commands that surface `stage_advance` evaluation blocks.

- Move all operator knobs from env vars to `.opencode/settings.json` via the already-present `flags_v1.ts` settings loader.

### Week 2–3 — Implement generate mode for Phase 05 (true live to finalize)

- Add `mode=generate` implementations for:
  - summary building
  - synthesis writing
  - reviewer aggregation

- Expand entity tests to cover the generate path with deterministic fixtures for the *agent outputs* (not the Phase 05 artifacts).

### Week 4 — Online citations hardening + reproducibility

- Add online fixture capture and a stable operator story for blocked URLs.
- Add a canary test that runs citations online against a small stable URL set.

### Week 5 — Observability polish and long-run drills

- Wire telemetry into the operator loop.
- Add an operator drill that simulates a stage timeout and documents recovery.

---

## Appendix: key paths referenced in this review

- Operator command doc: `.opencode/commands/deep-research.md`
- Tool map doc: `.opencode/Plans/DeepResearchOptionC/2026-02-16/06-tool-and-path-map.md`
- Progress tracker: `.opencode/Plans/DeepResearchOptionC/deep-research-option-c-progress-tracker.md`

- Tools:
  - `.opencode/tools/deep_research/*`
  - notably: `run_init.ts`, `stage_advance.ts`, `wave_output_ingest.ts`, `citations_validate.ts`, orchestrator ticks/runs

- Tests:
  - `.opencode/tests/entities/deep_research_orchestrator_*.test.ts`
- Fixtures:
  - `.opencode/tests/fixtures/runs/*`
