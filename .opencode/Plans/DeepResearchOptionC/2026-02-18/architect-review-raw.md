## Executive summary (bullet)

- **Option C has a strong deterministic “artifact core”** (manifest/gates schemas, atomic writers, stage advance authority, audit logging) that can support resumable runs if orchestration is completed. (Evidence: `.opencode/tools/deep_research/run_init.ts:154-225`, `.opencode/tools/deep_research/manifest_write.ts:23-84`, `.opencode/tools/deep_research/gates_write.ts:16-95`, `.opencode/tools/deep_research/stage_advance.ts:283-408,509-551`)
- **The implemented orchestration is currently split into three partial orchestrators**, and only one stage segment is truly “live” today: `init/wave1 -> pivot`. Post-pivot and post-summaries ticks are effectively **fixture/offline pipelines** (citations use dry-run + offline fixtures; summaries/synthesis/review are fixture-only). (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:487-525,589-660,668-776`; `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:738-766,769-907`; `.opencode/tools/deep_research/summary_pack_build.ts:58-64`; `.opencode/tools/deep_research/synthesis_write.ts:51-57`; `.opencode/tools/deep_research/review_factory_run.ts:47-53`)
- **Wave execution is single-perspective only** in the live orchestrator tick (it takes `entries[0]` and ingests exactly one output), so even “Wave 1” is not actually Wave 1 (multi-perspective) as designed. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:589-606,645-660,768-776`)
- **Wave 2 is not orchestrated at all**: stage machine supports it, but `orchestrator_tick_post_pivot` always tries to advance pivot → citations (and will be blocked when pivot decides `wave2_required=true`). (Evidence: `.opencode/tools/deep_research/stage_advance.ts:186-199,226-244,298-341,344-383`; `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:738-745`)
- **Operator surface is fragmented and env-var dependent**: `/deep-research` doc explicitly instructs setting env vars (and still carries a `NOT_IMPLEMENTED` fallback for stage-advance), while Bun CLIs exist only for fixture-run and stage-advance wrapper. There is no single “operator CLI” that is fully self-contained (no env vars) and supports plan/fixture/live end-to-end. (Evidence: `.opencode/commands/deep-research.md:75-90,101-121,124-148`; `.opencode/tools/deep_research/run_init.ts:52-61`; `.opencode/tools/deep_research/citations_validate.ts:63-71`; `Tools/deep-research-option-c-fixture-run.ts:158-160`; `Tools/deep-research-option-c-stage-advance.ts:15-30`)
- **Doc/implementation drift already exists**: the operator-facing tool map says `wave_output_ingest` is “Planned (not implemented yet)”, but it exists and is exported. This is a small but telling sign that “operator truth” is not yet consolidated. (Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/06-tool-and-path-map.md:72-77`; `.opencode/tools/deep_research/index.ts:18-22`; `.opencode/tools/deep_research/wave_output_ingest.ts:109-117`)
- **Resumability is plausible but not yet productized**: the disk artifacts are durable, stage transitions are authoritative and validated, but there is no run-level lock, no explicit pause/resume command, weak optimistic locking usage, and no orchestration loop that treats `watchdog_check` as mandatory. (Evidence: `.opencode/tools/deep_research/lifecycle_lib.ts:349-362`; `.opencode/tools/deep_research/stage_advance.ts:535-539`; `.opencode/tools/deep_research/gates_write.ts:33-38`; `.opencode/tools/deep_research/watchdog_check.ts:25-143`)

---

## Current architecture map (diagram in text ok)

### Layering (what exists today)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Operator surfaces                                                           │
│  - Slash command doc: .opencode/commands/deep-research.md                    │
│  - Bun CLIs:                                                                 │
│    • Tools/deep-research-option-c-fixture-run.ts                             │
│    • Tools/deep-research-option-c-stage-advance.ts                           │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tool surface (plugin tools exported by .opencode/tools/deep_research/index.ts)│
│  - Run lifecycle: run_init, stage_advance, manifest_write, gates_write        │
│  - Wave tooling: perspectives_write, wave1_plan, wave_output_ingest/validate  │
│               wave_review, gate_b_derive                                      │
│  - Pivot + citations: pivot_decide, citations_* , gate_c_compute              │
│  - Phase05: summary_pack_build, gate_d_evaluate, synthesis_write,             │
│             review_factory_run, gate_e_reports, gate_e_evaluate,              │
│             revision_control                                                  │
│  - Safety/ops: watchdog_check, retry_record, run_metrics_write, telemetry_*   │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Orchestrators (tick loops)                                                   │
│  - live: orchestrator_tick_live / orchestrator_run_live                       │
│          (init|wave1 -> pivot only, single perspective)                       │
│  - post-pivot: orchestrator_tick_post_pivot / orchestrator_run_post_pivot     │
│          (pivot -> citations -> summaries, but citation validation is dry-run)│
│  - post-summaries: orchestrator_tick_post_summaries / orchestrator_run_post_* │
│          (summaries -> synthesis -> review -> finalize, fixture-only inputs)  │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Durable Run Root (source of truth)                                           │
│  - manifest.json (schema v1; stage.current + history; status)                 │
│  - gates.json (schema v1; A..F; revision; lifecycle rules)                    │
│  - logs/audit.jsonl (best-effort append; not yet a “ledger”)                  │
│  - wave-1/, wave-2/, citations/, summaries/, synthesis/, review/, reports/    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stage machine (implemented authority)

The authoritative transition graph is encoded in `stage_advance` (and echoed in the spec doc).

- Allowed stages: `init, wave1, pivot, wave2, citations, summaries, synthesis, review, finalize`. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:61-64`; `.opencode/Plans/DeepResearchOptionC/spec-stage-machine-v1.md:6-15`)
- Allowed transitions are hard-coded in `allowedNextFor(...)` and additionally constrained by artifact/gate preconditions. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:186-199,283-408`)

### Orchestrator segmentation (current behavior)

- **Live tick** only: `init → wave1 → pivot` and only for a single `entries[0]` perspective. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:487-525,527-606,618-666,668-776`)
- **Post-pivot tick**: if `stage=current=pivot`, it ensures `pivot.json` exists (via `pivot_decide` if missing) and then tries to advance **pivot → citations**. This inherently fails for `wave2_required=true` runs. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:720-766`; `.opencode/tools/deep_research/stage_advance.ts:344-383`)
- **Post-summaries tick** is effectively a fixture pipeline to finalize: it requires absolute fixture paths for summaries, draft, and review bundle. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:460-479,559-579,607-627`)

---

## What’s solid vs what’s missing

### What’s solid (implementation strength)

1) **Artifact-first run initialization**

- `run_init` creates a run root, standardized directories, and writes both `manifest.json` and `gates.json` via atomic JSON writers. It also writes a ledger line best-effort. (Evidence: `.opencode/tools/deep_research/run_init.ts:130-152,154-234`)
- The manifest stores the configured limits and a snapshot of “deep research flags” in `query.constraints.deep_research_flags`, which helps postmortem analysis. (Evidence: `.opencode/tools/deep_research/run_init.ts:161-189`)

2) **Atomic writers with schema validation + revision bump**

- `manifest_write` bumps `revision` and updates `updated_at`, validates schema, then writes atomically. It blocks patches that touch immutable fields. (Evidence: `.opencode/tools/deep_research/manifest_write.ts:37-40,49-63`)
- `gates_write` enforces a strict patch surface and gate lifecycle rules (e.g., hard gate can’t be `warn`; `checked_at` required). (Evidence: `.opencode/tools/deep_research/gates_write.ts:47-58`)

3) **Stage transition authority + deterministic “decision digest”**

- `stage_advance` is the central authority and refuses transitions unless preconditions are met.
- It computes `inputs_digest = sha256(...)` from a structured `digestInput` including `from/to`, revisions, gate statuses, and `evaluated` checks. That digest is embedded in manifest `stage.history`. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:484-507,516-533`)
- Preconditions cover the critical gates/artifacts (e.g., wave1->pivot requires wave dir + wave-review.json + Gate B pass). (Evidence: `.opencode/tools/deep_research/stage_advance.ts:287-296`)
- Pivot transitions include explicit policy: `pivot -> citations` is rejected when `run_wave2=true`. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:344-383`)

4) **Deterministic planning and validation for Wave artifacts**

- `wave1_plan` sorts perspectives by id and computes an `inputs_digest` for reproducibility. (Evidence: `.opencode/tools/deep_research/wave1_plan.ts:99-103,108-128,155-166`)
- `wave_output_validate` enforces section headings, word budget, and “Sources” list constraints. (Evidence: `.opencode/tools/deep_research/wave_output_validate.ts:77-118`)
- `wave_review` aggregates validations, emits bounded retry directives, and can write a JSON report artifact. (Evidence: `.opencode/tools/deep_research/wave_review.ts:207-236`)
- `wave_output_ingest` is unusually defensive: path traversal checks, realpath containment checks, staged writes + rollback patterns. (Evidence: `.opencode/tools/deep_research/wave_output_ingest.ts:33-55,174-249`)

5) **Citation pipeline is “deterministic first” by construction**

- URL extraction is deterministic and stable-ordered (recursive scan + sort, bounded “found-by” indexing). (Evidence: `.opencode/tools/deep_research/citations_extract_urls.ts:98-104,140-177`)
- URL normalization computes deterministic cids (cid derived from normalized URL). (Evidence: `.opencode/tools/deep_research/citations_normalize.ts:88-120`)
- `gate_c_compute` deterministically computes validation rates and creates a stable `inputs_digest` based on extracted and citations sets. (Evidence: `.opencode/tools/deep_research/gate_c_compute.ts:133-175`)

6) **Watchdog exists and matches the policy spec defaults**

- Timeouts per stage match spec defaults, and watchdog failure patches `manifest.status=failed`, appends failure, and writes a checkpoint file. (Evidence: `.opencode/tools/deep_research/lifecycle_lib.ts:352-362`; `.opencode/tools/deep_research/watchdog_check.ts:59-143`; `.opencode/Plans/DeepResearchOptionC/spec-watchdog-v1.md:19-43`)

### What’s missing (gaps to reach true M2/M3)

I’ll frame “maturity” as:

- **M1**: deterministic fixture pipeline to finalize (works offline)
- **M2**: live wave execution (multi-perspective) + deterministic ingest/validation + pivot
- **M3**: live end-to-end including citations (online ladder), summaries, synthesis, review, pausability, and long-run safety

#### Pipeline completeness gaps

1) **No single orchestrator owns the whole graph**

- Orchestrator logic is segmented across: `live`, `post_pivot`, `post_summaries`, but there is no “run manager” that can take `init` and drive to `finalize` across these modules.
- The `/deep-research` doc acknowledges live is a skeleton. (Evidence: `.opencode/commands/deep-research.md:124-148`)

2) **Live Wave 1 isn’t Wave 1 (no multi-perspective fan-out)**

- Live tick reads a plan but only uses `entries[0]`, ingests 1 output, validates 1 output, reviews `[perspectiveId]`, then advances to pivot. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:589-606,645-660,682-697,768-776`)
- This fails the orchestrator design intent (“perspectives plural”, bounded retries, explicit stop conditions) laid out in `03-orchestrator-design.md`. (Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/03-orchestrator-design.md:13-21,24-31,47-50`)

3) **Wave 2 is structurally supported by stage_advance, but orchestrator has no wave2 handler**

- `stage_advance` enforces the wave2 policy and cap (`wave2_gap_ids.length <= max_wave2_agents`). (Evidence: `.opencode/tools/deep_research/stage_advance.ts:323-340`)
- `orchestrator_tick_post_pivot` does not attempt pivot → wave2; it attempts pivot → citations unconditionally when stage is pivot. That will deterministically fail for wave2-required pivot decisions. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:738-745`; `.opencode/tools/deep_research/stage_advance.ts:344-383`)

4) **Citations validation is not truly live yet**

- `citations_validate` has an “online ladder” path, but it is controlled by env (`PAI_DR_NO_WEB`, `PAI_DR_CITATIONS_ONLINE_DRY_RUN`) and expects optional endpoints for Bright Data / Apify. (Evidence: `.opencode/tools/deep_research/citations_validate.ts:63-80,102-104,219-235`)
- The post-pivot orchestrator currently calls `citations_validate` with `online_dry_run: true` and writes deterministic offline fixtures first; i.e., it explicitly disables network even in the “online” path. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:804-825`)

5) **Summaries / synthesis / review are fixture-only**

- `summary_pack_build` rejects non-fixture mode: `if (mode !== "fixture") return ... "only fixture mode is supported"`. (Evidence: `.opencode/tools/deep_research/summary_pack_build.ts:58-64`)
- `synthesis_write` is also fixture-only. (Evidence: `.opencode/tools/deep_research/synthesis_write.ts:51-57`)
- `review_factory_run` is fixture-only. (Evidence: `.opencode/tools/deep_research/review_factory_run.ts:47-53`)

This is the defining blocker for “real research runs”: after pivot, the pipeline is still effectively a deterministic offline harness.

6) **Retry directives exist (wave_review), but no orchestrator consumes them**

- `wave_review` emits `retry_directives`, but live tick does not read those directives nor schedule retries. (Evidence: `.opencode/tools/deep_research/wave_review.ts:207-236`; `.opencode/tools/deep_research/orchestrator_tick_live.ts:682-697`)
- The design doc expects retries to be explicit, bounded, and recorded via `deep_research_retry_record`. That wiring is not present in orchestrators. (Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/03-orchestrator-design.md:252-301`)

#### Operator interface / ergonomics gaps

7) **Env-var dependence is still operator-critical**

- `run_init` refuses to run unless Option C is enabled via flags (settings/env). (Evidence: `.opencode/tools/deep_research/run_init.ts:52-57`; `.opencode/tools/deep_research/lifecycle_lib.ts:125-158`)
- `/deep-research` doc instructs setting env vars as step 1 across modes. (Evidence: `.opencode/commands/deep-research.md:75-83,103-106,126-131`)
- `citations_validate` chooses offline/online mode via env (`PAI_DR_NO_WEB`). (Evidence: `.opencode/tools/deep_research/citations_validate.ts:63-71`)

8) **Operator surface is split across “doc-as-command” and “bun CLI tools”**

- The command doc contains a stage-advance fallback to a Bun wrapper on `NOT_IMPLEMENTED`. (Evidence: `.opencode/commands/deep-research.md:58-71`)
- A wrapper exists (`Tools/deep-research-option-c-stage-advance.ts`) but is not integrated as the canonical CLI; it’s described as a fallback rather than the primary operator path. (Evidence: `.opencode/commands/deep-research.md:60-66`; `Tools/deep-research-option-c-stage-advance.ts:15-30`)

#### Resumability, pauseability, and long-running safety gaps

9) **No run-level lock / concurrency guard**

- `manifest_write` supports optimistic locking via `expected_revision`. (Evidence: `.opencode/tools/deep_research/manifest_write.ts:42-47`)
- `stage_advance` calls `manifest_write` without an `expected_revision`, so concurrent orchestrators could race and last-write-wins. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:535-539`)
- `gates_write` also supports `expected_revision`, but orchestrators don’t supply it. (Evidence: `.opencode/tools/deep_research/gates_write.ts:33-38`; `.opencode/tools/deep_research/orchestrator_tick_live.ts:734-743`)

10) **Pause/resume semantics exist in schema, not in operator tools**

- Manifest status enum includes `paused` and `cancelled`. (Evidence: `.opencode/tools/deep_research/lifecycle_lib.ts:349-351`)
- There is no dedicated tool or command that sets status paused/cancelled with a durable reason, and stage_advance never transitions to paused/cancelled. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:525-533`)

11) **Watchdog exists but isn’t mandatory in orchestration**

- There is no orchestration loop shown (live or fixture) that calls `watchdog_check` before/after each tick. (Evidence: `.opencode/tools/deep_research/orchestrator_run_live.ts:239-299` (no watchdog usage))

12) **No “tick ledger” / stable tick id**

- `stage_advance` records history entries with `inputs_digest`, but orchestrators do not record a stable tick id that uniquely identifies each orchestration decision boundary.
- This matters for 1h+ runs: you need a durable “where did we stop and why” index beyond append-only audit events.

---

## Determinism & dynamic seams

### What “deterministic” should mean here (pragmatic definition)

There are two determinism targets that are often conflated:

1) **Replay determinism (fixture determinism)**
   - Given a fixed set of fixture inputs (wave outputs, citation fixtures, summary fixtures, review fixtures), the tool pipeline should produce identical outputs.
2) **Run determinism (idempotency under resume)**
   - Given a run root on disk, rerunning the orchestrator after a restart should either:
     - do nothing (all required artifacts already exist and validate), or
     - advance in exactly one safe next way.

Option C is clearly optimized for (1) already, and has a strong base for (2). What’s missing is bounding the **dynamic seams** so that real runs are stable and auditable.

### Deterministic anchors (good seams)

These are places where you are already doing the right thing:

- **Stage decisions are derived from disk state + deterministic checks** and are recorded with `inputs_digest`. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:484-507,516-533`)
- **Wave planning is stable-ordered and digest-backed**. (Evidence: `.opencode/tools/deep_research/wave1_plan.ts:99-103,108-128`)
- **URL extraction & normalization are stable-ordered**, bounded, and digest-backed. (Evidence: `.opencode/tools/deep_research/citations_extract_urls.ts:98-104,140-177`; `.opencode/tools/deep_research/citations_normalize.ts:108-127`)
- **Gate updates require an explicit `inputs_digest` at write time** (a strong audit invariant). (Evidence: `.opencode/tools/deep_research/gates_write.ts:16-25,62-66`)

### Non-deterministic seams (current footguns)

I’ll be explicit about where “the same conceptual run” can diverge today.

#### Seam 1: Environment variables as implicit inputs

- `run_init` resolves flags from settings and env, and will refuse to run unless Option C is enabled. (Evidence: `.opencode/tools/deep_research/run_init.ts:52-57`; `.opencode/tools/deep_research/lifecycle_lib.ts:125-158,200-206`)
- `citations_validate` chooses offline/online mode via `PAI_DR_NO_WEB` and online dry run via `PAI_DR_CITATIONS_ONLINE_DRY_RUN`. (Evidence: `.opencode/tools/deep_research/citations_validate.ts:63-80`)

**Why this matters:** env-vars are usually not recorded, not versioned, and easy to forget on resume. While `run_init` snapshots some flags into the manifest (good), later tools can still consult env and silently diverge.

**Bound it (recommendation):**

- Treat env as a **bootstrap-only override**. After `run_init`, all downstream tools should prefer manifest-captured flags over env.
- For operators, provide a single CLI/command that always prints the effective flags and writes them into a run-local “run-config.json”.

#### Seam 2: Time as an implicit input

- `run_init` writes `created_at`/`updated_at` using `nowIso()` (real time). (Evidence: `.opencode/tools/deep_research/run_init.ts:154-160`)
- `manifest_write` updates `updated_at = nowIso()`. (Evidence: `.opencode/tools/deep_research/manifest_write.ts:55-58`)
- `citations_validate` sets citation record `checked_at` to `manifest.updated_at` else `nowIso()`. (Evidence: `.opencode/tools/deep_research/citations_validate.ts:96-97`)

**Why this matters:** time changes digests indirectly (because artifacts change), makes fixture replay vs live runs structurally different, and complicates “same inputs, same outputs” claims.

**Bound it (recommendation):**

- Make “digest inputs” deliberately time-agnostic whenever possible (hash content, not timestamps).
- Keep timestamps for auditability, but keep them **out of digest payloads** unless you are explicitly modeling them.
- Introduce a driver-provided clock in orchestrators (the design doc calls for `drivers.nowIso()`), and record it per tick.

#### Seam 3: LLM outputs (wave markdown) as unbounded entropy

- Live tick accepts `drivers.runAgent` markdown and writes it via `wave_output_ingest`, then validates and gates. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:618-666,668-680`)

**What’s good:** the wave output contract validation bounds some of the entropy (sections, word count, sources format). (Evidence: `.opencode/tools/deep_research/wave_output_validate.ts:77-118`)

**What’s missing:**

- There is no deterministic retry loop that consumes `wave_review.retry_directives`.
- There is no systematic way to record “why the LLM changed output between retries” beyond a freeform `change_note` (which is not yet wired).

**Bound it (recommendation):**

- Treat `wave_review.retry_directives[].change_note` as a contract and force the agent prompt to include it verbatim.
- Record every agent run attempt as an append-only artifact (never overwrite); make the “current” pointer explicit.
- Persist an “agent-run ledger” per perspective: attempt number, tool inputs hash, tool outputs hash.

#### Seam 4: File system state (extra files) influencing stage decisions

- `stage_advance` checks `evalDirHasFiles` for wave dirs and includes `count` in decision evaluation. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:102-115,287-289`)

**Why this matters:** stray files (even operator/debug artifacts) can change `count` and therefore `inputs_digest` and history, and in some cases could satisfy “dir has files” while containing the wrong files.

**Bound it (recommendation):**

- Make wave dir precondition checks more specific (e.g., require wave plan and at least N expected `*.md` outputs).
- Consider ignoring known non-evidence artifacts (`*.tmp`, `*.staged`, etc.) in counts.

#### Seam 5: Orchestrator partitioning

- Today, the “orchestrator” is not a single deterministic state machine; it’s three disjoint runners with different assumptions.

**Why this matters:** partition seams become nondeterministic seams (operator forgets to run the right module, uses different reason strings, uses different fixture settings).

**Bound it (recommendation):**

- Provide one run loop that dispatches by `manifest.stage.current` and is the only operator entrypoint.

---

## Operator CLI recommendation (exact spec)

### Current state (what exists)

- A slash-command doc describes `/deep-research <mode> "<query>" ...` but relies on env-vars and labels live as skeleton. (Evidence: `.opencode/commands/deep-research.md:10-17,75-98,124-148`)
- Two Bun CLIs exist:
  - **Fixture runner** (`Tools/deep-research-option-c-fixture-run.ts`) which sets env and drives a fixture pipeline toward finalize using orchestrators. (Evidence: `Tools/deep-research-option-c-fixture-run.ts:158-160,195-201,327-341`)
  - **Stage-advance wrapper** (`Tools/deep-research-option-c-stage-advance.ts`) a thin wrapper around the tool, intended as fallback. (Evidence: `Tools/deep-research-option-c-stage-advance.ts:15-30,112-117`)

### What should exist (single operator-grade CLI)

You asked: “single CLI that the LLM/operator can drive without env vars.” I agree: **one entrypoint** is essential for long runs and for keeping the operator surface deterministic.

#### Proposed CLI binary

Create (recommendation) a single Bun CLI:

```
bun Tools/deep-research-option-c.ts <command> [args]
```

Command vocabulary should map 1:1 to lifecycle semantics and avoid “magic”.

#### Commands and flags (exact spec)

```
NAME
  deep-research-option-c — operator CLI for Option C runs

USAGE
  bun Tools/deep-research-option-c.ts init "<query>" [--run-id <id>] [--mode quick|standard|deep] [--sensitivity normal|restricted|no_web]
  bun Tools/deep-research-option-c.ts tick --manifest <abs> --gates <abs> --reason "<reason>" [--driver fixture|live]
  bun Tools/deep-research-option-c.ts run  "<query>" [--run-id <id>] [--driver fixture|live] [--mode ...] [--sensitivity ...]
  bun Tools/deep-research-option-c.ts status --manifest <abs>
  bun Tools/deep-research-option-c.ts pause  --manifest <abs> --reason "<reason>"
  bun Tools/deep-research-option-c.ts resume --manifest <abs> --reason "<reason>"

COMMON FLAGS
  --runs-root <abs>              Override runs root (no env required)
  --no-web                       Force no-web behavior (writes into run config)
  --citation-online-dry-run      Force online ladder dry run (writes into run config)
  --citation-brightdata <url>    Optional endpoint
  --citation-apify <url>         Optional endpoint
  --max-wave1-agents <n>         Overrides manifest.limits at init time
  --max-wave2-agents <n>
  --max-review-iterations <n>
  --timeout-stage <stage>=<sec>  Optional per-run overrides

PRINT CONTRACT (all commands)
  Always print (machine parseable):
    run_id
    run_root
    manifest_path
    gates_path
    stage.current
    status
    last_decision_inputs_digest (if available)
```

#### Naming consistency

- Use “Option C” consistently in CLI naming and output.
- Prefer `--run-id` over `--run_id` (but accept both for compatibility).

#### How to avoid env vars without changing OpenCode core

Because some tools currently consult env (`PAI_DR_NO_WEB`, citations endpoints), the CLI can be self-contained by:

1) **Writing a run-local config artifact** (e.g., `<run_root>/run-config.json`) and
2) **Injecting required env-vars only within the CLI process** (as `process.env` assignments) derived from that config.

This does not require any OpenCode changes; it’s purely operator tooling.

### How the slash command doc should relate to the CLI

Recommendation: slash command `/deep-research ...` should be a thin wrapper that calls the CLI and prints its output. Keep `/deep-research` doc as the chat UX contract, but make the CLI the actual implementation.

Evidence the doc already has “operator surface contract” and a print contract to standardize output. (Evidence: `.opencode/commands/deep-research.md:8-31`)

---

## Resumability/long-run requirements

### What works today (resumability baseline)

- **Run root is durable** and includes both `manifest.json` and `gates.json` with validated schemas. (Evidence: `.opencode/tools/deep_research/run_init.ts:211-234`; `.opencode/tools/deep_research/lifecycle_lib.ts:375-422,424-439`)
- **Stage transitions are durable**: stage history is appended through `stage_advance`, which itself persists via `manifest_write`. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:513-551`)

This means “resume after restart” is possible in principle: read manifest stage and continue.

### What is missing for safe pause/resume

#### 1) Explicit pause/cancel tools

Schema allows `paused` and `cancelled`. (Evidence: `.opencode/tools/deep_research/lifecycle_lib.ts:349-351`)

Missing operator-grade semantics:

- A tool or CLI command that sets `manifest.status=paused` with a durable reason, plus a checkpoint artifact.
- A resume action that sets status back to `running` and resets `stage.started_at` (or records a “pause interval” so watchdog doesn’t fire spuriously).

#### 2) Concurrency control (lockfiles + optimistic locking)

Today’s risk is not theoretical: concurrent operations can cause last-write-wins on manifest/gates.

- `manifest_write` supports `expected_revision`, but stage_advance does not use it. (Evidence: `.opencode/tools/deep_research/manifest_write.ts:42-47`; `.opencode/tools/deep_research/stage_advance.ts:535-539`)
- `gates_write` supports `expected_revision`, but orchestrators do not use it. (Evidence: `.opencode/tools/deep_research/gates_write.ts:33-38`; `.opencode/tools/deep_research/orchestrator_tick_live.ts:734-743`)

Minimum requirements:

- A run-root lockfile (`<run_root>/.lock`) containing PID, hostname, session id, and a timestamp.
- Tooling that refuses to run ticks when lock is held (unless `--force`).
- Always use `expected_revision` when writing gates/manifest from orchestrators.

#### 3) Idempotency and evidence preservation policies

The design doc calls out “never overwrite primary evidence artifacts” and suggests `retry-N` artifacts. (Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/03-orchestrator-design.md:213-223`)

Current reality:

- Live orchestrator skips agent run if output already exists (`outputAlreadyExists`). (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:618-620`)
- There is no naming scheme for retries and no “pointer” artifact for which attempt is current.

Requirements:

- A canonical attempt naming scheme for wave outputs.
- A small JSON pointer per perspective identifying “active output”.
- A retry directives artifact at a stable location in the run root (the spec suggests `retry/retry-directives.json`). (Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/03-orchestrator-design.md:258-284`)

#### 4) Watchdog integration

`watchdog_check` exists and writes failure/timeout checkpoint, but it is not enforced in orchestrators. (Evidence: `.opencode/tools/deep_research/watchdog_check.ts:25-143`; `.opencode/tools/deep_research/orchestrator_run_live.ts:239-299`)

For 1h+ runs, you need:

- A “tick wrapper” that calls watchdog at the start/end of each tick and halts deterministically on timeout.
- A deterministic “now_iso” injection for fixture runs.

### What breaks today for 1h+ runs (concrete failure modes)

1) **No integrated run loop across stages**: operator must manually stitch `run_live` + `run_post_pivot` + `run_post_summaries`.
2) **Tick caps are low** (10, 5, 8): these are fine for unit tests but not for real runs that may require retries and pauses. (Evidence: `.opencode/tools/deep_research/orchestrator_run_live.ts:9-18`; `.opencode/tools/deep_research/orchestrator_run_post_pivot.ts:9-15`; `.opencode/tools/deep_research/orchestrator_run_post_summaries.ts:9-23`)
3) **Live path is incomplete** beyond pivot; summaries/synthesis/review are fixture-only.
4) **Env state is not durable**: resuming a run in a new shell/session can silently change behavior.
5) **No lockfiles / optimistic locking**: two sessions can corrupt progress.
6) **Watchdog not mandatory**: silent hangs remain possible at the operator layer.

---

## Skill recommendations (names + workflows)

You asked what skills should exist in PAI so I can reliably orchestrate Option C. I’m describing these as PAI “skills” (a packaging/unit-of-reliability concept), independent of OpenCode core changes.

### Skill: `deep-research-option-c`

#### Workflow 1: `RunPlan`

Goal: create a run root + perspectives + wave1 plan, stop at `stage=wave1`.

Tool sequence (deterministic):

1) `deep_research_run_init` (with explicit `mode` and `sensitivity`) (Evidence tool exists: `.opencode/tools/deep_research/run_init.ts:33-41`)
2) `deep_research_perspectives_write` (not reviewed in-depth here, but it is part of the tool map) (Evidence mapping: `.opencode/Plans/DeepResearchOptionC/2026-02-16/06-tool-and-path-map.md:49-52`)
3) `deep_research_stage_advance` requested_next=wave1 (Evidence: `.opencode/tools/deep_research/stage_advance.ts:283-285`)
4) `deep_research_wave1_plan` (Evidence: `.opencode/tools/deep_research/wave1_plan.ts:23-31`)

Validation contract (mechanical):

- [ ] `manifest.json` exists and validates schema v1
- [ ] `gates.json` exists and validates schema v1
- [ ] `perspectives.json` exists inside run root
- [ ] `wave-1/wave1-plan.json` exists and contains `inputs_digest`

#### Workflow 2: `RunFixtureToFinalize`

Goal: run deterministic fixture scenario end-to-end.

Implementation surface:

- Prefer invoking the existing fixture runner CLI (`Tools/deep-research-option-c-fixture-run.ts`) until a unified CLI exists. (Evidence: `Tools/deep-research-option-c-fixture-run.ts:33-45`)

Validation contract:

- [ ] CLI exits 0
- [ ] `manifest.status` is `completed`
- [ ] `manifest.stage.current` is `finalize`

#### Workflow 3: `RunLiveWave1ToPivot`

Goal: execute Wave 1 live (multi-perspective), ingest outputs, validate, Gate B, advance to pivot.

Current reality: only single perspective is supported in `orchestrator_tick_live`. (Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:589-606`)

Skill should therefore enforce a stronger contract than the code currently does:

- Plan must contain N entries and the workflow must attempt all N (bounded by `max_wave1_agents`). (Evidence of cap enforcement at plan creation: `.opencode/tools/deep_research/wave1_plan.ts:88-97`)

Validation contract:

- [ ] `wave_output_ingest` succeeded for each perspective
- [ ] `wave_review.pass` is true and `retry_directives` empty
- [ ] Gate B status is `pass` in `gates.json`
- [ ] `manifest.stage.current` advanced to `pivot`

#### Workflow 4: `TickUntilStop`

Goal: generic “resume-safe” loop: read manifest stage and call the correct orchestrator tick.

Behavior:

- Dispatch by `manifest.stage.current` into:
  - live tick (init/wave1)
  - post-pivot tick (pivot/citations)
  - post-summaries tick (summaries/synthesis/review)
- Call `watchdog_check` before and after tick.
- Stop on typed errors (`GATE_BLOCKED`, `MISSING_ARTIFACT`, `*_CAP_EXCEEDED`, etc.) and write a `logs/halt.json`.

Validation contract:

- [ ] After each tick, either stage advanced or a typed stop artifact is written
- [ ] No tick mutates manifest except via `stage_advance` or `manifest_write`

#### Workflow 5: `PauseRun` / `ResumeRun`

Goal: safe pause/resume for long interactive research.

Minimum contract:

- `PauseRun` writes:
  - `manifest.status=paused`
  - `logs/pause-checkpoint.md` including stage + next step
- `ResumeRun` writes:
  - `manifest.status=running`
  - resets stage timer semantics (so watchdog works)

### Skill: `deep-research-citations-online`

Why separate: citation validation is the first place live runs hit network surfaces and rate limits.

Workflows:

- `ValidateCitationsOnline` (runs `citations_validate` in online mode with deterministic ladder configuration)
- `CaptureFixtures` (captures deterministic fixtures for future replay)

Validation contract:

- [ ] `citations.jsonl` exists and is JSONL-parseable
- [ ] Gate C passes
- [ ] No URLs with userinfo; any redaction triggers invalidation (Evidence: `.opencode/tools/deep_research/citations_validate.ts:237-243`)

---

## Risk register

Top 10 concrete risks/footguns and pragmatic mitigations.

1) **Wave2-required runs cannot progress post-pivot**
   - Risk: orchestrator always requests pivot→citations; stage_advance will block when pivot says wave2 required.
   - Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:738-745`; `.opencode/tools/deep_research/stage_advance.ts:344-383`.
   - Mitigation: implement wave2 orchestrator stage handler (pivot→wave2), then wave2 execution, then citations.

2) **Live Wave 1 is single perspective; false sense of completeness**
   - Evidence: `.opencode/tools/deep_research/orchestrator_tick_live.ts:589-606`.
   - Mitigation: implement multi-perspective fan-out and a deterministic join (validate/review across all perspectives, then Gate B).

3) **Summaries/synthesis/review fixture-only: cannot do real research end-to-end**
   - Evidence: `.opencode/tools/deep_research/summary_pack_build.ts:58-64`; `.opencode/tools/deep_research/synthesis_write.ts:51-57`; `.opencode/tools/deep_research/review_factory_run.ts:47-53`.
   - Mitigation: add `mode=generate` implementations; enforce boundedness and inputs digests.

4) **Env-vars as hidden run inputs break resume determinism**
   - Evidence: `.opencode/tools/deep_research/citations_validate.ts:63-71`.
   - Mitigation: persist effective config into run root; tools should prefer manifest/run-config.

5) **Concurrent orchestrators can race on manifest/gates**
   - Evidence: `.opencode/tools/deep_research/stage_advance.ts:535-539` (no expected_revision).
   - Mitigation: lockfile + always pass expected revisions.

6) **Watchdog exists but is not enforced; silent hangs possible at operator layer**
   - Evidence: `.opencode/tools/deep_research/watchdog_check.ts:25-143`; absence in `.opencode/tools/deep_research/orchestrator_run_live.ts:239-299`.
   - Mitigation: make watchdog mandatory in tick loop; always write halt artifacts.

7) **Doc drift causes operator mistakes**
   - Evidence: `.opencode/Plans/DeepResearchOptionC/2026-02-16/06-tool-and-path-map.md:72-77` vs `.opencode/tools/deep_research/index.ts:18-22`.
   - Mitigation: generate operator maps from code (or at least validate docs in tests).

8) **Stage preconditions are too weak in places (e.g., “dir has files”)**
   - Evidence: `.opencode/tools/deep_research/stage_advance.ts:102-115,287-289`.
   - Mitigation: strengthen preconditions to expected files and/or schema validation.

9) **Citation “online ladder” is underspecified operationally**
   - Evidence: online endpoints are read from env; orchestrator currently forces dry-run. (Evidence: `.opencode/tools/deep_research/citations_validate.ts:102-104`; `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:813-825`)
   - Mitigation: define deterministic ladder policy (timeouts, retry caps, caching, evidence capture) and make it run-local.

10) **Stage timeouts do not incorporate “pause time” semantics**
   - Evidence: watchdog computes elapsed from `manifest.stage.started_at` and current time. (Evidence: `.opencode/tools/deep_research/watchdog_check.ts:69-80`)
   - Mitigation: pause/resume tool must reset timer or track paused intervals.

---

## Readiness rubric

Pass/fail checklist for “ready for real research runs” (not just fixtures).

### A) Tool wiring and schemas

- [ ] All Option C tools return JSON envelopes as strings (ok/error). (Spot evidence: multiple tools use `err(...)`/`ok(...)` returning JSON strings, e.g. `.opencode/tools/deep_research/lifecycle_lib.ts:321-323`)
- [ ] `manifest.json` and `gates.json` validate, and all writers are atomic and revisioned. (Evidence: `.opencode/tools/deep_research/manifest_write.ts:49-63`; `.opencode/tools/deep_research/gates_write.ts:62-71`)
- [ ] `stage_advance` is the only path that moves stages and it records `inputs_digest` in history. (Evidence: `.opencode/tools/deep_research/stage_advance.ts:516-533`)

### B) Orchestration completeness (must be true for “real run”)

- [ ] Live orchestrator executes **all** Wave 1 perspectives (fan-out), ingests all outputs, validates all outputs, and produces a wave review report that passes.
- [ ] If pivot decides wave2 required, orchestrator executes wave2 and proceeds.
- [ ] Citation validation can run online (not dry-run) under a bounded deterministic ladder, and Gate C can pass.
- [ ] Summaries/synthesis/review have `mode=generate` and do not require fixture paths.

Current status: FAIL (single perspective live; wave2 missing; citations forced dry-run; phase05 fixture-only).

### C) Operator interface ergonomics

- [ ] Single operator CLI exists that requires **no env vars** and prints the required run contract.
- [ ] Slash commands (if present) call the CLI; docs match actual behavior.
- [ ] `status`, `pause`, `resume` are first-class.

Current status: FAIL (env required; no unified CLI; pause/resume not implemented as operator actions).

### D) Resumability / restart safety

- [ ] Run-root lockfile prevents concurrent ticks.
- [ ] Orchestrator is idempotent: rerunning `tick` from the same stage does not overwrite evidence.
- [ ] Watchdog is enforced around ticks; timeouts produce terminal artifacts.

Current status: PARTIAL (artifact-first + stage authority exist; locking and enforced watchdog missing).

### E) Web citations and evidence capture

- [ ] Each fetched source has captured evidence (status, title/snippet, retrieval path) and is associated with `cid`.
- [ ] The ladder’s chosen step is recorded per URL.
- [ ] Sensitive URLs are redacted and invalidate citations if userinfo present.

Current status: PARTIAL (policy and redaction exist; live retrieval is not yet exercised end-to-end).

---

## Next 10 concrete steps

1) **Unify the orchestrator into a single stage-dispatching run loop** that reads `manifest.stage.current` and calls the correct stage handler (no manual module stitching).

2) **Implement live multi-perspective Wave 1 execution**:
   - iterate over all `wave1-plan.json` entries (bounded by `max_wave1_agents`)
   - spawn agents (driver boundary) and ingest outputs for each
   - run `wave_review` on the full wave output directory
   - apply Gate B from the review report

3) **Implement retry directive consumption**:
   - read `wave_review.retry_directives`
   - write a stable `retry/retry-directives.json`
   - schedule bounded reruns with explicit `change_note` in prompts
   - record retries via `deep_research_retry_record`

4) **Implement Wave 2 orchestration**:
   - on pivot stage, if `wave2_required=true`, advance to wave2 and run wave2 plan/execution
   - only then proceed to citations

5) **Make citations truly live-capable**:
   - define deterministic ladder config policy (timeouts, retry caps, caching)
   - run `citations_validate` online (not dry-run), and capture per-URL attempt logs

6) **Add `mode=generate` implementations for summaries, synthesis, and review** so “real research runs” can complete beyond citations.

7) **Add run-level locking + optimistic locking**:
   - write lockfile in run root
   - pass `expected_revision` for all gates/manifest writes

8) **Integrate watchdog enforcement into the run loop**:
   - call `watchdog_check` at tick boundaries
   - ensure pause/resume semantics don’t trigger false timeouts

9) **Deliver a single operator CLI** (`Tools/deep-research-option-c.ts`) and refactor the slash command doc to call it.

10) **Add a docs-vs-code drift test** that asserts the operator tool map matches `index.ts` exports (prevent repeat of the `wave_output_ingest` mismatch).

🗣️ Marvin: I mapped what’s implemented, what’s still fixture-only, and exactly what blocks real end-to-end live runs.
