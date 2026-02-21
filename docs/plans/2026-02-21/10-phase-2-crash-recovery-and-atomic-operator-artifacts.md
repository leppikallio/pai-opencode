# Deep Research Option C — Phase 2B (Crash recovery + atomic operator artifacts) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make long-running runs resilient to crashes by adding an in-progress tick marker, using the tick ledger as a recovery signal, and making operator artifacts atomic.

**Architecture:** Preserve deterministic artifacts. Add small, explicit recovery artifacts under `logs/` and ensure partial writes can’t corrupt the operator contract.

**Tech Stack:** Tool layer orchestrators + tick ledger; file IO helpers in `wave_tools_shared`/`lifecycle_lib`.

---

## Phase outputs (deliverables)

- Each orchestrator tick writes `logs/tick-in-progress.json` at start and removes it on success.
- If a tick starts and finds an old in-progress marker, it emits a typed halt/artifact explaining a likely crash and recommended next commands.
- Operator-facing artifacts (prompts, outputs, run-config) use atomic writes.

## Task 2B.1: Add atomic UTF-8 write helper

**Files:**
- Modify: `.opencode/tools/deep_research_cli/wave_tools_shared.ts` (or `lifecycle_lib.ts`)

**Step 1: Add helper**

```ts
export async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, filePath);
}
```

**Step 2: Commit**

```bash
git add .opencode/tools/deep_research_cli/wave_tools_shared.ts
git commit -m "feat(dr): add atomicWriteUtf8 helper"
```

## Task 2B.2: Add tick in-progress marker (orchestrator-level)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`

**Step 1: Define marker schema**

Write `logs/tick-in-progress.json` with:

```json
{ "schema_version": "tick_in_progress.v1", "ts": "...", "stage": "wave1", "reason": "..." }
```

**Step 2: Write marker at tick start, remove in finally**

- Use `atomicWriteJson` or the new `atomicWriteUtf8` helper.
- On success, remove the marker file.

**Step 3: Commit**

```bash
git add \
  .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts
git commit -m "feat(dr): add tick in-progress marker for crash recovery"
```

## Task 2B.3: Detect stale marker and emit typed halt artifact

**Files:**
- Modify: the same orchestrators as Task 2B.2

**Step 1: If marker exists at tick start**

- Read marker, compare `ts` to now.
- If older than a threshold (e.g., > 5 minutes), treat as likely crash.
- Emit a structured error `{ ok:false, code:"PREVIOUS_TICK_INCOMPLETE", details:{ marker_path, marker } }`.

**Step 2: Add regression test**

Create: `.opencode/tests/regression/deep_research_tick_in_progress_marker_regression.test.ts`

Test strategy:
- Create a run root + manifest in a stage.
- Write a stale marker file.
- Run one orchestrator tick and assert it returns the new failure code.

**Step 3: Commit**

```bash
git add .opencode/tests/regression/deep_research_tick_in_progress_marker_regression.test.ts
git commit -m "test(dr): regression for stale tick-in-progress marker"
```

## Task 2B.4: Make key operator artifacts atomic

**Files (targets):**
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/init.ts` (run-config write)
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/tick.ts` (prompt-out writes)

**Step 1: Replace `fs.writeFile` with atomic helper**

- Use `atomicWriteJson` for JSON artifacts and `atomicWriteUtf8` for markdown prompts.

**Step 2: Add regression test if practical**

- At minimum, ensure code paths compile and existing CLI ergonomics test passes.

## Phase 2B Gate

**Gate execution (required):**

- Architect agent validates crash recovery is explicit and doesn’t add hidden state.
- QATester agent runs regression tests.

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_tick_in_progress_marker_regression.test.ts
```

Expected: PASS.
