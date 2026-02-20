# Deep Research Option C — CLI Refactor Plan (LLM-manageable)

Date: 2026-02-20

This document is an **appendix** to the authoritative program plan:

- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC/2026-02-19/00-plan-skill-merge-cli-refactor-known-issues.md`

It captures a **step-by-step** refactor sequence designed to keep files small enough that an LLM can edit safely.

## Current reality (verified)

- Monolith entrypoint: `.opencode/pai-tools/deep-research-option-c.ts` is ~4.2k lines.
  - Evidence command: `wc -l .opencode/pai-tools/deep-research-option-c.ts`
- Command wrappers exist (thin `cmd-ts` parsing): `.opencode/pai-tools/deep-research-option-c/cmd/*.ts`
  - These call into `runX(...)` implementations still located in the monolith.
- Two high-signal regressions pass (as of 2026-02-20):
  - `bun test ./.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts`
  - `bun test ./.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts`

## Goals (non-negotiable)

1) **LLM-manageable files**: target **≤ 500 lines per module**.
2) Preserve the **same CLI interface** (command names, flags, `--json` contract).
3) Keep behavior unchanged except where known-issues already required fixes.
4) Minimize merge conflict risk with ongoing work: extract incrementally.
5) No empty/stub files to satisfy checks: every new file must contain real migrated logic immediately.

## Target module structure (proposed)

> Target: `deep-research-option-c.ts` ends up ~150–250 LOC (wiring only).

```
.opencode/pai-tools/
  deep-research-option-c.ts                          (~200) Entrypoint wiring only

  deep-research-option-c/
    cmd/                                             (exists) cmd-ts arg parsing only
      *.ts

    cli/
      json-mode.ts                                   (~120) --json policy, emitJson(), stdout/stderr rules
      app.ts                                         (~200) subcommands wiring + DI, exports createApp()
      errors.ts                                      (~150) top-level error mapping and runSafely policy

    runtime/
      tool-context.ts                                (~120) makeToolContext(); ToolWithExecute type
      tool-envelope.ts                               (~250) ToolEnvelope parsing + callTool() wrapper

    lib/
      paths.ts                                       (~250) absolute paths, run-id validation, safe joins
      io-json.ts                                     (~200) readJsonObject(), readJsonIfExists()
      io-jsonl.ts                                    (~120) JSONL readers (ENOENT-safe)
      fs-utils.ts                                    (~220) fileExists(), writeCheckpoint(), small fs wrappers
      time.ts                                        (~80) nowIso(), timestamp tokens
      digest.ts                                      (~120) stable digest helpers

    observability/
      tick-observability.ts                          (~450) tick ledger, telemetry, run metrics
      tick-outcome.ts                                (~150) compute/format tick outcomes

    triage/
      stage-advance-dry-run.ts                        (~120) preconditions and dry-run helpers
      blockers.ts                                    (~220) triage blockers + summary formatting
      halt-artifacts.ts                              (~450) halt artifact writers + next commands helpers

    drivers/
      fixture-driver.ts                              (~150) fixture driver glue
      operator-input-driver.ts                        (~220) live driver glue
      task-driver.ts                                 (~450) prompt-out driver glue (wave1/wave2/summaries/synthesis)

    perspectives/
      schema.ts                                      (~450) normalizePerspectivesDraftOutputV1() + helpers
      prompt.ts                                      (~120) prompt markdown builders
      policy.ts                                      (~200) default policy artifacts
      state.ts                                       (~250) state resolution helpers

    handlers/                                        (one file per subcommand; each ≤ 500 LOC)
      status.ts
      inspect.ts
      triage.ts
      stage-advance.ts
      pause.ts
      resume.ts
      cancel.ts
      capture-fixtures.ts
      rerun.ts
      init.ts
      perspectives-draft.ts
      agent-result.ts
      tick.ts
      run.ts
```

## Migration sequence (incremental, wrapper-first)

**Rule of thumb:** Move stable cross-cutting helpers first (reduces churn), then subsystems, then command handlers.

### Step 0 — Lock invariants (before moving much code)

Validation contract (run before/after every extraction wave):
- `bun .opencode/pai-tools/deep-research-option-c.ts --help` exits 0.
- `bun .opencode/pai-tools/deep-research-option-c.ts status --help` exits 0.
- Any `--json` invocation prints **exactly one JSON object** on stdout (no logs).

### Steps 1–6 — Extract global helpers and subsystems

1) `cli/json-mode.ts` (JSON mode and `emitJson`)
2) `runtime/tool-envelope.ts` + `runtime/tool-context.ts` (`callTool`, envelopes)
3) `lib/paths.ts` (absolute path rules + safe joins)
4) `lib/io-json.ts`, `lib/io-jsonl.ts`, `lib/time.ts`, `lib/digest.ts`
5) `observability/*` (tick ledger + telemetry + metrics)
6) `triage/*` (halt artifacts + blockers)

Validation contract after each step:
- run the two high-signal regressions:
  - `bun test ./.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts`
  - `bun test ./.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts`

### Steps 7–N — Extract handlers (one at a time)

Start with smallest commands to stabilize the pattern:
- `handlers/status.ts`
- `handlers/inspect.ts`
- `handlers/triage.ts`

Then medium:
- `handlers/stage-advance.ts`
- `handlers/pause.ts`, `handlers/resume.ts`, `handlers/cancel.ts`
- `handlers/capture-fixtures.ts`, `handlers/rerun.ts`

Then highest-risk:
- `handlers/init.ts`
- `handlers/perspectives-draft.ts`
- `handlers/agent-result.ts`
- `handlers/tick.ts` (contains stage routing and driver policy glue)
- `handlers/run.ts`

Validation contract for each extracted handler:
- `--help` works for that subcommand.
- `--json` prints one JSON object.
- Relevant entity tests pass.

### Final consolidation

When all handlers are extracted:
- Reduce `deep-research-option-c.ts` to wiring only.
- Remove the old `runX` implementations from the monolith (after their modules are stable).

## Anti-regrowth guardrails

Add mechanical guards early in the refactor execution (not in this planning phase):

- Hard limit: `deep-research-option-c.ts` ≤ 250 lines.
- Soft limit: every module ≤ 500 lines.
- Add a small smoke test that asserts `--json` stdout is a single JSON object.

## Context capture / continuity

If a session dies mid-refactor, the handoff should include:
- current file tree state (which modules exist)
- which `runX` functions were migrated
- which entity tests were used as the “green bar” after each wave
- current line counts of remaining large files
