# Deep Research Option C — Engineer Review (raw, v2)

Date: 2026-02-18

Repo: `/Users/zuul/Projects/pai-opencode-graphviz` (branch: `graphviz`)

This is a *concrete, implementation-minded* review of the current Option C pipeline, focused on making it **pleasant**, efficient, and iteration-friendly for real research.

I’m treating “pleasant” as: **(1)** minimal reruns, **(2)** obvious next steps when blocked, **(3)** stable operator commands, **(4)** run artifacts that make progress auditable, **(5)** easy partial reruns and deterministic replay.

---

## Executive summary

Option C already has a strong “artifact core” that supports deterministic orchestration and replay:

- **Run roots + schemas**: `.opencode/tools/deep_research_cli/run_init.ts` writes `manifest.v1` and `gates.v1` with stable artifact paths and constraints snapshot (`manifest.query.constraints.deep_research_flags`).
- **Authoritative stage machine**: `.opencode/tools/deep_research_cli/stage_advance.ts` is the gatekeeper for stage transitions and surfaces a structured `decision.evaluated[]` explaining exactly *what* is missing/blocked.
- **Orchestrator ticks exist** for fixture, live (wave1), post-pivot (citations), and post-summaries (phase05):
  - `.opencode/tools/deep_research_cli/orchestrator_tick_fixture.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`
- **Deterministic fixture completion exists**: `Tools/deep-research-option-c-fixture-run.ts` drives a full offline run to `finalize` using fixture artifacts.

What’s making Option C *not yet pleasant for real research* is not missing “core schemas”—it’s missing a cohesive **operator loop** that:

1) **Aligns scope before wave1** (time budget, constraints, deliverable shape, “what counts as done”).
2) **Runs real Wave 1** with agent fan-out, captures outputs deterministically, and supports bounded retries that don’t require rerunning earlier work.
3) **Runs citations online** with predictable behavior under blocking/paywalls and captures reproducibility fixtures.
4) **Unblocks live end-to-end** by implementing **generate-mode** for Phase 05 (summaries/synthesis/review), not fixture-only.
5) Provides **operator-grade observability** (progress, metrics, blockers, pause/resume semantics).

Smallest “pleasantness” critical path (in order):

- **P0:** Make `/deep-research live` a real run loop: `init → wave1 → pivot → citations → summaries` (and at minimum `synthesis/review` via a deterministic “generate-mode” reviewer).
- **P0:** Add a **preflight scope calibration artifact** (brief + budgets + constraints + deliverables) persisted to run root and reflected in `manifest.query.constraints` before wave1 planning.
- **P0:** Make web citations operational without manual env-var setup by moving citation endpoints into **settings or run-config artifacts** (still allowing env overrides), and by always producing **online fixtures**.
- **P1:** Finish live end-to-end by enabling **Phase 05 generate mode** in:
  - `.opencode/tools/deep_research_cli/summary_pack_build.ts`
  - `.opencode/tools/deep_research_cli/synthesis_write.ts`
  - `.opencode/tools/deep_research_cli/review_factory_run.ts`
- **P1:** Tighten the “iteration loop”: cheap partial reruns, explicit retry recording (`deep_research_retry_record`), and first-class triage output.

---

## Where we are today (facts)

### Operator surfaces that exist

1) **Slash command doc contract**: `.opencode/commands/deep-research.md`
   - Defines `/deep-research <mode> "<query>" ...` with modes `plan | fixture | live`.
   - Routes to the CLI `bun ".opencode/pai-tools/deep-research-option-c.ts" ...`.

2) **Typed CLI exists** (cmd-ts), with subcommands and strict typing:
   - `.opencode/pai-tools/deep-research-option-c.ts`
   - Commands include: `init`, `tick`, `run`, `status`, `inspect`, `triage`, `pause`, `resume` (see `subcommands` near the end of file).
   - CLI already writes `run-config.json` into run root and prints a stable contract (`run_id`, `run_root`, `manifest_path`, `gates_path`, `stage.current`, `status`).

3) **Orchestrator ticks exist and are testable without OpenCode agent spawning**
   - Live tick takes an injected driver function: `orchestrator_tick_live(... drivers: { runAgent } ...)` in `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`.
   - The CLI currently provides a “manual operator input driver” (`createOperatorInputDriver`) that writes:
     - `operator/prompts/<stage>/<perspective_id>.md`
     - `operator/drafts/<stage>/<perspective_id>.md`
     and waits for ENTER, then reads the draft and returns it (see `.opencode/pai-tools/deep-research-option-c.ts` around prompt/draft write).

### Artifact-first run substrate

1) **Run init**: `.opencode/tools/deep_research_cli/run_init.ts`
   - Writes `manifest.json` with:
     - `manifest.query.text`
     - `manifest.query.constraints.deep_research_flags` snapshot
     - `manifest.limits.*` caps
     - `manifest.artifacts.paths.*` canonical artifact layout
   - Writes `gates.json` with Gate A–F set `not_run`.

2) **Stage advancement**: `.opencode/tools/deep_research_cli/stage_advance.ts`
   - Enforces stage transitions and, on failure, returns a structured decision including `evaluated[]` with missing artifacts and gate status.
   - This is an **ideal “operator blocker API”**—it just needs a first-class UX.

3) **Web citations pipeline is present and already has reproducibility seams**:
   - Extract URLs: `.opencode/tools/deep_research_cli/citations_extract_urls.ts`
   - Normalize + deterministic cid mapping: `.opencode/tools/deep_research_cli/citations_normalize.ts`
   - Validate: `.opencode/tools/deep_research_cli/citations_validate.ts`
     - In online mode, it uses an “online ladder” (`direct_fetch → bright_data → apify`) implemented in `.opencode/tools/deep_research_cli/citations_validate_lib.ts`.
     - It currently reads endpoints from env vars (`PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT`, `PAI_DR_CITATIONS_APIFY_ENDPOINT`) in `.opencode/tools/deep_research_cli/citations_validate.ts`.
     - It writes `citations/found-by.json` (used to stabilize future behavior) and can emit deterministic “blocked url” items with action hints.

### Deterministic completion is proven (offline)

- Smoke test exists and passes fixture completion logic:
  - `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`
  - It asserts ordered stage transitions ending at `review->finalize` and requires audit events.

### Live end-to-end is **not** proven

- The “live” smoke tests are currently skeleton TODOs that expect an already-run `PAI_DR_TEST_RUN_ROOT`:
  - `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
  - `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

---

## Biggest gaps blocking real research

1) **Live operator loop is not cohesive across stages.**
   - You have multiple orchestrators (`orchestrator_tick_live`, `orchestrator_tick_post_pivot`, `orchestrator_tick_post_summaries`) but the operator UX still feels like “run some commands with absolute paths until something works.”

2) **Scope alignment is not a first-class artifact.**
   - `run_init` snapshots flags into `manifest.query.constraints.deep_research_flags`, but there is no run-local “brief” that captures: intended audience, time budget, must/should deliverables, do-not-do constraints, max sources, and *what constitutes completion*.

3) **Phase 05 generate-mode isn’t available end-to-end.**
   - Tools expose `mode: fixture|generate` but key parts still act fixture-first.
   - Even where `generate` exists (e.g., `.opencode/tools/deep_research_cli/review_factory_run.ts` has a generate branch), the operator path needs to consistently pick the right mode and persist its artifacts.

4) **Wave execution still needs a reliable “agent runner” layer.**
   - `orchestrator_tick_live.ts` supports an injected `drivers.runAgent` function, but there is no “blessed” driver that:
     - spawns agents
     - captures outputs
     - validates output contracts
     - retries with recorded material-change notes
     - converges efficiently.

5) **Citations online mode requires manual endpoint wiring, and reproducibility is not yet the default.**
   - Online ladder exists, but endpoints are env-only today (`citations_validate.ts`).
   - Pleasant real research needs: “run web citations → always emit online fixtures → replay later without web.”

6) **Observability exists as primitives but isn’t consistently emitted in operator loops.**
   - Telemetry tools exist:
     - `.opencode/tools/deep_research_cli/telemetry_append.ts`
     - `.opencode/tools/deep_research_cli/run_metrics_write.ts`
   - They need to be wired as “always-on” in the operator loop (and stage ticks should produce predictable telemetry events).

---

## Concrete improvements (prioritized)

### P0 — Time-waste killers (stop burning minutes per iteration)

#### P0.1 Eliminate “rerun everything”: make every operator action **resume-first**

**Symptom:** if anything fails, you tend to restart from `init` because resuming is cognitively expensive.

**Existing substrate:**
- `run_init` returns `{ created: false }` if a run root already exists with manifest/gates (`.opencode/tools/deep_research_cli/run_init.ts`).
- CLI already has `pause` and `resume` (`.opencode/pai-tools/deep-research-option-c.ts`).

**Concrete fix:**
- Extend the CLI surface to accept **run_id OR run_root** for *all* commands, and resolve manifest/gates paths automatically.
  - Implementation home: `.opencode/pai-tools/deep-research-option-c.ts`
  - Use existing helpers already present: `resolveRunRoot`, `safeResolveManifestPath`, `resolveGatesPathFromManifest`.

**What “pleasant” looks like:**
- After a restart, the operator can run:
  - `deep-research-option-c run --run-id <id> --driver live --reason "resume"`
  and the CLI resolves everything and continues from `manifest.stage.current`.

#### P0.2 Make blocker output obvious: expose `stage_advance` evaluated failures as a stable UX primitive

**Symptom:** when blocked, you open multiple artifacts to discover which file/gate is missing.

**Existing substrate:**
- `stage_advance` already produces a structured decision containing `evaluated[]` entries with `{ kind: artifact|gate, ok, details.path }` (`.opencode/tools/deep_research_cli/stage_advance.ts`).
- CLI already has `triage` which does a *dry-run* stage advance on temp copies and summarizes missing artifacts/gates (`stageAdvanceDryRun` + `triageFromStageAdvanceResult` in `.opencode/pai-tools/deep-research-option-c.ts`).

**Concrete fix:**
- Make `triage` the *first thing printed* whenever a `tick` is blocked (fixture or live). Don’t make operators remember to run it.
- Add a “compact blockers” output contract that always includes:
  - requested transition (`from`, `to`)
  - missing artifacts list (absolute + relative)
  - blocked gates list
  - one-sentence remediation hint per item

#### P0.3 Make retries explicit and bounded (and always recorded)

**Symptom:** “try again” loops waste time and create non-reproducible runs.

**Existing substrate:**
- `deep_research_retry_record` exists and enforces caps via `GATE_RETRY_CAPS_V1` (`.opencode/tools/deep_research_cli/retry_record.ts`).
- `orchestrator_tick_live.ts` already wires `retry_record` and even has helper `getRetryChangeNote(...)` for wave-review directives.

**Concrete fix:**
- For every Gate-critical stage retry (B/C/D/E), enforce:
  1) `retry_record(manifest_path, gate_id, change_note, reason)`
  2) then rerun stage logic
  3) and append telemetry `stage_retry_planned` (see Observability section)

This makes iteration intentional and prevents accidental flakiness.

---

### P0 — Scope alignment before run (calibrate before Wave 1)

#### P0.4 Add a mandatory preflight that writes a run-local “research brief” artifact

**Goal:** before wave1, decide “what good looks like” and bound the work.

**Existing substrate that should carry scope state:**
- `manifest.query.constraints` is already the place where deterministic run constraints live (`run_init.ts`).

**Concrete artifact proposal:**
- `brief/brief.md` + `brief/brief.json` under run root, versioned schema `brief.v1`, containing:
  - question decomposition (subquestions)
  - non-goals / exclusions
  - time budget per stage
  - source policy (min primary sources, no blogs, allow arXiv, etc.)
  - citation policy (must cite claims; allowed citation statuses)
  - output format contract (sections, max length)
  - “stop conditions” (when to halt and ask operator)

**Where to implement:**
- CLI (`.opencode/pai-tools/deep-research-option-c.ts`) can implement `preflight` as an interactive (but *typed*) command that writes the artifact and patches manifest via `manifest_write`.

**How to make it pleasant:**
- `init` should optionally run `preflight` automatically in `--mode deep` and store the brief summary in `manifest.query.constraints.brief_summary`.

---

### P0 — Iteration mechanics (avoid re-research)

#### P0.5 Treat the run root as a cache: never overwrite evidence artifacts; use retry-n paths

**Existing design intent:**
- Many tools are already artifact-first and compute `inputs_digest` for determinism.

**Concrete policy:**
- For each stage, write artifacts into stable locations *and* keep retry history:
  - e.g., `wave-1/retry-01/<p>.md`, `citations/retry-02/citations.jsonl`, etc.
  - Keep stable “current” symlinks or copies if you want ergonomics, but never destroy evidence.

**Map to existing tools:**
- `deep_research_retry_record` already records `metrics.retry_history[]` in manifest.
- `orchestrator_tick_live.ts` already writes output metadata sidecars for wave outputs (see `writeOutputMetadataSidecar`).

#### P0.6 Make replay and fixture capture a first-class operator action

**Goal:** after a live run, produce a deterministic fixture bundle so the run can be replayed offline.

**Existing tool surface:**
- `deep_research_fixture_bundle_capture` (`.opencode/tools/deep_research_cli/fixture_bundle_capture.ts`)
- `deep_research_fixture_replay` (`.opencode/tools/deep_research_cli/fixture_replay.ts`)

**Concrete UX:**
- Add `deep-research-option-c capture-fixtures --manifest ... --bundle-id ...` that:
  - captures citations online fixtures
  - captures wave outputs
  - captures summary/synthesis/review inputs
  - writes a bundle manifest with hashes

---

### P0 — LLM + agent orchestration (reliable convergence)

#### P0.7 Define and implement a “blessed wave runner” driver

You already have the right boundary: `orchestrator_tick_live` depends on a `drivers.runAgent` function.

What’s missing is a reliable driver contract that covers:

1) **Prompt creation**: write prompt to run root (`operator/prompts/...`) and include:
   - scope from the run brief
   - per-perspective tool budgets
   - required sections (`Findings`, `Sources`, `Gaps`) (this is already in the default perspective payload in `.opencode/commands/deep-research.md`).
2) **Agent spawn**: spawn one agent per perspective (or per plan entry) and capture raw markdown output.
3) **Ingest**: call `deep_research_wave_output_ingest` to atomically write outputs and validate contract.
   - Tool: `.opencode/tools/deep_research_cli/wave_output_ingest.ts`
4) **Validate/review**: run `deep_research_wave_output_validate` and `deep_research_wave_review`.
5) **Retry**: if wave-review emits directives:
   - call `deep_research_retry_record` (Gate B)
   - rerun only failing perspectives
6) **Gate + stage**: derive Gate B via `deep_research_gate_b_derive` and write via `deep_research_gates_write`, then `deep_research_stage_advance`.

**Where to implement without changing OpenCode:**
- Implement the wave runner in the *slash command* (`.opencode/commands/deep-research.md`) as the orchestration layer that can call the Task tool in-chat, and then call the deterministic tools to persist results.
- Keep `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts` as a deterministic “engine” used by tests and by non-chat drivers.

---

### P0 — Web citations (real web, blocking, reproducibility)

#### P0.8 Default to reproducible “online fixtures” in live mode

**Current behavior:**
- Online citations ladder exists, but endpoints are configured via env vars inside `.opencode/tools/deep_research_cli/citations_validate.ts`.

**Concrete improvements:**
1) **Persist effective citation config** in `run-config.json` (already written by CLI):
   - `.opencode/pai-tools/deep-research-option-c.ts` writes `run-config.json` including `citation_validation_tier` and endpoint tool IDs.
   - Extend it to also include endpoint URLs (if configured) and whether online fixtures are required.
2) **Always write `citations/online-fixtures.json`** during online validation.
   - If a URL is blocked/paywalled, store a deterministic fixture with `status=blocked|paywalled` + action hint (see `blockedUrlAction` in `.opencode/tools/deep_research_cli/citations_validate.ts`).
3) **Support `online_dry_run=true`** as a first operator pass:
   - Use it to get deterministic classification without network; then selectively escalate.

#### P0.9 Blocking and paywalls: make the escalation ladder an explicit operator choice

Concrete operator policy:

- Stage `citations` should produce *one of*:
  - Gate C PASS
  - Gate C FAIL with a **blocked list** artifact containing:
    - normalized URL
    - status (blocked/paywalled)
    - next action

Then the operator chooses:
1) replace URLs (edit `citations/url-replacements.json`)
2) escalate ladder step (enable Bright Data / Apify)
3) accept paywalled sources if allowed by sensitivity policy

This is how you avoid time-waste from “randomly rerun citations and hope it works.”

---

### P0 — Observability (operator UX for long runs)

#### P0.10 Make telemetry always-on at the operator layer

**Existing tools:**
- `deep_research_telemetry_append`: `.opencode/tools/deep_research_cli/telemetry_append.ts`
- `deep_research_run_metrics_write`: `.opencode/tools/deep_research_cli/run_metrics_write.ts`
- `deep_research_watchdog_check`: `.opencode/tools/deep_research_cli/watchdog_check.ts`

**Concrete event model (minimal):**
- `run_status`: running|paused|failed|completed
- `stage_started`: { stage_id, stage_attempt }
- `stage_finished`: { stage_id, stage_attempt, outcome, elapsed_s }
- `stage_retry_planned`: { stage_id, gate_id, attempt, change_note }
- `watchdog_timeout`: { stage_id, elapsed_s, timeout_s }

**Where to emit:**
- In the operator loop (`/deep-research live` driver), not deep inside individual tools.
- This keeps tools deterministic and keeps observability stable.

#### P0.11 Progress updates should be derived from artifacts, not conversation state

Pleasant long runs require you can always answer:
- “What stage are we in?” → `manifest.stage.current`
- “What is blocked?” → `stage_advance` decision via CLI `triage`
- “How long has this been running?” → telemetry + metrics
- “What changed last tick?” → audit log + stage history

Artifacts already exist:
- `logs/audit.jsonl` (append-only) is asserted by fixture smoke tests.

---

## Proposed operator UX (commands + examples)

This is the operator-facing contract I’d converge on: **stable, typed, run-id-first, resume-first**. The CLI is already a good base (`cmd-ts` typing, safe path resolution, run-config printing). The remaining pleasantness improvements are mainly **ergonomics** and **stable input forms**.

### P1 — CLI/operator UX (stable commands, typed, minimal configuration)

#### P1.1 Make `run_id` the primary handle; absolute paths are secondary

Today most commands accept `--manifest <abs>` and often `--gates <abs>`.

Concrete proposal (without touching OpenCode):

- Add a common flag group to `.opencode/pai-tools/deep-research-option-c.ts`:
  - `--run-id <id>` OR `--run-root <abs>`
  - optional overrides: `--manifest-rel manifest.json`, `--gates-rel gates.json`
  - resolve everything via `~/.config/opencode/research-runs/<run_id>` (this is already the canonical run root described in `.opencode/Plans/DeepResearchOptionC/2026-02-16/07-bootstrap-and-operator-commands.md`).

Examples:

```bash
# create and immediately preflight
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --mode deep --sensitivity normal

# one-tick progress, auto-resolving manifest/gates from run-id
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --run-id dr_20260218_001 --driver live --reason "operator: tick"

# run until blocked or completed
bun ".opencode/pai-tools/deep-research-option-c.ts" run --run-id dr_20260218_001 --driver live --reason "operator: run" --max-ticks 50

# explain blockers
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --run-id dr_20260218_001
```

#### P1.2 “No env vars” in practice: make config explicit and inspectable

Reality check: some env vars are still used (notably citations endpoints in `.opencode/tools/deep_research_cli/citations_validate.ts`).

Concrete proposal:

- Primary configuration should be a **run artifact**, not env:
  - `run-config.json` is already written by the CLI; extend it to include citation endpoints and web mode.
- Tools should accept explicit inputs **or** read from `run-config.json` if present.
- Env vars remain as last-resort overrides (for CI), but operator UX never requires them.

#### P1.3 Make `/deep-research` command doc an “operator brain,” not just a router

`.opencode/commands/deep-research.md` currently documents the intended flow. The pleasantness win is making the command itself reliably drive the loop:

- `plan`: run init + preflight + perspectives_write + wave1_plan; stop.
- `fixture`: init + run fixture driver until terminal/halt; print triage on halt.
- `live`: init + preflight + then a stage switch loop:
  - wave1: spawn agents → ingest → review → gate B → stage_advance
  - pivot/citations: run post-pivot orchestrator tick → gate C → stage_advance
  - summaries/synthesis/review: run post-summaries orchestrator tick (generate mode)
  - always print contract fields

This uses **existing tools**; it doesn’t require OpenCode changes.

---

## Acceptance tests (M2, M3) with artifact checklist

You already have an excellent M1 offline proof lattice.

To make “real research” credible, you need **two evidence runs** that produce *auditable artifacts* and have clear triage steps.

### M2 — Live Wave 1 works (init → pivot)

**Target evidence**

- Stage reaches `pivot` (see `.opencode/Plans/DeepResearchOptionC/spec-stage-machine-v1.md`).
- Gate B is derived from `wave-review.json` (per testing plan v2) and written to `gates.json`.
- Run root contains wave outputs + validation artifacts.

**Success artifacts checklist (minimum)**

- `manifest.json`:
  - `stage.current === "pivot"`
  - `status === "running"` (or paused if operator chooses)
- `gates.json`:
  - Gate B status `pass`
- `wave-1/wave1-plan.json`
- `wave-1/<perspective_id>.md` (at least 1)
- `wave-review.json`
- `logs/audit.jsonl` includes manifest writes and gates writes

**Existing test placeholder (needs to become real)**

- `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
  - currently expects `PAI_DR_TEST_RUN_ROOT` pre-set.

**Failure triage steps (operator runbook)**

1) `deep-research-option-c status --manifest <abs>`
2) `deep-research-option-c triage --manifest <abs>` (uses stage_advance dry-run)
3) inspect audit log: `logs/audit.jsonl`
4) if Gate B blocked:
   - read `wave-review.json` retry directives
   - record retry: `deep_research_retry_record` (Gate B)
   - rerun only failing perspectives

### M3 — Live end-to-end finalize

**Target evidence**

- Run reaches `finalize`, `manifest.status === "completed"`.
- Gate E pass recorded.
- Phase 05 artifacts are generated (not fixture directories).

**Success artifacts checklist (minimum)**

- `manifest.json`:
  - `stage.current === "finalize"`
  - `status === "completed"`
- `summaries/summary-pack.json`
- `synthesis/final-synthesis.md`
- `review/review-bundle.json`
- `reports/gate-e-status.json` and it indicates pass
- `gates.json`:
  - Gate E status `pass`
- `logs/audit.jsonl`

**Existing test placeholder (needs to become real)**

- `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

**Failure triage steps**

1) `deep-research-option-c triage --manifest <abs>`
2) If blocked at citations:
   - inspect `citations/blocked-urls.json` (proposed) and `citations/found-by.json`
   - decide: replace URLs vs escalate ladder vs accept paywall
3) If review loops:
   - inspect `review/review-bundle.json` directives
   - record retry: `deep_research_retry_record` (Gate E)
   - rerun synthesis/review only

---

## Long-run (1h+) strategy

For 1h+ runs, “pleasant” means you can pause, resume, and recover without conversation context.

Concrete strategy (all artifact-derived):

1) **Hard time bounds per tick**
   - Enforce `deep_research_watchdog_check` before and after ticks (`.opencode/tools/deep_research_cli/watchdog_check.ts`).
2) **Pause/resume is first-class**
   - CLI already has `pause` and `resume` (`.opencode/pai-tools/deep-research-option-c.ts`).
   - Ensure pause writes a checkpoint that includes:
     - current stage
     - next action
     - last emitted blockers summary
3) **Observability always-on**
   - Append telemetry events every tick (`deep_research_telemetry_append`).
   - Periodically compute `metrics/run-metrics.json` (`deep_research_run_metrics_write`).
4) **Reproducibility by default**
   - Always capture online fixtures for citations.
   - Capture fixture bundles after milestone runs (`deep_research_fixture_bundle_capture`).
5) **Operator UX: stop conditions that ask for decisions**
   - When a hard gate blocks (B/C/D/E): halt with blockers summary and ask operator to choose a path (retry with change note vs replace inputs vs stop).

---

## Suggested roadmap

### Phase 0 (1–3 days): make live runs *not annoying*

- Add preflight brief artifact + manifest patching.
- Make CLI accept `--run-id` everywhere; minimize absolute paths.
- Auto-print `triage` summary on every block.
- Wire telemetry + metrics emission in operator loop.

### Phase 1 (3–7 days): prove M2 live wave1

- Implement “blessed wave runner” in `/deep-research live` command doc:
  - spawn agents per wave1 plan
  - ingest with `deep_research_wave_output_ingest`
  - derive Gate B and advance stage
- Turn `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts` into an executable evidence run (no pre-set run root).

### Phase 2 (1–2 weeks): citations online + fixture capture

- Move citation endpoints into run-config and/or settings; env remains optional override.
- Always produce `citations/online-fixtures.json`.
- Add a standard blocked/paywall remediation artifact.
- Add a post-run fixture bundle capture step.

### Phase 3 (1–2 weeks): M3 live finalize

- Implement or complete Phase 05 generate mode end-to-end:
  - summaries
  - synthesis
  - review + bounded revision control
- Make `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts` executable.

### Phase 4 (ongoing): hardening

- Expand regression suite (`.opencode/tests/regression/**`) with captured bundles.
- Add operator drills to `operator-drills-log-v1.md` for predictable recovery.

---

## Appendix — Existing tool/command IDs referenced above

Operator CLI:
- `.opencode/pai-tools/deep-research-option-c.ts`

Deterministic tools (export barrel):
- `.opencode/tools/deep_research_cli/index.ts`

Key tools:
- `deep_research_run_init` (`.opencode/tools/deep_research_cli/run_init.ts`)
- `deep_research_stage_advance` (`.opencode/tools/deep_research_cli/stage_advance.ts`)
- `deep_research_retry_record` (`.opencode/tools/deep_research_cli/retry_record.ts`)
- `deep_research_wave_output_ingest` (`.opencode/tools/deep_research_cli/wave_output_ingest.ts`)
- `deep_research_citations_validate` (`.opencode/tools/deep_research_cli/citations_validate.ts`)
- `deep_research_telemetry_append` (`.opencode/tools/deep_research_cli/telemetry_append.ts`)
- `deep_research_run_metrics_write` (`.opencode/tools/deep_research_cli/run_metrics_write.ts`)

Specs:
- `.opencode/Plans/DeepResearchOptionC/spec-stage-machine-v1.md`
- `.opencode/Plans/DeepResearchOptionC/2026-02-16/05-testing-plan-v2.md`
