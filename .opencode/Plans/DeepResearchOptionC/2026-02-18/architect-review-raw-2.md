🤖 Deep Research Option C — Architect Review (raw-2)

Date: 2026-02-18

Repo: `/Users/zuul/Projects/pai-opencode-graphviz` (branch: `graphviz`)

This is a pedantic, pragmatic, end-to-end architecture review of the **current** Deep Research Option C implementation: its stage machine, tool layer, orchestrators, operator CLI, determinism boundaries, and “real-run” readiness.

---

## Executive summary (bullet)

- **Option C is now materially closer to “real runs” than the 2026-02-18 raw review implies.** The biggest previously-noted gaps—Wave1 fan-out, retry directive consumption, pivot→wave2 routing, and Phase05 `mode=generate`—are implemented in code. Evidence:
  - Wave1 executes all plan entries, persists sidecars, derives Gate B, writes retry directives, records retry counts, and only then advances to pivot: `.opencode/tools/deep_research/orchestrator_tick_live.ts:650-680,703-775,814-871,919-947,999-1069,1071-1100`.
  - Pivot correctly stage-advances to **wave2 or citations** based on `pivot.json`, and wave2 execution exists: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:1362-1472,1475-1527` and policy enforcement in `.opencode/tools/deep_research/stage_advance.ts:240-279,311-397`.
  - Summaries/synthesis/review all support `mode=generate` (bounded, deterministic), and post-summaries tick selects generate mode when fixture paths are absent: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:546-644,657-711,713-858`.
  - Entity tests validate multi-perspective Wave1 and wave2 routing: `.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts:88-151`, `.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts:46-141`.

- **The “artifact core” is strong and coherent**: atomic writers + schema validation + optimistic locking, a deterministic stage authority (`stage_advance`) with an explicit decision digest, and a run-root lock/lease. Evidence:
  - Atomic manifest writer with revision bump + immutable-field enforcement: `.opencode/tools/deep_research/manifest_write.ts:23-79`.
  - Atomic gates writer with lifecycle rules + optimistic locking: `.opencode/tools/deep_research/gates_write.ts:16-88`.
  - Stage authority: allowed stage graph + preconditions + `inputs_digest` computed from evaluated checks: `.opencode/tools/deep_research/stage_advance.ts:72-78,199-212,283-421,497-535`.
  - Run lock/lease with heartbeat refresh and ownership checks: `.opencode/tools/deep_research/run_lock.ts:187-239,295-399,401-451`.

- **Operator ergonomics are now “operator-grade enough to iterate”**: there is a single CLI with `init/tick/run/status/inspect/triage/pause/resume`, a safe stage-advance dry-run, run-config emission, and watchdog enforcement around ticks. Evidence:
  - CLI command set: `.opencode/pai-tools/deep-research-option-c.ts:1122-1258`.
  - `stage_advance` dry-run by copying artifacts into `/tmp`: `.opencode/pai-tools/deep-research-option-c.ts:531-555`.
  - Run-local config persisted to `<run_root>/run-config.json`: `.opencode/pai-tools/deep-research-option-c.ts:420-464`.
  - Watchdog pre/post tick and `run` loop enforcement: `.opencode/pai-tools/deep-research-option-c.ts:714-768,906-1035`.
  - Pause/resume are durable manifest mutations with lock protection + checkpoints: `.opencode/pai-tools/deep-research-option-c.ts:1037-1113`.
  - `/deep-research` command doc already routes to this CLI: `.opencode/commands/deep-research.md:20-46`.

- **The remaining blockers for true M2/M3 are now mostly “quality and operationalization,” not “missing plumbing.”** Specifically:
  1) Live execution is still *driver-based* at the `runAgent` boundary; the default “live” driver in CLI is **operator-input**, not autonomous Task-spawned agents. Evidence: injected boundary in `.opencode/tools/deep_research/orchestrator_tick_live.ts:822-833` and operator-input driver in `.opencode/pai-tools/deep-research-option-c.ts:712-713`.
  2) Long-run (1h+) safety is currently incompatible with default stage watchdog thresholds unless you pause/resume or adjust timeout semantics. Evidence: `wave1: 600s`, `citations: 600s`, etc in `.opencode/tools/deep_research/lifecycle_lib.ts:349-362` and watchdog behavior in `.opencode/tools/deep_research/watchdog_check.ts:84-91,89-96`.
  3) Gate coverage is incomplete: **Gate A and Gate F are defined but there is no evaluator/deriver tool**, and stage transitions do not require them. Evidence: gates created in `.opencode/tools/deep_research/run_init.ts:211-225`, but only B/C/D/E are derived/evaluated by implemented tools (see exports in `.opencode/tools/deep_research/index.ts:18-39` and the absence of any `gate_a_*`/`gate_f_*` tool in grep).
  4) Online citations ladder depends on env-provided endpoints (Bright Data / Apify), which is a non-deterministic seam unless captured and replayed via fixtures. Evidence: endpoint reads in `.opencode/tools/deep_research/citations_validate.ts:114-116` and online fixture capture in `.opencode/tools/deep_research/citations_validate.ts:329-366`.

---

## Current architecture map (diagram in text ok)

### Layers and primary “source of truth”

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Operator surface (what Marvin/operator drives)                               │
│  - Slash command doc: .opencode/commands/deep-research.md                    │
│      -> delegates to CLI: bun ".opencode/pai-tools/deep-research-option-c.ts" ...      │
│        (Evidence: .opencode/commands/deep-research.md:20-46)                 │
│  - Operator CLI (single entrypoint):                                         │
│      .opencode/pai-tools/deep-research-option-c.ts                           │
│      commands: init/tick/run/status/inspect/triage/pause/resume              │
│        (Evidence: .opencode/pai-tools/deep-research-option-c.ts:1122-1258)   │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Orchestrator functions (tick-level idempotent state machines)                │
│  - orchestrator_tick_live: init|wave1 -> pivot (multi-perspective, retries)  │
│      (Evidence: orchestrator_tick_live.ts:650-680,703-775,814-871,999-1100)  │
│  - orchestrator_tick_post_pivot: pivot|wave2|citations -> summaries           │
│      (Evidence: orchestrator_tick_post_pivot.ts:1362-1472,1475-1527,1530-1698)│
│  - orchestrator_tick_post_summaries: summaries|synthesis|review -> finalize  │
│      (Evidence: orchestrator_tick_post_summaries.ts:546-644,657-711,713-858) │
│  - orchestrator_tick_fixture: fixture driver boundary + stage_advance         │
│      (Evidence: orchestrator_tick_fixture.ts:98-214)                          │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Deterministic lifecycle tools (authoritative mutations)                      │
│  - run_init: creates run root + writes manifest.json + gates.json             │
│      (Evidence: run_init.ts:33-57,92-99,154-234)                              │
│  - manifest_write / gates_write: atomic + optimistic lock + audit append      │
│      (Evidence: manifest_write.ts:23-79; gates_write.ts:16-88)                │
│  - stage_advance: ONLY stage transition authority with preconditions + digest │
│      (Evidence: stage_advance.ts:72-78,199-212,283-421,497-535,548-553)       │
│  - watchdog_check: stage timeout enforcement (fail run deterministically)     │
│      (Evidence: watchdog_check.ts:65-91,89-116,133-154)                       │
│  - run_lock: cross-process run-root lock/lease + heartbeat                    │
│      (Evidence: run_lock.ts:187-239,371-399,401-451)                          │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Durable run root (the actual source of truth)                                │
│  - manifest.json (stage.current + started_at + history; status; limits)       │
│  - gates.json (A..F statuses with checked_at + inputs_digest)                 │
│  - wave-1/, wave-2/, citations/, summaries/, synthesis/, review/, reports/,   │
│    logs/audit.jsonl, run-config.json                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Stage machine (authoritative)

The stage graph is encoded in code (authoritative) and mirrored in the spec.

- Spec table: `.opencode/Plans/DeepResearchOptionC/spec-stage-machine-v1.md:6-31`.
- Code authority:
  - Allowed stages and allowed-next table: `.opencode/tools/deep_research/stage_advance.ts:72-78,199-212`.
  - Preconditions per edge: `.opencode/tools/deep_research/stage_advance.ts:296-421,423-495`.
  - Decision digest: `.opencode/tools/deep_research/stage_advance.ts:497-535`.

---

## What’s solid vs what’s missing

### What’s solid

#### 1) Stage authority is centralized and *auditable*

- `stage_advance` is the single, explicit gatekeeper for stage transitions, combining:
  - deterministic next-stage choice when `requested_next` absent (pivot and review stages)
  - explicit precondition checks (artifact existence, gate pass, policy constraints)
  - a **decision envelope** containing `evaluated[]` + `inputs_digest` recorded in manifest history.

Evidence:
- Dynamic next stage for `pivot` and `review`: `.opencode/tools/deep_research/stage_advance.ts:239-279`.
- Preconditions mapping to artifacts/gates: `.opencode/tools/deep_research/stage_advance.ts:296-421,493-495`.
- Digest payload: `.opencode/tools/deep_research/stage_advance.ts:497-520`.
- Manifest write is optimistic-locked to avoid lost updates: `.opencode/tools/deep_research/stage_advance.ts:548-553`.

Architectural note: this is the correct design choice. It makes orchestration “policy-light” and “artifact-driven,” and enables reliable `inspect/triage` by reusing `evaluated[]`.

#### 2) Orchestrators are written like “safe tick functions,” not monolith scripts

The tick functions behave like resumable state machines:
- they read manifest/gates
- they produce/validate missing artifacts
- they update gates deterministically
- they attempt stage advance
- they return a typed result that can be looped.

Evidence:
- Live Wave1 tick plan creation if missing: `.opencode/tools/deep_research/orchestrator_tick_live.ts:650-680`.
- Multi-perspective loop + retry directive consumption: `.opencode/tools/deep_research/orchestrator_tick_live.ts:715-821,999-1069`.
- Post-pivot handles pivot→(wave2|citations) and citations→summaries: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:1362-1472,1530-1698`.
- Post-summaries supports summaries/synthesis/review and delegates finalize-vs-synthesis decision to `stage_advance`: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:546-644,657-711,827-858`.

#### 3) Concurrency control exists at two layers (good)

- **Run-root lock/lease**: acquired by orchestrators and refreshed during long ticks.
  - Evidence: lock acquire + heartbeat in fixture tick: `.opencode/tools/deep_research/orchestrator_tick_fixture.ts:162-176`; same pattern in post-pivot and post-summaries (imports and lock usage).
- **Optimistic locking for mutation tools**:
  - `stage_advance` uses `expected_revision` to protect manifest transitions: `.opencode/tools/deep_research/stage_advance.ts:65-70,548-553`.
  - Orchestrators read `gates.revision` and pass `expected_revision` into `gates_write`: e.g., live tick `.opencode/tools/deep_research/orchestrator_tick_live.ts:960-994`, post-pivot `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:1626-1659`, post-summaries `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:601-618,793-803`.

This is unusually robust for an orchestration subsystem.

#### 4) “Generate mode” exists for Phase05, while staying bounded and citation-anchored

Even without LLM-based summarization/review, the Phase05 tools can produce:
- bounded summary artifacts
- a synthesis draft with required headings
- a review bundle with deterministic checks

Evidence:
- Summary generation uses source artifacts and requires at least one validated citation: `.opencode/tools/deep_research/summary_pack_build.ts:184-246,201-212`.
- Synthesis generation composes from summary-pack + citations and enforces required headings: `.opencode/tools/deep_research/synthesis_write.ts:121-206,208-223`.
- Review generation performs deterministic checks (missing headings, unknown cids, uncited numeric claims) and emits directives: `.opencode/tools/deep_research/review_factory_run.ts:118-180`.

This is a legitimate “M3 scaffolding” that preserves deterministic replay for ops hardening—even if the resulting synthesis quality is intentionally conservative.

#### 5) Operator CLI is coherent and already supports “no env vars” *at the UX level*

Key properties:
- Single entrypoint with subcommands and consistent contract printing.
- Safe dry-run triage using temp copies.
- Watchdog enforcement at tick boundaries.
- Durable pause/resume semantics.
- Emits `<run_root>/run-config.json` capturing effective caps and config.

Evidence:
- CLI commands: `.opencode/pai-tools/deep-research-option-c.ts:1122-1258`.
- Dry-run stage advance: `.opencode/pai-tools/deep-research-option-c.ts:531-555`.
- Watchdog around live tick: `.opencode/pai-tools/deep-research-option-c.ts:714-768`.
- `run` loop watchdog + paused handling: `.opencode/pai-tools/deep-research-option-c.ts:906-940,999-1024`.
- Pause/resume: `.opencode/pai-tools/deep-research-option-c.ts:1037-1113`.
- Run config: `.opencode/pai-tools/deep-research-option-c.ts:420-464`.

### What’s missing (gaps for true M2/M3)

I’m going to define “maturity” in operational terms rather than feature-checklists:

- **M1 (offline determinism):** fixture-based or no-web runs can reach `finalize` deterministically.
- **M2 (live Wave1):** Wave1 is fully multi-perspective and retry-safe, and pivot decision is reliable.
- **M3 (real research):** citations are validated online with reproducibility artifacts; the pipeline runs end-to-end with “live” agent outputs, resumability, and long-run ops.

Where you are **today**:

#### Pipeline completeness (implemented vs spec’d)

| Stage | Spec’d in stage machine | Implemented tool support | Implemented orchestration | Operator surface |
|---|---:|---:|---:|---|
| init | yes | `run_init` creates run root + artifacts | `orchestrator_tick_live` can advance init→wave1 | CLI `init` and `tick/run` | 
| wave1 | yes | plan + ingest + validate + review + gate B derive/write | live tick loops all entries, retries, advances to pivot | CLI `tick/run --driver live` (operator-input driver) |
| pivot | yes | pivot decision artifact + stage authority | post-pivot tick generates `pivot.json` if missing and stage-advances to wave2/citations | CLI `tick/run` dispatch |
| wave2 | yes | stage authority enforces cap | post-pivot tick derives plan and executes wave2 artifacts, then advances | CLI `tick/run` dispatch |
| citations | yes | extract/normalize/validate + gate C compute/write | post-pivot tick runs citations pipeline then advances | CLI `tick/run` dispatch |
| summaries | yes | summary pack build + gate D evaluate/write | post-summaries tick runs D then advances | CLI `tick/run` dispatch |
| synthesis | yes | synthesis_write | post-summaries tick writes `final-synthesis.md` then advances | CLI `tick/run` dispatch |
| review | yes | review_factory_run + gate E evaluate/reports + revision_control | post-summaries tick loops review->(synthesis|finalize) via stage_advance | CLI `tick/run` dispatch |
| finalize | yes | stage_advance marks completed | reached via stage_advance | CLI prints status |

Evidence for critical “it’s really implemented” claims:
- Wave1 fan-out and 3 planned entries is asserted by tests: `.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts:105-112`.
- Pivot routes to wave2 and proceeds to summaries: `.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts:106-110`.

So the *pipeline plumbing* is largely there.

#### The remaining gaps are now “operational truth” gaps

1) **No autonomous in-runtime agent driver for Wave1/Wave2**
   - The orchestrator boundary requires a `drivers.runAgent` function; without a Task-spawning driver, “live mode” defaults to operator-input (manual edit) in CLI.
   - Evidence: driver boundary invocation `.opencode/tools/deep_research/orchestrator_tick_live.ts:822-833`; CLI’s operator-input driver `.opencode/pai-tools/deep-research-option-c.ts:712-713`.
   - Practical impact: you can prove orchestration correctness, but you cannot yet claim “real research runs” without manual involvement.

2) **Stage watchdog defaults are incompatible with 1h+ runs**
   - Default `STAGE_TIMEOUT_SECONDS_V1` makes Wave1/citations/summaries/synthesis 10 minutes, review 5 minutes.
   - Evidence: `.opencode/tools/deep_research/lifecycle_lib.ts:352-362`.
   - The system *can* survive long runs via pause/resume (watchdog returns early on paused status: `.opencode/tools/deep_research/watchdog_check.ts:84-91`), but “long live stage execution” will time out unless you redesign timeout semantics.

3) **Gate A and Gate F exist as concepts but are not enforced by tools**
   - Gates are created, but there is no deriver/evaluator for A or F.
   - Evidence: gate definitions in `.opencode/tools/deep_research/run_init.ts:211-225`; export surface includes `gate_b_derive`, `gate_c_compute`, `gate_d_evaluate`, `gate_e_evaluate` but nothing for A/F: `.opencode/tools/deep_research/index.ts:18-39`.
   - Practical impact: “planning completeness” and “rollout safety” are not actually part of the computational pipeline, so the system can complete without them.

4) **Online citations configuration is still partially env-driven**
   - `citations_validate` reads Bright Data/Apify endpoints from env: `.opencode/tools/deep_research/citations_validate.ts:114-116`.
   - This is acceptable as an escape hatch, but it violates the goal of “single CLI without env vars” unless the CLI writes these values into run-local config and tools consult that instead.

5) **Observability tools exist but are not integrated into the operator loop by default**
   - Telemetry/metrics tools are exported: `.opencode/tools/deep_research/index.ts:40-42`.
   - The CLI currently relies on watchdog + printed contract fields, but does not emit structured telemetry per tick.

6) **Planning artifacts are now drifted relative to implementation**
   - The charter pack workstreams still reference a `.opencode/pai-tools/deep-research-option-c.ts` CLI deliverable, while the implemented operator CLI lives in `.opencode/pai-tools/deep-research-option-c.ts`.
   - Evidence: charter WS1 expects `.opencode/pai-tools/deep-research-option-c.ts`: `.opencode/Plans/DeepResearchOptionC/2026-02-18/charter-pack/workstreams/WS1-operator-cli-and-unified-runloop.md:16-23`.
   - Readiness gates still mention “not only entries[0]” (now satisfied), but the doc should be refreshed to avoid “false gap” confusion: `.opencode/Plans/DeepResearchOptionC/2026-02-18/charter-pack/01-readiness-gates.md:50-57`.

---

## Determinism & dynamic seams

### What “deterministic enough” should mean for Option C

I recommend distinguishing three separate properties:

1) **Replay determinism (fixture determinism)**
   - Given a fully-captured fixture bundle, the pipeline replays to the same outputs.
   - You already have explicit fixture bundle capture: `.opencode/tools/deep_research/fixture_bundle_capture.ts:28-172`.

2) **Resume determinism (idempotent ticks)**
   - Given a run root on disk, rerunning a tick is safe: it either advances, or produces an explicit typed blocker without corrupting state.
   - Evidence: orchestrator ticks all follow “read/produce/validate/write/advance” and use locks + optimistic writes.

3) **Bounded dynamic generation (LLM-enabled variability, constrained)**
   - Live research will always involve non-deterministic content generation, but the system should:
     - constrain outputs via contracts (sections, sources, budgets)
     - record prompts, digests, and retry directives
     - capture online evidence for citations.

### Deterministic anchors (good seams you should preserve)

1) **Stage transitions are computed from explicit inputs, and the decision is digest-stamped**
   - `inputs_digest` hashes `{from,to, requested_next, revisions, gate statuses, evaluated[]}`.
   - Evidence: `.opencode/tools/deep_research/stage_advance.ts:497-520`.

2) **Atomic writers with schema validation enforce invariants**
   - Manifest immutable field protection + revision bump: `.opencode/tools/deep_research/manifest_write.ts:37-58`.
   - Gates lifecycle rules: `.opencode/tools/deep_research/gates_write.ts:47-58`.

3) **Stable ordering is used where it matters**
   - Wave1 planned entries are processed sequentially in plan order, with duplicate detection and containment checks: `.opencode/tools/deep_research/orchestrator_tick_live.ts:715-774`.
   - Citations URL-map items are sorted deterministically before validation: `.opencode/tools/deep_research/citations_validate.ts:146-163,306-312`.

4) **Lock/lease + optimistic locking reduce concurrency nondeterminism**
   - Evidence: `.opencode/tools/deep_research/run_lock.ts:187-239,295-399` and `expected_revision` usage as cited above.

### Non-deterministic seams (where runs can diverge) and how to bound them

#### Seam 1: Ambient environment variables override settings and can diverge on resume

- Flags come from settings.json *and* env (env wins): `.opencode/tools/deep_research/flags_v1.ts:48-63,112-160`.
- Some tool behaviors consult env directly (citation endpoints): `.opencode/tools/deep_research/citations_validate.ts:114-116`.

Why it matters:
- If a run is resumed in a different shell/host, the env state can silently change the ladder behavior, runs root, or no-web flag.

Bounding recommendation:
- Treat env as **bootstrap-only**, but after `run_init`, use run-local captured config as the source of truth.
- You already write `<run_root>/run-config.json` describing effective settings: `.opencode/pai-tools/deep-research-option-c.ts:420-464`.
- Make downstream tools consult either:
  - manifest `query.constraints.deep_research_flags` (already written by run_init: `.opencode/tools/deep_research/run_init.ts:161-176`) or
  - run-config.json
  before consulting env. (This keeps determinism while still allowing explicit overrides.)

#### Seam 2: Time as implicit input (timestamps, tokenized filenames)

- Manifest and gates writers update timestamps: `.opencode/tools/deep_research/manifest_write.ts:55-58`; `.opencode/tools/deep_research/gates_write.ts:62-66`.
- Citations online fixtures are written as `online-fixtures.<ts>.json`: `.opencode/tools/deep_research/citations_validate.ts:329-366`.

Why it matters:
- Time isn’t a correctness problem, but it *is* a replay/diff noise problem and complicates deduplication.

Bounding recommendation:
- Keep timestamps out of digests unless they’re intentional.
- Prefer writing a stable “latest pointer” file (e.g., `citations/online-fixtures.latest.json`) that points to the timestamped file; use it in operator flows.

#### Seam 3: LLM output variability in Wave1/Wave2 (the fundamental dynamic seam)

Current bounds that already exist:
- Output contract validation is enforced: `.opencode/tools/deep_research/wave_output_validate.ts` (not reprinted here; see wave review usage below).
- Wave review aggregates and issues retry directives: `.opencode/tools/deep_research/orchestrator_tick_live.ts:919-933,999-1069`.
- Retry directives are consumed by injecting them into the prompt deterministically: `.opencode/tools/deep_research/orchestrator_tick_live.ts:818-821`.
- A prompt digest and sidecar metadata are persisted and test-validated: `.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts:127-138`.

Bounding recommendation:
- **Make the retry directive artifact a first-class “tick input”** and always record which directives were consumed in the sidecar, not only the prompt digest.
- For “real runs,” implement a Task-backed driver that logs `agent_run_id`, timestamps, and tool budgets (the types already allow `agent_run_id`: `.opencode/tools/deep_research/orchestrator_tick_live.ts:48-57`).

#### Seam 4: Online citations network variability

Current bounds:
- Online ladder classification captures an `online-fixtures.*.json` record and a `blocked-urls.json` with actionable next steps: `.opencode/tools/deep_research/citations_validate.ts:344-359`.

Remaining bounding work:
- Decide whether “blocked URLs” fail Gate C (hard) or become a typed “operator intervention required” stop with a resumable directive.
- Surface `blocked-urls.json` in operator CLI (`inspect/triage`) so the operator sees what to do next.

---

## Operator CLI recommendation (exact spec)

### Do we have a single operator CLI without env vars?

**Yes, effectively.** The repository already contains a single operator-grade CLI with stable commands and a consistent contract print.

Evidence:
- CLI exists and defines the canonical command set: `.opencode/pai-tools/deep-research-option-c.ts:1122-1258`.
- `/deep-research` doc already delegates to it: `.opencode/commands/deep-research.md:20-46`.

However, “no env vars” is currently a **UX property** (the CLI sets/relies on env internally as needed) rather than a **full determinism property** (ambient env can still affect some downstream behavior).

### Recommended canonical invocation + naming

Canonical invocation (as already documented):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" <command> [...flags]
```

Command name (internal): `deep-research-option-c` (already present as cmd-ts app name: `.opencode/pai-tools/deep-research-option-c.ts:1246-1258`).

I recommend treating this as the only supported entrypoint; the root-level `Tools/deep-research-option-c-*.ts` scripts should be framed as developer harnesses (fixture runner, stage-advance wrapper) rather than operator surfaces.

### Exact CLI spec (current + recommended deltas)

#### `init`

**Current** (matches command doc):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" \
  [--run-id <id>] \
  [--sensitivity normal|restricted|no_web] \
  [--mode quick|standard|deep] \
  [--no-perspectives]
```

Evidence: `.opencode/commands/deep-research.md:30-38` and CLI args `.opencode/pai-tools/deep-research-option-c.ts:1122-1141`.

**Recommendation (delta):** add `--perspectives <abs>` to allow operator-provided perspectives without relying on editing files post-init.

#### `tick`

**Current:**

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" tick \
  --manifest <abs> --gates <abs> \
  --reason "..." \
  --driver fixture|live
```

Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1143-1160`.

**Recommendation (delta):** allow `--manifest` only and derive gates path from manifest (`manifest.artifacts.paths.gates_file`) to reduce operator friction. The code already has “safe resolve” helpers: `.opencode/pai-tools/deep-research-option-c.ts:159-204`.

#### `run`

**Current:**

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" run \
  --manifest <abs> --gates <abs> \
  --reason "..." \
  --driver fixture|live \
  [--max-ticks <n>]
```

Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1162-1181`.

Key property: watchdog enforced per tick boundary: `.opencode/pai-tools/deep-research-option-c.ts:906-1035`.

**Recommendation (delta):** add `--until <stage|finalize>` to run until a stage boundary (useful for M2 evidence: stop at pivot).

#### `status`

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" status --manifest <abs>
```

Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1183-1192`.

#### `inspect` / `triage`

**Current behavior** is correct: it uses a safe `stage_advance` dry-run by copying artifacts to a temp directory so it cannot mutate the run root.

Evidence:
- Dry-run mechanic: `.opencode/pai-tools/deep-research-option-c.ts:531-555`.
- Triage extraction uses `decision.evaluated[]`: `.opencode/pai-tools/deep-research-option-c.ts:557-617`.

**Recommendation (delta):** enrich `inspect` to also surface:
- `citations/blocked-urls.json` when present (online mode)
- retry directives artifact path (`retry/retry-directives.json`) when present
- latest online fixtures path

#### `pause` / `resume`

These are already first-class and correct:
- they acquire a run lock
- they mutate manifest via manifest_write with optimistic locking
- they write checkpoints in logs.

Evidence: `.opencode/pai-tools/deep-research-option-c.ts:1037-1113`.

### `/deep-research` command doc alignment

The doc is already aligned to “CLI is the implementation surface”: `.opencode/commands/deep-research.md:20-46`.

The remaining alignment work is primarily to keep planning artifacts in sync (see drift notes in the charter pack, e.g. WS1 expecting a `Tools/` CLI: `.opencode/Plans/DeepResearchOptionC/2026-02-18/charter-pack/workstreams/WS1-operator-cli-and-unified-runloop.md:16-23`).

---

## Resumability/long-run requirements

### What already works (pause/resume + lock safety)

1) **Pausing stops watchdog and prevents orchestration**
- Orchestrators return `PAUSED` when manifest.status is paused (validated by tests): `.opencode/tests/entities/deep_research_orchestrator_tick_paused.test.ts:16-82`.
- Watchdog explicitly treats paused as non-timeout: `.opencode/tools/deep_research/watchdog_check.ts:84-91`.

2) **Resume resets stage timer semantics**
- Resume sets `status=running` and refreshes `stage.started_at`: `.opencode/pai-tools/deep-research-option-c.ts:1090-1095`.

3) **Run locks prevent concurrent ticks**
- Acquire/refresh/release semantics with ownership checks and stale-lock handling: `.opencode/tools/deep_research/run_lock.ts:187-293,295-369,401-451`.

### What’s missing for *safe* 1h+ runs

The current design is safe for long runs **only if the operator pauses/resumes proactively**.

#### 1) Stage timeouts are too small for real research work

Default limits are 2–10 minutes per stage: `.opencode/tools/deep_research/lifecycle_lib.ts:352-362`.

What breaks today in a 1h+ run if you do not pause:
- Watchdog will mark the run `failed` and write a checkpoint: `.opencode/tools/deep_research/watchdog_check.ts:89-116,118-155`.

What must change to support 1h+ runs:
- Either:
  - increase stage timeouts for “deep” mode (manifest.mode) and/or per-stage, or
  - change timeout semantics from “time since stage started” to “time since last progress heartbeat,” where the orchestrator updates a progress timestamp.

#### 2) Idempotent “progress checkpoints” per tick are missing

You have `logs/audit.jsonl` best-effort appends and stage history entries, but no canonical “tick ledger.”

Why it matters:
- For long runs, you need: which tick ran, what it attempted, where it stopped, and what artifact to inspect.

Concrete requirements:
- A deterministic `tick_id` (e.g., `sha256(manifest_revision + intended_transition + inputs_digest)`) written to a `logs/ticks.jsonl` ledger.
- Each orchestrator should write one ledger entry per tick boundary (start, stop, outcome).

#### 3) Online citations need resumable operator guidance as first-class artifacts

You already write `blocked-urls.json` and an online fixtures capture: `.opencode/tools/deep_research/citations_validate.ts:344-359`.

What’s missing:
- A policy decision: when any citations are blocked/invalid, does Gate C fail hard, or does it stop with “operator action required” while leaving the run resumable?
- Operator CLI should surface `blocked-urls.json` in `inspect`.

#### 4) Cancellation semantics are not productized

Manifest schema allows `cancelled` status: `.opencode/tools/deep_research/lifecycle_lib.ts:349-351`, but operator CLI does not provide a cancel command.

For 1h+ runs, `cancel` is essential for safely stopping automated loops.

---

## Skill recommendations (names + workflows)

### What exists today

There is already an Option C skill with workflows mapped to the operator CLI:
- `.opencode/skills/deep-research-option-c/SKILL.md:10-22`
- Workflows: RunPlan, RunLiveWave1ToPivot, RunFixtureToFinalize, TickUntilStop, PauseRun, ResumeRun.
  - Evidence list: `.opencode/skills/deep-research-option-c/SKILL.md:29-37`.

This is a strong starting point.

### What should exist for reliable real research orchestration

I recommend splitting the operator capability into **two skills**:

1) **`deep-research-option-c`** (existing) — “how to run the system” (CLI orchestration)
2) **`deep-research-production`** (new) — “how to produce research outputs” (agent prompting contracts + citations policy + quality loops)

The reason: Option C’s pipeline is now mechanically complete; the next failure modes are mostly “operator doesn’t know what to do when blocked” and “agents drift from contracts.” Those are best handled by explicit skills/workflows with validation contracts.

#### Skill 1: `deep-research-option-c` (refine existing)

Workflows (keep existing, add two):
- Existing:
  - `RunPlan` (Evidence: `.opencode/skills/deep-research-option-c/Workflows/RunPlan.md:25-41`)
  - `RunLiveWave1ToPivot` (Evidence: `.opencode/skills/deep-research-option-c/Workflows/RunLiveWave1ToPivot.md:10-37`)
  - `RunFixtureToFinalize` (Evidence: `.opencode/skills/deep-research-option-c/Workflows/RunFixtureToFinalize.md:12-36`)
  - `TickUntilStop` (Evidence: `.opencode/skills/deep-research-option-c/Workflows/TickUntilStop.md:12-39`)
  - `PauseRun` / `ResumeRun` (Evidence: `.opencode/skills/deep-research-option-c/Workflows/PauseRun.md:12-25`; `.opencode/skills/deep-research-option-c/Workflows/ResumeRun.md:12-25`)
- Add:
  - `InspectCitationsBlockers` — run `inspect`, then (if present) read and summarize `citations/blocked-urls.json`.
  - `CaptureFixtureBundle` — run `deep_research_fixture_bundle_capture` after finalize for deterministic replay.

Validation contracts (add to each workflow):
- Always verify:
  - run lock not held by another process (`detectRunLock` / lock file check)
  - manifest and gates schemas validate after each tick
  - tick either advanced stage or produced typed blocker.

#### Skill 2: `deep-research-production` (new)

Workflows:

1) `DraftPerspectivesFromQuery`
- Goal: turn a query into `perspectives.json` that matches caps and desired depth.
- Contract: ensures unique IDs, stable ordering, budgets, required sections.
- Evidence: spec default perspective payload is documented in command doc: `.opencode/commands/deep-research.md:61-83`.

2) `RunWave1WithTaskDriver`
- Goal: provide an autonomous `runAgent` driver that uses Task tool (not operator-input) and records agent_run_id.
- Contract: per perspective, enforce tool budgets and output contract; on failure, emit retry directives and re-run bounded times.

3) `OnlineCitationsLadderPolicy`
- Goal: choose and record an online ladder policy for citations validation, including endpoint config.
- Contract: always produce `online-fixtures.*.json` and `blocked-urls.json` in online mode; if blocked URLs exist, emit a typed operator directive artifact.

4) `SynthesisAndReviewQualityLoop`
- Goal: run generate-mode Phase05 OR (future) LLM-based synthesis/review with bounded iterations.
- Contract: Gate E evidence artifacts always exist (reports + review bundle), and `revision_control` action is recorded.

Validation contracts (cross-cutting):
- [ ] Wave outputs must pass `wave_output_validate` and be included in `wave-review.json`.
- [ ] Any retry must be recorded via `retry_record`.
- [ ] Citations in synthesis must be drawn from validated CID pool.
- [ ] No raw URLs in summaries/synthesis outputs when prohibited by the Phase05 tools.

---

## Risk register

Top 10 risks/footguns, with mitigations.

1) **Ambient env var drift changes run behavior on resume**
   - Evidence: flags resolution prefers env: `.opencode/tools/deep_research/flags_v1.ts:112-160`.
   - Mitigation: treat run-config/manifest-captured flags as authoritative post-init; surface “effective config” in `status`.

2) **Default stage watchdog timeouts will fail legitimate long work**
   - Evidence: timeouts are 5–10 minutes: `.opencode/tools/deep_research/lifecycle_lib.ts:352-362`.
   - Mitigation: adopt progress-heartbeat semantics or per-mode timeouts; require pause/resume for human-in-the-loop.

3) **“Live mode” is not truly autonomous without a Task-backed driver**
   - Evidence: driver boundary `.opencode/tools/deep_research/orchestrator_tick_live.ts:822-833` and operator-input driver `.opencode/pai-tools/deep-research-option-c.ts:712-713`.
   - Mitigation: implement a production driver that spawns agents and captures run IDs and prompts.

4) **Gate A/F are conceptual only; pipeline can complete without them**
   - Evidence: gates exist but no evaluator tool: `.opencode/tools/deep_research/run_init.ts:211-225`; tool exports show B/C/D/E only: `.opencode/tools/deep_research/index.ts:18-39`.
   - Mitigation: either remove these gates from “hard readiness” claims, or implement evaluators and enforce via stage_advance.

5) **Online citations require endpoint config and can block unpredictably**
   - Evidence: endpoints from env `.opencode/tools/deep_research/citations_validate.ts:114-116`; blocked URLs artifact `.opencode/tools/deep_research/citations_validate.ts:344-359`.
   - Mitigation: surface blocked URLs in `inspect`; define operator playbook for resolving blocks; capture fixtures for replay.

6) **Audit logging is best-effort and can silently drop events**
   - Evidence: manifest_write returns ok even if audit append fails: `.opencode/tools/deep_research/manifest_write.ts:74-79`; many tools have “best effort” audit append patterns.
   - Mitigation: for long-run readiness, treat audit append failures as warnings in run metrics; add a dedicated tick ledger.

7) **Stage-advance dry-run uses temp copies; correctness depends on faithful copying**
   - Evidence: `.opencode/pai-tools/deep-research-option-c.ts:531-555`.
   - Mitigation: also add a “decision-only” mode to stage_advance (pure function) to avoid relying on filesystem copies.

8) **Path containment checks can be overly strict on not-yet-existing parents**
   - Evidence: orchestrators resolve contained paths by walking up to an existing parent and realpath-checking containment: `.opencode/tools/deep_research/orchestrator_tick_live.ts:131-213` (resolveContainedPath) and similar in post-pivot.
   - Mitigation: keep this strictness (security win), but ensure operator CLI creates required dirs in init (already does via run_init).

9) **Generate-mode synthesis/review quality may be insufficient for “real research” claims**
   - Evidence: generate-mode is deterministic and minimal; e.g., synthesis builds from first lines of summaries: `.opencode/tools/deep_research/synthesis_write.ts:142-205`.
   - Mitigation: label generate-mode as “bounded scaffolding”; add LLM-based mode later with fixture capture and strict contracts.

10) **Planning artifacts (charter pack) can mislead implementation status**
   - Evidence: WS1 expects Tools/ CLI deliverable `.opencode/Plans/.../WS1-operator-cli-and-unified-runloop.md:16-23`.
   - Mitigation: periodically regenerate charter pack from current code reality; treat it as guidance, not truth.

---

## Readiness rubric

This is a pass/fail checklist for **“ready for real research runs”** (not just fixture demos). It merges the charter gate structure with what the code actually does today.

### Gate A — Tool wiring & schema invariants

- [ ] `run_init` succeeds without requiring the operator to set env vars manually (CLI provides this UX).
  - Evidence target: `bun ".opencode/pai-tools/deep-research-option-c.ts" init "Q"` prints contract + run-config.
  - Code anchor: enablement check in `run_init`: `.opencode/tools/deep_research/run_init.ts:52-57` and CLI bootstrap: `.opencode/pai-tools/deep-research-option-c.ts:144-149`.
- [ ] After every tick, `manifest.json` and `gates.json` validate as v1.
  - Code anchor: schema validation is used in multiple entrypoints (e.g., stage_advance validates both manifest + gates: `.opencode/tools/deep_research/stage_advance.ts:49-55`).
- [ ] Stage movement occurs via `stage_advance` only (no direct manifest edits).
  - Evidence anchor: stage transitions are persisted via manifest_write inside stage_advance: `.opencode/tools/deep_research/stage_advance.ts:538-553`.

### Gate B — Live Wave1 completeness (M2 prerequisite)

- [ ] Live execution runs **all** entries in `wave-1/wave1-plan.json`.
  - Evidence: unit test expects 3 driver calls and 3 outputs: `.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts:105-112`.
- [ ] Retry directives are produced, consumed deterministically, and recorded via `retry_record` when needed.
  - Evidence: retry directive artifact write + retry_record call: `.opencode/tools/deep_research/orchestrator_tick_live.ts:1013-1058`.
- [ ] Gate B ends as `pass`, and stage advances to pivot.
  - Evidence: same unit test asserts Gate B pass and stage pivot: `.opencode/tests/entities/deep_research_orchestrator_tick_live.test.ts:146-151`.

### Gate C — Online citations integrity (M3a prerequisite)

- [ ] In `sensitivity != no_web`, citations validation runs online and writes:
  - `citations/citations.jsonl`
  - `citations/online-fixtures.<ts>.json`
  - `citations/blocked-urls.json`
  - Evidence anchor: citations_validate online artifact writes: `.opencode/tools/deep_research/citations_validate.ts:329-366`.
- [ ] Gate C is computed, written, and citations stage advances to summaries.
  - Evidence anchor: gate C compute + gates_write + stage advance: `.opencode/tools/deep_research/orchestrator_tick_post_pivot.ts:1600-1698`.

### Gate D — Summaries boundedness (M3b prerequisite)

- [ ] Summary pack build works in `mode=generate` without fixtures.
  - Evidence: generate mode branch: `.opencode/tools/deep_research/summary_pack_build.ts:184-246`.
- [ ] Gate D is evaluated and written, and stage advances `summaries -> synthesis`.
  - Evidence: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:575-644`.

### Gate E — Synthesis + review loop + finalize (M3 completion)

- [ ] `synthesis_write` supports `mode=generate` and writes `synthesis/final-synthesis.md`.
  - Evidence: orchestrator synthesis stage uses generate default when fixture path absent: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:657-710`.
- [ ] `review_factory_run` supports `mode=generate` and produces `review/review-bundle.json`.
  - Evidence: review generate branch: `.opencode/tools/deep_research/review_factory_run.ts:118-180` and orchestration call: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:724-738`.
- [ ] Revision control enforces bounded iterations, and stage_advance resolves review->(synthesis|finalize) correctly.
  - Evidence: revision_control tool call and stage advance: `.opencode/tools/deep_research/orchestrator_tick_post_summaries.ts:809-858` and stage authority policy `.opencode/tools/deep_research/stage_advance.ts:257-274,423-489,493-495`.

### Ops gate — Restart/reload guidance + pause/resume + lock safety

- [ ] Two concurrent orchestrators cannot mutate the same run root (lock held).
  - Evidence: `.opencode/tools/deep_research/run_lock.ts:254-260,325-335`.
- [ ] Operator can pause and resume without manual file edits.
  - Evidence: CLI pause/resume: `.opencode/pai-tools/deep-research-option-c.ts:1037-1113`.
- [ ] Watchdog enforced at tick boundaries and does not cause false timeouts when paused.
  - Evidence: watchdog in run loop `.opencode/pai-tools/deep-research-option-c.ts:912-923` and paused guard in watchdog `.opencode/tools/deep_research/watchdog_check.ts:84-91`.

---

## Next 10 concrete steps

1) **Implement a production `runAgent` driver** that spawns actual agents (Task tool) and returns `{ markdown, agent_run_id, started_at, finished_at }` to `orchestrator_tick_live`.

2) **Decide and codify long-run timeout semantics** (mode-based timeouts or progress-heartbeat timeouts), to make “1h+ wave1/citations” feasible without manual pause.
   - Evidence anchor for current limits: `.opencode/tools/deep_research/lifecycle_lib.ts:352-362`.

3) **Add `cancel` to the operator CLI** to set `manifest.status=cancelled` with checkpointing, and make orchestrators treat it as terminal.
   - Evidence that status supports cancelled: `.opencode/tools/deep_research/lifecycle_lib.ts:349-351`.

4) **Surface citations operator guidance in `inspect`** by reading `citations/blocked-urls.json` when present and printing actionable steps.
   - Evidence anchor for blocked urls artifact: `.opencode/tools/deep_research/citations_validate.ts:353-358`.

5) **Add a tick ledger (`logs/ticks.jsonl`)** with one structured entry per tick (start/end/outcome/digests) for postmortems and 1h+ run visibility.

6) **Integrate telemetry/metrics tools into CLI `run`** (orchestrator-run wrappers) so every tick emits `telemetry_append` and periodic `run_metrics_write` snapshots.
   - Evidence these tools exist: `.opencode/tools/deep_research/index.ts:40-42`.

7) **Resolve configuration precedence**: after init, prefer run-config/manifest-captured flags over env for all downstream tools.
   - Evidence anchor: run-config emitted: `.opencode/pai-tools/deep-research-option-c.ts:420-464`.

8) **Either implement Gate A and Gate F evaluators, or remove them from “hard gate” claims**.
   - Evidence: these gates are created but not evaluated: `.opencode/tools/deep_research/run_init.ts:218-223`.

9) **Update the charter pack to reflect current implementation reality** (CLI location, completed workstreams) so planning artifacts stop suggesting already-done work.
   - Evidence of drift: WS1 expects Tools/ CLI: `.opencode/Plans/.../WS1-operator-cli-and-unified-runloop.md:16-23`.

10) **Add one end-to-end “operator canary” runbook** that runs:
   - `init (normal)` → `run --driver live --until summaries` → `run --driver live --until finalize` (once Task-backed driver exists)
   - and captures a fixture bundle at the end.

🗣️ Marvin: Reviewed Option C end-to-end, flagged remaining M2/M3 gaps, and specified CLI, skills, and readiness gates.
