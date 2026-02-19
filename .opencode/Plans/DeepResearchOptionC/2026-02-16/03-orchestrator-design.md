# Deep Research Option C — Orchestrator Design (the “final mile”)

Date: 2026-02-16

Status: **Design contract** (implementable guidance). Not a marketing doc.

This document turns `00-operator-pipeline-plan-v4.md` into implementable guidance for the **orchestrator layer**: the stage-driven loop that drives real runs end-to-end, while preserving deterministic, fixture-replayable step isolation.

---

## 1) Purpose + non-negotiables

### Purpose
The orchestrator is responsible for:

1) Creating/choosing perspectives.
2) Planning and executing Wave 1 (and optionally Wave 2).
3) Ingesting agent outputs into the run root deterministically.
4) Running validators, producing bounded retries, and persisting retry directives.
5) Writing gates updates and advancing the lifecycle until `finalize` (or a typed stop condition).

### Non-negotiables

**N1 — Artifact-first (state lives on disk)**
- The orchestrator must treat the run root (`manifest.json`, `gates.json`, `logs/audit.jsonl`, stage directories) as the only durable truth.
- Orchestrator ticks MUST be restartable from disk state; no hidden in-memory state is allowed to affect correctness.

**N2 — `deep_research_stage_advance` is the authority**
- The orchestrator does not “set stage” directly.
- The orchestrator **satisfies preconditions** (writes artifacts / writes gates), then requests advancement by calling `deep_research_stage_advance`.
- If `deep_research_stage_advance` rejects, the orchestrator must not partially “pretend” it advanced.

**N3 — Step isolation (fixture-friendly)**
- Every action is isolated behind tools + artifacts:
  - Inputs are *explicit* (paths, arguments, env flags).
  - Outputs are *explicit* (artifact paths).
  - Side-effects must be captured as artifacts or audit events.
- The orchestrator depends on an injected **driver boundary** so the same tick logic can run with:
  - a **Fixture driver** (offline, deterministic)
  - a **Live driver** (spawns real agents / performs retrieval)

**N4 — Idempotent and safe re-run**
- Re-running a tick (or re-running the whole orchestrator loop) must be safe.
- The orchestrator must check for existing artifacts before recomputing.
- Artifact overwrites are controlled and must be auditable (see §4).

**N5 — Bounded retries + explicit stop conditions**
- Retries must be bounded (per-stage and per-perspective caps).
- When retries are exhausted, the orchestrator must stop deterministically and leave a typed “why” artifact.

---

## 2) OrchestratorDrivers

### 2.1 Interface (as in plan v4)

This interface is the explicit injection boundary that makes step isolation testable.

```ts
interface OrchestratorDrivers {
  // Agent execution
  runAgent(input: {
    perspective_id: string;
    agent_type: string;
    prompt_md: string;
  }): Promise<{
    markdown: string;
    // Required for reproducibility and debugging
    agent_run_id?: string;
    started_at?: string;
    finished_at?: string;
    error?: { code: string; message: string };
  }>

  // Determinism controls
  nowIso(): string;
  sleepMs(ms: number): Promise<void>;

  // Optional retrieval boundary (fixture can stub; live can call approved tools)
  retrieve?(input: { url: string; reason: string }): Promise<{ ok: boolean; status: number; body?: string }>;

  // Optional standardized audit/event sink (fixture can record; live writes to audit.jsonl)
  logEvent?(kind: string, payload: Record<string, unknown>): void;
}
```

### 2.2 Live driver vs Fixture driver

**Fixture driver (offline, deterministic)**
- `runAgent(...)` returns deterministic markdown from fixture directories (e.g., `.opencode/tests/fixtures/runs/**`).
- `nowIso()` returns a fixed clock value per scenario.
- `sleepMs(...)` is a no-op.
- `retrieve(...)` is optional and must be deterministic if provided.
- `logEvent(...)` may record to an in-memory array for assertions; it may also write `logs/audit.jsonl` in the fixture run root.

**Live driver (real runs)**
- `runAgent(...)` spawns real agents via the host runtime agent tool (Task tool) and returns the produced markdown.
- `nowIso()` returns real time.
- `sleepMs(...)` performs a real delay (used only for rate limiting / backoff).
- `retrieve(...)` may be used for approved URL fetches in live mode (but must still be captured as evidence; see §7).
- `logEvent(...)` must append to `logs/audit.jsonl` (directly or via `deep_research_telemetry_append`), never console-only.

**Critical rule:** the orchestrator logic cannot depend on live-only behavior. The only difference is what the driver does behind the boundary.

---

## 3) Tick loop algorithm (stage-driven driver)

### 3.1 Definitions

**Tick**
- A tick is one orchestration decision step. It reads current state from disk, performs **at most one lifecycle advancement request**, and returns a structured result.

**Run loop**
- The run loop repeatedly calls `tick(...)` until stop conditions are reached (completed / blocked / failed / operator-required).

### 3.2 Tick input contract

Minimum inputs:
- `manifest_path` (absolute)
- `gates_path` (absolute)
- `drivers: OrchestratorDrivers`
- `reason` (human-readable, stable)

### 3.3 Tick output contract

Tick returns one of:
- `advanced`: stage advanced (`from -> to`) via `deep_research_stage_advance`.
- `no_op`: nothing to do (already completed stage artifacts; waiting on operator input; or already terminal).
- `blocked`: cannot proceed due to gate / missing artifact / retry cap.
- `failed`: typed error (tool failure, schema validation failure, unexpected state).

### 3.4 Dispatch model

Tick is stage-driven:
1) Read + validate `manifest.json` and `gates.json`.
2) Determine `stage.current`.
3) Route to the stage handler for that stage.

Stage handlers are small and deterministic:
- They only read artifacts and (maybe) write missing artifacts.
- They may call tools to produce artifacts.
- They may call drivers (only in live/fixture wave execution boundaries).
- They MUST call `deep_research_stage_advance` to move to the next stage.

### 3.5 Pseudocode

```ts
async function tick({ manifest_path, gates_path, drivers, reason }: TickArgs): Promise<TickResult> {
  // 1) Load state
  const manifest = readAndValidateManifest(manifest_path);
  const gates = readAndValidateGates(gates_path);

  const stage = manifest.stage.current;
  const runRoot = manifest.artifacts.root;
  const tickId = stableTickId(runRoot, stage, gates.revision /* or manifest revision */);

  drivers.logEvent?.("tick_start", { tick_id: tickId, stage, reason });

  // 2) Terminal fast-exit
  if (stage === "finalize" || manifest.status === "completed" || manifest.status === "failed") {
    drivers.logEvent?.("tick_end", { tick_id: tickId, stage, outcome: "no_op" });
    return { kind: "no_op", stage };
  }

  // 3) Stage handler writes preconditions (artifacts + gates)
  const handler = getStageHandler(stage);
  const handlerResult = await handler({ manifest, gates, runRoot, drivers, tickId });
  if (handlerResult.kind !== "ready_to_advance") {
    drivers.logEvent?.("tick_end", { tick_id: tickId, stage, outcome: handlerResult.kind });
    return handlerResult;
  }

  // 4) Request stage advance (authority)
  // Note: orchestrator does NOT mutate manifest directly.
  const sa = await deep_research_stage_advance({
    manifest_path,
    gates_path,
    requested_next: handlerResult.requested_next, // optional
    reason: handlerResult.advance_reason,
  });

  drivers.logEvent?.("stage_advance_result", { tick_id: tickId, from: stage, result: sa });

  // 5) Return outcome
  if (!sa.ok) return { kind: "blocked", stage, error: sa.error };
  return { kind: "advanced", from: sa.from, to: sa.to, decision_inputs_digest: sa.decision?.inputs_digest ?? null };
}
```

### 3.6 Stage handler responsibilities (what “ready_to_advance” means)

For each stage, the handler must ensure:
- **All required artifacts exist** for the intended transition.
- **Any gate updates needed** for the transition have been computed and persisted (via `deep_research_gates_write`).
- If the stage requires agent work, the handler must ensure outputs are ingested and validated before attempting advance.

---

## 4) Idempotency rules (safe re-run behavior)

### 4.1 General rule
Every stage handler MUST treat existing artifacts as authoritative.

If an artifact already exists *and* passes minimal schema/shape validation, the orchestrator must:
- **skip recomputation**
- emit an audit event `artifact_skipped`

If an artifact exists but is invalid/corrupt:
- emit `artifact_invalid`
- treat as a hard error unless an explicit recovery policy exists for that artifact type.

### 4.2 Artifact overwrite policy

**Policy goal:** safe resume + reproducibility without silently destroying evidence.

1) **Never overwrite primary evidence artifacts by default**
   - Example: `wave-1/<perspective_id>.md`.
   - If a retry produces a new output, write it as a new file:
     - `wave-1/<perspective_id>.retry-<n>.md`
     - plus a symlink/alias file is allowed only if the filesystem supports it; otherwise store a small pointer JSON.

2) **Overwriting “derived” artifacts is allowed only with a revision contract**
   - `gates.json` updates MUST go through `deep_research_gates_write` and use `expected_revision` when possible.
   - Gate writes MUST be paired with `inputs_digest` to make “why did gates change?” auditable.

3) **Manifest writes are restricted**
   - Stage changes: only via `deep_research_stage_advance`.
   - Non-stage fields (status, notes): only via `deep_research_manifest_write`.
   - Orchestrator code must never directly edit `manifest.json` with ad-hoc writes.

4) **Atomicity requirement**
   - Writes of `manifest.json` and `gates.json` are treated as atomic at the tool boundary (write-temp + rename inside the tool implementation).
   - Orchestrator code must assume tools already enforce atomicity, but must still handle partial failures by stopping and logging.

### 4.3 Idempotency per stage (minimum expectations)

| Stage | Idempotency rule (minimum) |
|---|---|
| `init` | If `manifest.json` and `gates.json` exist and validate, do not re-init. |
| `wave1` | If `wave-1/wave1-plan.json` exists, do not re-plan. If wave outputs exist, do not respawn agents unless retry directives require it. |
| `pivot` | If `pivot.json` exists and validates, do not re-decide pivot. |
| `wave2` | If wave2 was selected and outputs exist, do not respawn unless retry directives require it. |
| `citations` | If `citations/citations.jsonl` exists and Gate C has been computed for current digest, do not recompute. |
| `summaries` | If `summaries/summary-pack.json` exists and Gate D computed for current digest, do not rebuild. |
| `synthesis` | If `synthesis/final-synthesis.md` exists, do not rewrite unless review requested changes. |
| `review` | If review bundle exists for current iteration, do not rerun review factory. |
| `finalize` | No-op forever. |

---

## 5) Retry model (bounded retries + directives)

### 5.1 Goals
- Retrying must be **explicit** (directive artifacts), **bounded** (caps), and **auditable** (events + manifest retry record).
- Retries must not cause silent evidence loss (see overwrite rules).

### 5.2 Retry directives artifact (required)

When validators fail (typically in Wave stages), the orchestrator must write a **retry directives artifact** (JSON) under the run root.

Recommended location:
- `retry/retry-directives.json`

Minimum schema (v1):

```json
{
  "schema_version": "retry-directives.v1",
  "run_id": "<run_id>",
  "stage": "wave1",
  "created_at": "<now-iso>",
  "items": [
    {
      "kind": "rerun_agent",
      "perspective_id": "p1",
      "attempt": 2,
      "reason": "validator: missing Sources section",
      "backoff_ms": 1500
    }
  ]
}
```

### 5.3 Bounded retries

At minimum, enforce caps:
- **Per perspective**: `max_attempts_per_perspective` (e.g., 2)
- **Per stage**: `max_stage_retry_directives` (e.g., 4)

Retry budget sources (in priority order):
1) Explicit CLI flags (operator overrides)
2) Manifest config fields (run-local policy)
3) Environment defaults (e.g., set by `deep_research_run_init`)

### 5.4 Retry recording

Whenever a retry directive is created or consumed, record it via:
- `deep_research_retry_record` (append retry note into manifest history)

This ensures fixture replay can assert retries happened for the right reason.

### 5.5 Stop conditions (must be typed)

The orchestrator must stop the loop when any of these occur:
- **Gate blocked**: a required gate is not `PASS` for the requested transition.
- **Missing artifact**: required artifact is absent and cannot be produced in current mode.
- **Retry cap exceeded**: bounded retry budget exhausted.
- **Invalid state**: schema validation failure (manifest/gates/artifacts).
- **Operator required**: a decision cannot be made automatically (e.g., ambiguous pivot) and policy says “ask”.

On stop, the orchestrator must:
- write an audit event `run_halted`
- write a small typed artifact (e.g., `review/terminal-failure.json` for review cap hit, or `logs/blocked.json` for gate blocks)
- set `manifest.status` via `deep_research_manifest_write` when terminal failure is reached.

---

## 6) Audit/event model

### 6.1 Storage

Audit log is append-only JSONL:
- `logs/audit.jsonl`

The orchestrator MUST emit events for all meaningful decisions and side effects. Tools can also emit their own telemetry; the orchestrator event log is the operator-grade trace.

### 6.2 Required event kinds

Minimum required kinds (v1):

1) `tick_start`
2) `tick_end`
3) `stage_handler_start`
4) `stage_handler_end`
5) `artifact_written`
6) `artifact_skipped`
7) `artifact_invalid`
8) `tool_call_start`
9) `tool_call_end`
10) `gate_write_requested`
11) `gate_write_applied`
12) `stage_advance_requested`
13) `stage_advance_result`
14) `retry_directives_written`
15) `retry_directives_consumed`
16) `run_halted`

### 6.3 Minimal payload fields

Every event MUST include these fields:

```json
{
  "ts": "<iso>",
  "run_id": "<run_id>",
  "tick_id": "<tick-id>",
  "stage": "<stage.current>",
  "kind": "<event-kind>",
  "reason": "<why>"
}
```

For specific kinds, also include:
- Tool events: `{ tool_id, args_digest, ok, error_code?, duration_ms? }`
- Artifact events: `{ path, schema_version?, bytes?, sha256? }`
- Gate writes: `{ inputs_digest, expected_revision?, actual_revision? }`
- Stage advance: `{ from, to?, requested_next?, decision_inputs_digest? }`
- Retry directives: `{ directives_path, items_count, caps: { per_perspective, per_stage } }`

---

## 7) Live evidence capture contract

### 7.1 Why this exists
Live mode must leave enough evidence in the run root to:
- debug failures without rerunning the whole job
- reproduce and/or fixture-capture a scenario
- audit exactly which prompts and outputs produced which artifacts

### 7.2 Prompt hash

For every `drivers.runAgent(...)` call, compute:
- `prompt_hash = sha256(normalize(prompt_md))`

Normalization rules (v1):
- Normalize newlines to `\n`
- Trim trailing whitespace on each line
- Ensure final newline

Persist `prompt_hash` alongside the stored prompt and output.

### 7.3 Agent evidence storage paths (required)

For each agent run (Wave 1 / Wave 2), write:

- Prompt:
  - `evidence/agents/<stage>/<perspective_id>/prompt.md`
- Metadata:
  - `evidence/agents/<stage>/<perspective_id>/meta.json`
  - fields: `{ agent_type, perspective_id, prompt_hash, agent_run_id, started_at, finished_at, error? }`
- Output markdown (primary artifact):
  - `wave-1/<perspective_id>.md` (for wave1)
  - `wave-2/<perspective_id>.md` (for wave2)

If output is re-run:
- Write `wave-1/<perspective_id>.retry-<n>.md` (do not overwrite primary by default).

### 7.4 Tool evidence storage paths (recommended)

For orchestrator-called tools that materially change state (planning, validation, gate derivation), store a minimal markdown evidence bundle:

- `evidence/tools/<tool_id>/<tick_id>.md`

Include:
- tool id
- args (redacted if needed)
- inputs digest
- tool result (or error)

---

## 8) M2 and M3 walkthroughs

This section is a concrete “what the orchestrator does” walkthrough, using the **actual runtime tool IDs**.

### 8.1 M2 walkthrough: wave1 → pivot (live)

Goal: One real operator run reaches `pivot` with wave outputs + review + Gate B recorded.

**Prereqs**
- Option C enabled via integration settings (default: `deepResearch.flags.PAI_DR_OPTION_C_ENABLED=true`; env unsupported)
- Run root exists with `manifest.json` + `gates.json`.

**Wave1 stage handler (high-level sequence)**

1) Ensure Wave 1 plan exists
   - If missing, call `deep_research_wave1_plan`.

2) Spawn agents (via driver boundary)
   - For each perspective in `perspectives.json`, call `drivers.runAgent({ perspective_id, agent_type, prompt_md })`.
   - Persist evidence per §7.

3) Ingest outputs into canonical run-root artifacts
   - Call `deep_research_wave_output_ingest` (planned tool) to write:
     - `wave-1/<perspective_id>.md` (and/or canonical filenames)
     - any normalized metadata needed for validators

4) Validate outputs
   - Call `deep_research_wave_output_validate`.
   - If it returns retry directives, write `retry/retry-directives.json`, record via `deep_research_retry_record`, and **do not advance**.

5) Review outputs
   - Call `deep_research_wave_review` to produce `wave-review.json`.

6) Derive Gate B decision
   - Call `deep_research_gate_b_derive` to compute `{ update.B, inputs_digest }`.

7) Persist gates
   - Call `deep_research_gates_write` with `{ gates_path, inputs_digest, expected_revision? }`.

8) Advance stage
   - Call `deep_research_stage_advance` (authority) to advance `wave1 -> pivot`.

### 8.2 Gate C/D/E tools (brief, operator-relevant)

After pivot, later stages must use these tools to enforce gates:

- Gate C (citations metrics): `deep_research_gate_c_compute`
- Gate D (summary pack bounds): `deep_research_gate_d_evaluate`
- Gate E (final synthesis quality + reports):
  - `deep_research_gate_e_evaluate`
  - `deep_research_gate_e_reports`

In all cases:
1) compute/evaluate gate -> 2) `deep_research_gates_write` -> 3) `deep_research_stage_advance`

### 8.3 M3 walkthrough: pivot → finalize (live end-to-end)

Goal: One real operator run reaches `finalize` with Gate C/D/E enforced and bounded review iterations.

**Pivot stage handler**
1) Ensure `pivot.json` exists
   - Call `deep_research_pivot_decide` if missing.
2) Call `deep_research_stage_advance` to move to either `wave2` or `citations` depending on decision.

**Wave2 stage handler (if selected)**
1) Spawn agents via `drivers.runAgent` for wave2 perspectives.
2) Ingest via `deep_research_wave_output_ingest` into `wave-2/*.md`.
3) Optionally validate + review (same tool IDs as wave1), then `deep_research_stage_advance` to `citations`.

**Citations stage handler**
1) Ensure citations artifacts exist:
   - `deep_research_citations_extract_urls`
   - `deep_research_citations_normalize`
   - `deep_research_citations_validate`
2) Compute Gate C:
   - `deep_research_gate_c_compute`
3) Persist + advance:
   - `deep_research_gates_write`
   - `deep_research_stage_advance` (`citations -> summaries`)

**Summaries stage handler**
1) Build summary pack:
   - `deep_research_summary_pack_build`
2) Evaluate Gate D:
   - `deep_research_gate_d_evaluate`
3) Persist + advance:
   - `deep_research_gates_write`
   - `deep_research_stage_advance` (`summaries -> synthesis`)

**Synthesis stage handler**
1) Write synthesis:
   - `deep_research_synthesis_write`
2) Advance:
   - `deep_research_stage_advance` (`synthesis -> review`)

**Review stage handler (bounded loop)**
1) Run review factory:
   - `deep_research_review_factory_run`
2) Enforce bounded revision control:
   - `deep_research_revision_control`
3) If `CHANGES_REQUIRED` and iterations < cap:
   - `deep_research_stage_advance` (`review -> synthesis`)
4) Else compute Gate E + reports:
   - `deep_research_gate_e_evaluate`
   - `deep_research_gate_e_reports`
   - `deep_research_gates_write`
   - `deep_research_stage_advance` (`review -> finalize`)
5) If Gate E fails and iterations >= cap:
   - write terminal failure artifact (`review/terminal-failure.json`)
   - set `manifest.status=failed` via `deep_research_manifest_write`

---

## 9) How to run

### 9.1 Bootstrap

From repo root:

```bash
cd "/Users/zuul/Projects/pai-opencode-graphviz"
bun install
bun test ./.opencode/tests
```

### 9.2 Operator-critical settings flags

From `07-bootstrap-and-operator-commands.md` (note: env flags are not supported; these are settings keys):

- `PAI_DR_OPTION_C_ENABLED` (master enable/disable)
- `PAI_DR_NO_WEB` (force no-web; CLI default for canary should use `--sensitivity no_web`)
- `PAI_DR_LIVE_TESTS` (allow live smoke tests; proposed)

### 9.3 Operator steps (slash command surface)

Target command shape:

```text
/deep-research <mode> "<query>" [--run_id <id>] [--sensitivity normal|restricted|no_web]
```

Modes:
- `plan`: init + perspectives + wave plan only (no agents)
- `fixture`: offline fixture run (deterministic)
- `live`: real agent spawning + ingest + gates + advance

Required final print contract (all modes):
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

### 9.4 Where to debug

In the run root:
- `manifest.json` (current stage + history)
- `gates.json` (gate statuses)
- `logs/audit.jsonl` (append-only event log)
- `evidence/**` (live evidence capture)
