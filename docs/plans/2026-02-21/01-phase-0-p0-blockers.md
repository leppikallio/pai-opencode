# Deep Research Option C — Phase 0 (P0 blockers) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Remove P0 footguns and contract inconsistencies that cause false confidence or brittle long runs.

**Architecture:** Small, test-driven patches that (a) enforce stated gates, (b) eliminate schema drift, (c) improve operator/LLM JSON contracts, (d) fix broken repo tooling wrappers.

**Tech Stack:** Bun + TypeScript, deep_research_cli tool layer, deep-research operator CLI.

---

## Phase outputs (deliverables)

- Gate F is no longer a “stub that can be ignored”: it is **enforced** *and* has a deterministic evaluator so finalize is not deadlocked.
- `STAGE_TIMEOUT_SECONDS_V1` is consistent across schema sources.
- JSON tick output includes `halt.next_commands[]` inline (LLM-friendly).
- Repo `Tools/` wrappers are no longer broken (`deep_research` → `deep_research_cli`).

## Task 0.1: Create Phase 0 worktree

**Files:**
- (none)

**Step 1: Create a worktree**

Run:

```bash
git worktree add /tmp/pai-dr-phase0 -b dr-phase0-p0-blockers
```

Expected: worktree created at `/tmp/pai-dr-phase0`.

**Step 2: Verify clean state**

Run (inside worktree):

```bash
git status --porcelain
```

Expected: empty output.

## Task 0.2: Add regression test for timeout constant consistency (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_timeout_consistency_regression.test.ts`
- Reads:
  - `.opencode/tools/deep_research_cli/lifecycle_lib.ts`
  - `.opencode/tools/deep_research_cli/schema_v1.ts`

**Step 1: Write the failing test**

Create:

```ts
import { describe, expect, test } from "bun:test";

import { STAGE_TIMEOUT_SECONDS_V1 as TIMEOUTS_A } from "../../tools/deep_research_cli/lifecycle_lib";
import { STAGE_TIMEOUT_SECONDS_V1 as TIMEOUTS_B } from "../../tools/deep_research_cli/schema_v1";

describe("deep_research timeout constants (regression)", () => {
  test("STAGE_TIMEOUT_SECONDS_V1 matches between lifecycle_lib and schema_v1", () => {
    expect(TIMEOUTS_A).toEqual(TIMEOUTS_B);
  });
});
```

**Step 2: Run to confirm failure**

Run:

```bash
bun test .opencode/tests/regression/deep_research_timeout_consistency_regression.test.ts
```

Expected: FAIL (today `perspectives` differs: `86400` vs `120`).

## Task 0.3: Fix timeout constant mismatch (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/schema_v1.ts` (update `STAGE_TIMEOUT_SECONDS_V1.perspectives`)

**Step 1: Minimal fix (match lifecycle_lib)**

Update:

```ts
export const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
  // ...
  perspectives: 86400,
  // ...
};
```

**Step 2: Re-run regression test**

Run:

```bash
bun test .opencode/tests/regression/deep_research_timeout_consistency_regression.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/schema_v1.ts .opencode/tests/regression/deep_research_timeout_consistency_regression.test.ts
git commit -m "fix(dr): align schema stage timeouts"
```

## Task 0.4: Add regression test that review→finalize requires Gate F pass (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_gate_f_enforcement_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/stage_advance.ts`

**Step 1: Write failing regression test**

Create:

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";

import { run_init, stage_advance } from "../../tools/deep_research_cli.ts";
import { makeToolContext, parseToolJson, withEnv, withTempDir } from "../helpers/dr-harness";

describe("deep_research Gate F enforcement (regression)", () => {
  test("stage_advance review->finalize is blocked unless Gate F is pass", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withTempDir(async (base) => {
        const runId = `dr_gate_f_${Date.now()}`;
        const initRaw = (await (run_init as any).execute(
          {
            query: "regression:gate-f",
            mode: "standard",
            sensitivity: "no_web",
            run_id: runId,
            root_override: base,
          },
          makeToolContext(),
        )) as string;
        const init = parseToolJson(initRaw);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const manifestPath = String((init as any).manifest_path);
        const gatesPath = String((init as any).gates_path);

        // Force stage to review.
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as any;
        manifest.status = "running";
        manifest.stage = { ...(manifest.stage ?? {}), current: "review" };
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

        // Set E=pass, F=fail.
        const gates = JSON.parse(await fs.readFile(gatesPath, "utf8")) as any;
        gates.gates.E.status = "pass";
        gates.gates.F.status = "fail";
        await fs.writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, "utf8");

        const raw = (await (stage_advance as any).execute(
          {
            manifest_path: manifestPath,
            gates_path: gatesPath,
            requested_next: "finalize",
            reason: "test: enforce gate f",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(raw) as any;

        // Expected after fix: ok=false and error mentions gate F.
        // Expected today: this test FAILS because Gate F is not enforced.
        expect(out.ok).toBe(false);
      });
    });
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/regression/deep_research_gate_f_enforcement_regression.test.ts
```

Expected: FAIL (current behavior likely allows finalize with only Gate E pass).

## Task 0.5: Enforce Gate F for review→finalize (make regression PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/stage_advance.ts` (currently checks only Gate E at `from===review && to===finalize`)

**Step 1: Implement enforcement**

Change the finalize transition check to require both E and F:

```ts
if (from === "review" && to === "finalize") {
  block ??= blockIfFailed(evalGatePass("E"), "GATE_BLOCKED", "Gate E not pass", { gate: "E" });
  block ??= blockIfFailed(evalGatePass("F"), "GATE_BLOCKED", "Gate F not pass", { gate: "F" });
}
```

**Step 2: Re-run regression test**

```bash
bun test .opencode/tests/regression/deep_research_gate_f_enforcement_regression.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/stage_advance.ts .opencode/tests/regression/deep_research_gate_f_enforcement_regression.test.ts
git commit -m "fix(dr): enforce Gate F before finalize"
```

## Task 0.6: Add deterministic Gate F evaluator + wire it before finalize

**Why this exists:** After Task 0.5, `review -> finalize` will be blocked unless Gate F is **pass**. Today, nothing ever sets Gate F, so we must add a deterministic evaluator and call it during the review/finalize path.

**Files:**
- Create: `.opencode/tools/deep_research_cli/gate_f_evaluate.ts`
- Modify: `.opencode/tools/deep_research_cli/index.ts` (export tool)
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts` (call evaluator + persist gate)
- (Optional but recommended) Modify: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts` (assert Gate F pass)

**Step 1: Write a failing regression test**

Create: `.opencode/tests/regression/deep_research_gate_f_evaluate_wires_finalize_regression.test.ts`

Test intent:
- Re-use the existing M3 finalize smoke structure (self-seeded run + ticks).
- Assert the run reaches `finalize` **without** manually patching Gate F.
- This should FAIL after Task 0.5 until Gate F is evaluated+written.

**Step 2: Implement `gate_f_evaluate` tool (minimal, deterministic policy)**

Create a tool that:
- Reads `manifest.json`.
- Optionally reads `run-config.json` if present.
- Computes a deterministic `update` for Gate F and an `inputs_digest` (use `sha256DigestForJson`).

Suggested minimal Gate F rule (deterministic and non-OpenCode):
- If `manifest.query.sensitivity === "no_web"`: Gate F = **pass**.
- Else if citations mode is online: require at least one of `run-config.effective.citations.endpoints.{brightdata,apify}` to be non-empty.
- Else (dry_run/offline): Gate F = **pass**.

Follow the `gate_a_evaluate` contract shape:

```ts
return ok({
  gate_id: "F",
  status,
  metrics,
  update: { F: { status, checked_at: checkedAt, metrics, warnings, notes: "..." } },
  inputs_digest,
  warnings,
});
```

**Step 3: Wire Gate F evaluation into the finalize path**

In `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`, right before requesting `review -> finalize`:

1) Call `gate_f_evaluate.execute({ manifest_path, reason })`.
2) Call `gates_write.execute({ gates_path, update, inputs_digest, expected_revision, reason })`.
3) Then call `stage_advance` to `finalize`.

**Step 4: Re-run regression test and M3 smoke canary**

Run:

```bash
bun test .opencode/tests/regression/deep_research_gate_f_evaluate_wires_finalize_regression.test.ts
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add \
  .opencode/tools/deep_research_cli/gate_f_evaluate.ts \
  .opencode/tools/deep_research_cli/index.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tests/regression/deep_research_gate_f_evaluate_wires_finalize_regression.test.ts
git commit -m "feat(dr): evaluate and persist Gate F before finalize"
```

## Task 0.7: Include halt.next_commands[] inline in tick --json output

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts` (return next_commands to caller)
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/tick.ts` (include next_commands in emitted JSON)
- Create: `.opencode/tests/regression/deep_research_tick_json_next_commands_regression.test.ts`

**Step 1: Write failing regression test**

Create a regression test that forces a tick failure and asserts the JSON envelope includes `halt.next_commands`.

Notes:
- Run `tick --json` via a spawned process and parse stdout JSON.
- Force failure deterministically by running tick while in `perspectives` stage (tick-internals currently returns INVALID_STATE for perspectives).

**Step 2: Implement code change**

- Extend `handleTickFailureArtifacts()` return value to include `next_commands` (copy from the halt artifact that is already written by `writeHaltArtifact`).
- In `runTick()` JSON emission, include:

```ts
halt: haltArtifact
  ? {
      tick_index: haltArtifact.tickIndex,
      tick_path: haltArtifact.tickPath,
      latest_path: haltArtifact.latestPath,
      next_commands: haltArtifact.nextCommands,
      blockers_summary: ...
    }
  : null,
```

**Step 3: Make regression test PASS + commit**

```bash
bun test .opencode/tests/regression/deep_research_tick_json_next_commands_regression.test.ts
git add .opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts .opencode/pai-tools/deep-research-cli/handlers/tick.ts .opencode/tests/regression/deep_research_tick_json_next_commands_regression.test.ts
git commit -m "feat(dr-cli): include halt next_commands in --json output"
```

## Task 0.8: Fix broken repo Tools wrappers (deep_research → deep_research_cli)

**Files:**
- Modify: `Tools/deep-research-cli-stage-advance.ts`
- Modify: `Tools/deep-research-cli-fixture-run.ts`

**Step 1: Update imports**

- In `Tools/deep-research-cli-stage-advance.ts`, replace:

```ts
import { stage_advance } from "../.opencode/tools/deep_research/stage_advance";
```

with:

```ts
import { stage_advance } from "../.opencode/tools/deep_research_cli";
```

- In `Tools/deep-research-cli-fixture-run.ts`, replace:

```ts
} from "../.opencode/tools/deep_research.ts";
```

with:

```ts
} from "../.opencode/tools/deep_research_cli";
```

**Step 2: Quick sanity run (no full pipeline)**

```bash
bun Tools/deep-research-cli-stage-advance.ts --help
bun Tools/deep-research-cli-fixture-run.ts --help
```

Expected: usage/help text prints, no module-not-found errors.

**Step 3: Commit**

```bash
git add Tools/deep-research-cli-stage-advance.ts Tools/deep-research-cli-fixture-run.ts
git commit -m "fix(tools): update deep research wrappers to deep_research_cli"
```

## Phase 0 Gate (must PASS before Phase 1)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] Gate F enforcement is real and tested.
- [ ] No new schema drift introduced.
- [ ] JSON tick contract now includes the operator’s next_commands inline.
- [ ] Repo tooling wrappers are unbroken.

### QA Gate — PASS checklist

Run:

```bash
bun test .opencode/tests/regression/deep_research_timeout_consistency_regression.test.ts
bun test .opencode/tests/regression/deep_research_gate_f_enforcement_regression.test.ts
bun test .opencode/tests/regression/deep_research_gate_f_evaluate_wires_finalize_regression.test.ts
bun test .opencode/tests/regression/deep_research_tick_json_next_commands_regression.test.ts

# plus existing baseline tests
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

Expected: all PASS.
