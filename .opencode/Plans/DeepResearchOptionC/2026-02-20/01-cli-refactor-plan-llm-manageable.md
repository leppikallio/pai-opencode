# Deep Research Option C CLI Refactor Implementation Plan (LLM-manageable)

> **REQUIRED WORKFLOW (recommended):** use `using-git-worktrees` + `subagent-driven-development` to implement task-by-task.
> 
> Alternate workflow (separate session): use `executing-plans`.

**Goal:** Reduce the CLI monolith to **≤ 250 LOC wiring-only**, by extracting real logic into meaningful modules (~≤ 500 LOC each), while preserving CLI behavior and ensuring runtime install works.

**Architecture:** Keep the public entrypoint file path stable (`pai-tools/deep-research-option-c.ts`). Extract subsystems first (json/errors/tool-runtime/paths/io/observability/triage/perspectives/run-handle), then extract each command handler (move+delete; no shims). Validate continuously with Tier 0/1 tests and require Architect + QA PASS gates at the end.

**Tech Stack:** TypeScript (ESNext), Bun, `cmd-ts`, Node `fs/path`, PAI runtime installer `Tools/Install.ts`.

---

## Orchestrator instruction (PATH DISCIPLINE — read first)

Subagents have been “bouncing” due to ambiguous relative paths. **Do not use ambiguous relative paths.**

### Canonical working directory for *all* commands

- Worktree root (this refactor happens here):
  - `/tmp/wt-dr-cli-refactor`

When running commands, either:

1) `cd /tmp/wt-dr-cli-refactor` first, **or**
2) run commands with an explicit working directory (preferred).

### Canonical absolute paths (copy/paste)

- Plan file:
  - `/tmp/wt-dr-cli-refactor/.opencode/Plans/DeepResearchOptionC/2026-02-20/01-cli-refactor-plan-llm-manageable.md`
- Monolith entrypoint:
  - `/tmp/wt-dr-cli-refactor/.opencode/pai-tools/deep-research-option-c.ts`
- Extracted module root:
  - `/tmp/wt-dr-cli-refactor/.opencode/pai-tools/deep-research-option-c/`
- Entity tests root:
  - `/tmp/wt-dr-cli-refactor/.opencode/tests/entities/`
- Tier 1 test files:
  - `/tmp/wt-dr-cli-refactor/.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts`
  - `/tmp/wt-dr-cli-refactor/.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts`
  - `/tmp/wt-dr-cli-refactor/.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts`
- Installer (for Tier 3 smoke):
  - `/tmp/wt-dr-cli-refactor/Tools/Install.ts`

### Anti-shim check scope (important)

- The anti-shim rule applies to modules under:
  - `/tmp/wt-dr-cli-refactor/.opencode/pai-tools/deep-research-option-c/**`
- It is OK and expected that the entrypoint:
  - `/tmp/wt-dr-cli-refactor/.opencode/pai-tools/deep-research-option-c.ts`
  imports those modules.
- It is **not** OK for any module under `deep-research-option-c/**` to import the monolith entrypoint.

---

## 0) Context (what you are refactoring)

### What the CLI is

- Source entrypoint (repo):
  - `.opencode/pai-tools/deep-research-option-c.ts`
- Installed entrypoint (runtime):
  - `~/.config/opencode/pai-tools/deep-research-option-c.ts`
- Install path mapping (from `Tools/Install.ts`):
  - `.opencode/pai-tools/**` → `<target>/pai-tools/**`

### Current baseline (validated)

- Monolith size (measured 2026-02-20):
  ```bash
  wc -l .opencode/pai-tools/deep-research-option-c.ts
  # => 4716 .opencode/pai-tools/deep-research-option-c.ts
  ```

### Non-negotiables (read before touching code)

1) **Remove mass from the monolith** (NOT just new wrappers): every completed task must reduce monolith LOC.
2) Keep CLI surface compatible:
   - command names, flags, help output, and `--json` contract.
3) Keep runtime-safe composition:
   - all new modules under `pai-tools/deep-research-option-c/**`
   - **relative imports only** (no repo-root assumptions)
   - do not hardcode `.opencode/...` in runtime outputs
4) No behavior changes except already-approved known-issue fixes.

### Task sizing + review cadence (important: fixes the “tiny extractions + huge review cost” failure mode)

**Problem we are avoiding:** moving 5–30 lines at a time while paying Architect+QA review overhead after every micro-step.

**New rule (from T04 onward):** each refactor task must remove a *cohesive subsystem chunk*.

- **Minimum deletion target:** each completed task should remove **≥ 200 LOC** from the monolith.
- **Preferred deletion target:** **250–500 LOC** removed per task.
- **Minimum module size target:** each new “primary” module should be roughly **150–500 LOC**.
  - Small utility modules (<100 LOC) are allowed **only** when truly atomic (e.g., `cli/json-mode.ts`).

**Review cadence rule:**

- We still follow `subagent-driven-development`, but we define “task” as a **meaningful extraction wave**.
- Do **not** create tasks whose only outcome is a tiny helper extraction.
- If a change would remove <200 LOC, **expand the task scope** by including adjacent, logically-related code until the deletion target is met.

---

## 1) How this plan is executed (controller + subagents)

### You (controller/orchestrator) responsibilities

- Execute tasks **sequentially** (this refactor touches the same files; do not parallelize implementers).
- For each task:
  1) Dispatch implementer subagent with ONLY the task text + any needed context.
  2) Require implementer to run the task’s validation commands and paste outputs.
  3) Dispatch spec reviewer then code quality reviewer (per `subagent-driven-development` skill).
  4) Update the tracker table (below) + TodoWrite.

### About “subagent-driven-development”

- It is explicitly defined here:
  - `/Users/zuul/.config/opencode/skills/subagent-driven-development/SKILL.md`
- `executing-plans` is a different workflow (separate session checkpoints):
  - `/Users/zuul/.config/opencode/skills/executing-plans/SKILL.md`

---

## 2) Validation (run these exactly)

### Tier 0 (always run after each task)

```bash
bun .opencode/pai-tools/deep-research-option-c.ts --help
bun .opencode/pai-tools/deep-research-option-c.ts status --help
```

Expected:
- exit code 0

### Tier 1 (run after each task)

```bash
bun test ./.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts
bun test ./.opencode/tests/entities/deep_research_operator_cli_wave2_task_driver.test.ts
bun test ./.opencode/tests/entities/deep_research_orchestrator_pivot_wave2_required.test.ts
```

Expected:
- all PASS

### Tier 2 (QA gate)

```bash
bun test ./.opencode/tests/entities
```

Expected:
- all PASS

### Tier 3 (runtime install smoke; QA gate)

```bash
rm -rf "/tmp/pai-opencode-runtime-smoke" || true
bun Tools/Install.ts --target "/tmp/pai-opencode-runtime-smoke" --non-interactive --skills "deep-research-option-c" --no-verify
bun "/tmp/pai-opencode-runtime-smoke/pai-tools/deep-research-option-c.ts" --help
bun "/tmp/pai-opencode-runtime-smoke/pai-tools/deep-research-option-c.ts" status --help
```

Expected:
- install succeeds
- help commands exit 0 (no module-resolution failures)

---

## 3) Mechanical anti-shim checks (run after each task)

### A) Monolith LOC must decrease

```bash
wc -l .opencode/pai-tools/deep-research-option-c.ts
```

Expected:
- smaller than before this task started

### B) No module imports the monolith

```bash
rg -n "\.{2}/deep-research-option-c" .opencode/pai-tools/deep-research-option-c -S
```

Expected:
- 0 matches

### C) The moved symbol’s *definition* is gone from the monolith (per task)

Template (example for `runStatus`):

```bash
rg -n "^async function runStatus\\b|^function runStatus\\b" .opencode/pai-tools/deep-research-option-c.ts
```

Expected:
- 0 matches

Note: use `^async function` / `^function` anchors so calls/usages do not false-positive.

---

## 4) Tracker (controller updates this)

Statuses: `TODO | IN_PROGRESS | DONE | ARCH_PASS | QA_PASS | BLOCKED(<reason>)`

| ID | Task | Status | Monolith LOC (before → after) | Tier 1 PASS? | Notes |
|---|---|---|---:|---|---|
| T00 | Create worktree + baseline snapshot | DONE | 4716 → 4716 | yes | worktree + bun install + Tier 1 green |
| T01 | Extract JSON mode + emitJson | DONE | 4716 → 4711 | yes | commit a36a0fb |
| T02 | Extract CLI errors helpers | DONE | 4711 → 4687 | yes | commit d51b067 |
| T03 | Extract tool runtime (envelope/context/callTool) | DONE | 4687 → 4642 | yes | commit a9a37f5 |
| T04 | Extract run-handle resolution | DONE | 4552 → 4300 | yes | wave commits af90363 + 2d548c6 (run-handle.ts=264 LOC) |
| T05 | Extract paths + manifest safety helpers | DONE | 4642 → 4552 | yes | commit 8b20932 (paths.ts is 101 LOC) |
| T06 | Extract fs/json/jsonl/time/digest helpers | DONE |  | yes | io-json/fs-utils/time/digest live under lib/; no helpers remain in monolith |
| T07 | Extract observability (tick ledger/telemetry/metrics) | DONE | 4300 → 3991 | yes | commit e133ba56 (tick-observability.ts=291 LOC) |
| T08 | Extract triage + halt artifacts | DONE | 3991 → 3495 | yes | commit 392dd3a (halt-artifacts.ts=335 LOC) |
| T09 | Extract perspectives subsystem helpers | DONE | 3495 → 3078 | yes | commit 0e317e8 (schema.ts=261 LOC) |
| T10 | Extract handler: status | DONE | 3078 → 2828 | yes | wave commit adbde82 (handlers/status.ts) |
| T11 | Extract handler: inspect | DONE | 3078 → 2828 | yes | wave commit adbde82 (handlers/inspect.ts) |
| T12 | Extract handler: triage | DONE | 3078 → 2828 | yes | wave commit adbde82 (handlers/triage.ts) |
| T13 | Extract handler: pause | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/pause.ts) |
| T14 | Extract handler: resume | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/resume.ts) |
| T15 | Extract handler: cancel | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/cancel.ts) |
| T16 | Extract handler: stage-advance | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/stage-advance.ts) |
| T17 | Extract handler: capture-fixtures | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/capture-fixtures.ts) |
| T18 | Extract handler: rerun | DONE | 2828 → 2426 | yes | wave commit 1d5e88e (handlers/rerun.ts) |
| T19 | Extract handler: init | DONE | 2426 → 1217 | yes | wave commit e5b8136 (handlers/init.ts=337 LOC) |
| T20 | Extract handler: perspectives-draft | DONE | 2426 → 1217 | yes | wave commit e5b8136 (handlers/perspectives-draft.ts=724 LOC) |
| T21 | Extract handler: agent-result | DONE | 2426 → 1217 | yes | wave commit e5b8136 (handlers/agent-result.ts=344 LOC) |
| T22 | Extract tick internals (runOneOrchestratorTick) | DONE | 1217 → 174 | yes | wave commit 729e91d (handlers/tick-internals.ts=90 LOC) |
| T23 | Extract handler: tick | DONE | 1217 → 174 | yes | wave commit 729e91d (handlers/tick.ts=512 LOC) |
| T24 | Extract handler: run | DONE | 1217 → 174 | yes | wave commit 729e91d (handlers/run.ts=367 LOC) |
| T25 | Final wiring-only entrypoint (≤250 LOC) | DONE |  |  | monolith now 174 LOC (wiring-only) |
| G-ARCH | Architect gate (PASS required) | TODO |  |  | module map + invariants reviewed |
| G-QA | QA gate (PASS required) | TODO |  |  | Tier 2 + Tier 3 PASS evidence |

---

## 4.1) Commit policy (recommended)

After each code-changing task (T01–T25) passes Tier 1 and the tracker row is updated:

```bash
git status
git add -A
git commit -m "refactor(cli): TXX <short description>"
```

Guidelines:
- One commit per task keeps rollbacks easy.
- Do not bundle multiple task IDs into one commit.
- If a task is purely documentation/tracker updates, skip the commit.

## 5) Target module structure (what to create)

All new files live under:

- `.opencode/pai-tools/deep-research-option-c/**`

Proposed structure (OK to adjust if Architect approves, but keep intent):

```
.opencode/pai-tools/
  deep-research-option-c.ts                  (final: ≤250 LOC wiring only)

  deep-research-option-c/
    cli/
      json-mode.ts
      errors.ts
    runtime/
      tool-context.ts
      tool-envelope.ts
    lib/
      run-handle.ts
      paths.ts
      fs-utils.ts
      io-json.ts
      io-jsonl.ts
      time.ts
      digest.ts
    observability/
      tick-observability.ts
      tick-outcome.ts
    triage/
      blockers.ts
      halt-artifacts.ts
    perspectives/
      schema.ts
      prompt.ts
      policy.ts
      state.ts
    handlers/
      *.ts
```

---

## 6) Tasks (bite-sized, subagent executable)

Each task below is designed to be executed by a smaller LLM.

### Task T00: Create worktree + baseline snapshot

**Files:** none

**Step 1: Create isolated worktree**

Run (example):
```bash
git status
git worktree add /tmp/wt-dr-cli-refactor -b dr-cli-refactor
```

Expected:
- new worktree exists at `/tmp/wt-dr-cli-refactor`

**Step 2: Record baseline**

Run:
```bash
cd /tmp/wt-dr-cli-refactor
wc -l .opencode/pai-tools/deep-research-option-c.ts
```

Expected:
- prints 4716 (or update tracker if it differs)

**Step 2.1: Ensure dependencies are installed in this worktree**

Reason: new worktrees do **not** share `.opencode/node_modules`, so entity tests can fail with missing modules.

Run:
```bash
test -d .opencode/node_modules || (cd .opencode && bun install)
```

Expected:
- `.opencode/node_modules/` exists

**Step 3: Run Tier 1 once (baseline green)**

Run Tier 1 commands (see section 2).

Expected:
- all PASS

**Step 4: Update tracker row T00**

Fill in:
- Monolith LOC before→after
- Tier 1 PASS? = yes

---

### Task T01: Extract JSON mode + emitJson (real move+delete)

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/cli/json-mode.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`
- Test: `.opencode/tests/entities/deep_research_operator_cli_ergonomics.test.ts`

**Step 1: Create module and export helpers**

In `cli/json-mode.ts`, export at minimum:
- `isJsonModeRequested(argv: string[]): boolean`
- `configureStdoutForJsonMode(enabled: boolean): void`
- `emitJson(payload: unknown): void`

**Step 2: Move+delete these symbols from monolith**

Move the real logic (cut/paste) for:
- `CLI_ARGV` (or equivalent argv capture)
- `JSON_MODE_REQUESTED`
- the `if (JSON_MODE_REQUESTED) console.log = ...` override
- `emitJson(...)`

Then delete the originals from `deep-research-option-c.ts`.

**Step 3: Wire entrypoint to call configure early**

Requirement:
- stdout/stderr policy for `--json` remains identical.

**Step 4: Validation**

- Run Tier 0 + Tier 1
- Run anti-shim checks (section 3)
- Update tracker row T01 with LOC delta

---

### Task T02: Extract CLI errors helpers (move+delete)

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/cli/errors.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Create module exports**

Export (names must match current usage or update call sites):
- `throwWithCode(...)`
- `throwWithCodeAndDetails(...)`
- `toolErrorDetails(...)`
- `resultErrorDetails(...)`

**Step 2: Move+delete implementations**

Cut/paste the real implementations into `cli/errors.ts` and delete them from the monolith.

**Step 3: Validation**

- Run Tier 0 + Tier 1
- Run anti-shim checks
- Update tracker row T02

---

### Task T03: Extract tool runtime (envelope/context/callTool)

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/runtime/tool-context.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/runtime/tool-envelope.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete the tool envelope type and helpers**

Move these symbols into the runtime modules:
- `ToolEnvelope`
- `ToolWithExecute`
- `makeToolContext()`
- `parseToolEnvelope(...)`
- `toolErrorMessage(...)`
- `callTool(...)`

Delete them from the monolith.

**Step 2: Validation**

- Run Tier 0 + Tier 1
- Run anti-shim checks
- Update tracker row T03

---

### Task T04: Extract run-handle resolution (resolveRunHandle + lock)

**Sizing rule for this task:** this is the first “big deletion” task. Do not move only the two functions.

- Target deletion: **250–500 LOC** removed from the monolith.
- If you can’t hit 250 LOC by moving only `resolveRunHandle/withRunLock`, expand scope by moving the full **run-handle + contract** subsystem listed below.
- It is acceptable (recommended) to complete **most of T06** (IO helpers) in the same extraction wave if needed to hit deletion targets.

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/lib/run-handle.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete implementations (run-handle + contract subsystem)**

Move these symbols into `lib/run-handle.ts`:
- `resolveRunHandle(...)`
- `withRunLock(...)`

Also move (keep it cohesive; don’t leave stragglers):
- `resolveRunRoot(...)`
- `resolveLogsDirFromManifest(...)`
- `resolveGatesPathFromManifest(...)`
- `resolvePerspectivesPathFromManifest(...)`
- `summarizeManifest(...)`
- `printContract(...)`
- `contractJson(...)`
- `emitContractCommandJson(...)`
- `gateStatusesSummaryRecord(...)`
- `readGateStatusesSummary(...)`
- `parseGateStatuses(...)`

And these types (where they live today doesn’t matter; they must end up in the module, not the monolith):
- `GateStatusSummary`
- `ManifestSummary`
- `CliContractJson`

Delete from the monolith and update call sites.

**Step 2: Validation**

- Run Tier 0 + Tier 1
- Run anti-shim checks
- Update tracker row T04

---

### Task T05: Extract paths + manifest safety helpers

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/lib/paths.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete**

Move:
- `requireAbsolutePath(...)`
- `isManifestRelativePathSafe(...)`
- `safeResolveManifestPath(...)`
- `isSafeSegment(...)`
- `normalizeOptional(...)`
- `validateRunId(...)`
- `assertWithinRoot(...)`

Delete from monolith and update imports.

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T05

---

### Task T06: Extract fs/json/jsonl/time/digest helpers

**Sizing rule for this task:** avoid creating 5 tiny files that each contain 10–40 lines.

- Preferred: combine into **1–3** cohesive modules (`lib/io.ts`, `lib/time.ts`, `lib/digest.ts`) that are **150–500 LOC** each.
- If T04 already moved `readJsonObject`/`resolveRunRoot`-adjacent IO helpers, remove them from this task and focus on what remains.

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/lib/fs-utils.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/lib/io-json.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/lib/io-jsonl.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/lib/time.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/lib/digest.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete**

Move as appropriate:
- `fileExists(...)`
- `writeCheckpoint(...)`
- `readJsonObject(...)`
- `readJsonlRecords(...)`
- `nowIso()`
- `stableDigest(...)`
- `promptDigestFromPromptMarkdown(...)`

Delete originals from monolith.

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T06

---

### Task T07: Extract observability subsystem

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/observability/tick-observability.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/observability/tick-outcome.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete**

Move:
- `appendTickLedgerBestEffort(...)`
- `appendTelemetryBestEffort(...)`
- `writeRunMetricsBestEffort(...)`
- `computeTickOutcome(...)`
- `beginTickObservability(...)`
- `finalizeTickObservability(...)`

Delete originals from monolith.

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T07

---

### Task T08: Extract triage + halt artifacts subsystem

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/triage/blockers.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/triage/halt-artifacts.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete**

Move:
- `triageFromStageAdvanceResult(...)`
- `blockersSummaryJson(...)`
- `printBlockersSummary(...)`
- `writeHaltArtifact(...)`
- `writeHaltArtifactForFailure(...)`
- `handleTickFailureArtifacts(...)`

Delete originals from monolith.

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T08

---

### Task T09: Extract perspectives subsystem helpers

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/perspectives/schema.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/perspectives/prompt.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/perspectives/policy.ts`
- Create: `.opencode/pai-tools/deep-research-option-c/perspectives/state.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Move+delete**

Move:
- `normalizePerspectivesDraftOutputV1(...)`
- `buildPerspectivesDraftPromptMarkdown(...)`
- `buildDefaultPerspectivesPolicyArtifact(...)`
- `writeDefaultPerspectivesPolicy(...)`
- any small helpers used exclusively by the above

Delete originals from monolith.

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T09

---

### Task T10–T24: Extract command handlers (one command at a time)

For EACH handler task below, repeat the exact pattern.

#### Common handler pattern (copy/paste)

**Files:**
- Create: `.opencode/pai-tools/deep-research-option-c/handlers/<cmd>.ts`
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Steps:**

1) Create handler file exporting `run<Cmd>(args: ...)` (signature matches existing `cmd/*.ts` wrappers).
2) Cut/paste the real `run<Cmd>` implementation from monolith into handler.
3) In monolith: import the handler and pass it into `create<Cmd>Cmd({ ..., run<Cmd> })`.
4) Delete the original `run<Cmd>` from monolith.
5) Confirm the definition is gone from monolith (Mechanical check 3C).
6) Run Tier 0 + Tier 1.
7) Run anti-shim checks.
8) Update tracker row with LOC delta.

#### Handler tasks

- T10: `handlers/status.ts` (move+delete `runStatus`)
- T11: `handlers/inspect.ts` (move+delete `runInspect`)
- T12: `handlers/triage.ts` (move+delete `runTriage`)
- T13: `handlers/pause.ts` (move+delete `runPause`)
- T14: `handlers/resume.ts` (move+delete `runResume`)
- T15: `handlers/cancel.ts` (move+delete `runCancel`)
- T16: `handlers/stage-advance.ts` (move+delete `runStageAdvance`)
- T17: `handlers/capture-fixtures.ts` (move+delete `runCaptureFixtures`)
- T18: `handlers/rerun.ts` (move+delete `runRerunWave1`)
- T19: `handlers/init.ts` (move+delete `runInit`)
- T20: `handlers/perspectives-draft.ts` (move+delete `runPerspectivesDraft`)
- T21: `handlers/agent-result.ts` (move+delete `runAgentResult`)
- T22: `handlers/tick-internals.ts` (move+delete `runOneOrchestratorTick`)
- T23: `handlers/tick.ts` (move+delete `runTick`)
- T24: `handlers/run.ts` (move+delete `runRun`)

---

### Task T25: Final wiring-only entrypoint (≤250 LOC)

**Files:**
- Modify: `.opencode/pai-tools/deep-research-option-c.ts`

**Step 1: Delete remaining non-wiring helpers**

Goal:
- monolith contains only:
  - imports
  - CLI boot/wiring
  - cmd-ts command registration

**Step 2: Validation**

- Tier 0 + Tier 1
- anti-shim checks
- update tracker row T25

---

## 7) Completion gates (PASS required)

### Gate G-ARCH (Architect PASS)

Architect must confirm:
- Monolith is wiring-only and ≤250 LOC
- No module imports the monolith
- Module boundaries make sense and each file is ~≤500 LOC (or exceptions justified)
- Runtime install constraints are respected

### Gate G-QA (QA PASS)

QA must provide evidence:
- Tier 2 PASS (all entity tests)
- Tier 3 PASS (install-smoke + installed help commands)

---

## Execution Handoff

Two execution options:

1) **Subagent-Driven (this session)** — Recommended
   - Load: `using-git-worktrees`, then `subagent-driven-development`
   - Execute tasks sequentially, update tracker after each

2) **Parallel Session**
   - Load: `executing-plans`
   - Execute tasks in batches with checkpoints

Choose option (1) unless you explicitly want a separate session.
