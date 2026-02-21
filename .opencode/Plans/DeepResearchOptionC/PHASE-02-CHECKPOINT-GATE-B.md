# Phase 02 Checkpoint — Gate B Signoff

Date: 2026-02-14

## Scope
Phase 02 — Orchestrator Engine (Option C) in the integration layer:

- Deterministic stage transitions (`init -> wave1` proven)
- Bounded retries per escalation spec
- Watchdog timeouts -> explicit failure + checkpoint artifact
- Dry-run seeding from fixtures (no web)

## Phase 02 backlog status (P02-01..P02-06)
Source backlog: `deep-research-option-c-phase-02-executable-backlog.md`

| ID | Backlog item | Status | Notes |
|---|---|---|---|
| P02-01 | Define stage machine spec | ✅ Done | Spec exists with transition table + determinism rules (`spec-stage-machine-v1.md`). |
| P02-02 | Implement stage scheduler tool (`stage_advance`) | ✅ Done | Deterministic transition engine implemented; `init -> wave1` validated via fixture-based entity test. |
| P02-03 | Implement retry controller (`retry_record`) | ✅ Done | Enforces per-gate retry caps and records audit history in manifest. |
| P02-04 | Implement watchdog (`watchdog_check`) | ✅ Done | Deterministic timeout evaluation (supports `now_iso`) + writes `logs/timeout-checkpoint.md`. |
| P02-05 | Implement dry-run mode | ✅ Done (seed step) | `dry_run_seed` seeds run root from fixtures and marks run `no_web` + `dry_run` constraints. |
| P02-06 | Phase 02 checkpoint + Gate B signoff | ✅ Done | This document. |

## Gate B criteria (Phase 02)
Gate B for Phase 02 is interpreted per:
- `deep-research-option-c-phase-02-executable-backlog.md` (Gate B: reliability + deterministic transitions)
- `deep-research-option-c-phase-02-orchestrator-engine.md` (Gate B: stage engine reliability + deterministic state transitions)

**Criteria:**
1. **Deterministic transitions** — same manifest+gates inputs yield the same next-stage decision.
2. **Stage engine reliability** — invalid/blocked states fail explicitly with machine-readable error codes (no silent behavior).
3. **Bounded retry semantics** — retry caps match `spec-gate-escalation-v1.md` and retries are auditable.
4. **No silent hangs** — timeouts produce explicit terminal failure, recorded failures, and a checkpoint artifact.
5. **Dry-run capability** — deterministic local test path exists that forbids web access and uses fixtures.

## Evidence

### Command outputs (as reported)

Typecheck:
```bash
$ bunx tsc ... tools/deep_research_cli.ts
TYPECHECK_OK
```

Tests:
```bash
$ bun test tests
11 pass, 0 fail
```

### Concrete evidence pointers (paths + what they prove)

1. **Deterministic stage transitions (implementation):**
   - File: `.opencode/tools/deep_research_cli.ts`
   - Proof: `export const stage_advance = tool({ ... })` defines deterministic `allowedNextFor(from)` plus validation of `requested_next` and explicit error codes.
   - Pointers: lines ~1151–1310 (transition selection + validation) and lines ~1415–1437 (persisting stage history via `manifest_write`).

2. **Deterministic transition test (init -> wave1) + history write:**
   - File: `.opencode/tests/entities/deep_research_stage_advance.test.ts`
   - Proof: Copies fixture `perspectives.json`, calls `stage_advance`, asserts `{ from: "init", to: "wave1" }` and manifest stage history appended.
   - Pointers: lines 9–56.

3. **Deterministic block decision digest (missing artifact):**
   - File: `.opencode/tests/entities/deep_research_stage_advance.test.ts`
   - Proof: Re-runs missing-artifact transition twice and asserts the decision digest is identical both times.
   - Pointers: lines 60–101.

4. **Bounded retry caps tied to escalation spec (implementation):**
   - File: `.opencode/tools/deep_research_cli.ts`
   - Proof: `GATE_RETRY_CAPS_V1` defines per-gate max retries (comment references `spec-gate-escalation-v1.md`), and `retry_record` enforces `current >= max -> RETRY_EXHAUSTED`.
   - Pointers: lines ~323–331 (`GATE_RETRY_CAPS_V1`) and lines ~985–1062 (`retry_record`).

5. **Retry controller entity test (cap enforcement + audit log):**
   - File: `.opencode/tests/entities/deep_research_retry_record.test.ts`
   - Proof: For Gate C (max=1), first retry passes, second returns `RETRY_EXHAUSTED`, manifest metrics updated, and `logs/audit.jsonl` contains a `manifest_write` event.
   - Pointers: lines 9–69.

6. **Watchdog timeout -> terminal failure + checkpoint artifact (implementation):**
   - File: `.opencode/tools/deep_research_cli.ts`
   - Proof: `watchdog_check` computes `elapsed_s` vs `timeout_s`, writes `logs/timeout-checkpoint.md`, sets `manifest.status="failed"`, appends `manifest.failures[]` with `{ kind: "timeout", ... }`.
   - Pointers: lines 1445–1561.

7. **Watchdog entity test (deterministic timeout via `now_iso`):**
   - File: `.opencode/tests/entities/deep_research_watchdog_check.test.ts`
   - Proof: Seeds `manifest.stage.started_at`, calls `watchdog_check` with fixed `now_iso`, asserts `timed_out=true`, checkpoint content, and manifest failure fields.
   - Pointers: lines 8–60.

8. **Dry-run seeding from fixtures + `no_web` marking (implementation + test):**
   - File: `.opencode/tools/deep_research_cli.ts` and `.opencode/tests/entities/deep_research_dry_run_seed.test.ts`
   - Proof: `dry_run_seed` calls `run_init` with `sensitivity:"no_web"`, copies fixture artifacts, patches manifest with `constraints.dry_run.*`; test asserts copied fixture output + manifest constraints.
   - Pointers: tool lines ~754–915, test lines 9–39.

## Known gaps (Phase 03+)

These are intentionally deferred; they do not block Phase 02 signoff but are required for Phase 03/“full Gate B” semantics:

1. **Stage transition coverage**: only `init -> wave1` is currently proven via fixture-based test; additional transitions (wave1->pivot, pivot branching, downstream gates/artifact checks) need fixture coverage.
2. **Wave output contracts + validators**: Gate B in later phases extends into wave output schema compliance and pivot integrity (see `deep-research-option-c-phase-03-agent-contracts.md`).
3. **Watchdog checkpoint enrichment**: `watchdog_check` writes `last_known_subtask: unavailable (placeholder)`; Phase 03/06 should wire real subtask pointers and richer operator guidance.
4. **End-to-end dry-run graph**: `dry_run_seed` enables deterministic setup; Phase 03 should execute a full wave graph in dry-run mode (fan-out/fan-in) with contract validation.

## Next action (start Phase 03)

Start Phase 03 by implementing **WS-03A + WS-03B** scaffolding:

1. Add a perspective allocator + router (deterministic caps, stored decision artifact).
2. Implement Wave 1 fan-out execution with strict output contract validation and bounded retry routing.

Reference: `deep-research-option-c-phase-03-agent-contracts.md`.

## Signoff
Gate B for Phase 02 is **PASSED** based on deterministic transition tooling, bounded retries, watchdog timeout behavior, dry-run seeding, and entity tests.
