# Deep Research Option C — Phase 0d (atomic operator artifacts) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Prevent partial/corrupted operator artifacts on crash by making all high-value writes atomic (write temp → rename).

**Architecture:** Introduce small atomic write helpers where needed and replace direct `writeFile()` calls for:
- `operator/halt/*.json`
- `operator/prompts/**`
- `operator/outputs/**`
- `run-config.json`
- any `*.meta.json` sidecars

**Tech Stack:** Bun + TypeScript; tool layer + operator CLI.

---

## Phase outputs (deliverables)

- Operator CLI halt artifacts (`tick-*.json`, `latest.json`) are written atomically.
- `init` writes `run-config.json` atomically.
- Tool/orchestrator layer writes prompts/outputs/sidecars atomically (at least for summaries/synthesis/wave2 seams).

## Task 0d.1: Create Phase 0d worktree

**Files:**
- (none)

**Step 1: Create a worktree**

```bash
git worktree add /tmp/pai-dr-phase0d -b dr-phase0d-atomic-artifacts
```

**Step 2: Verify clean state**

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 0d.2: Add failing unit test for atomic write helper (CLI-side)

**Files:**
- Create: `.opencode/pai-tools/deep-research-cli/utils/atomic-write.ts`
- Create: `.opencode/tests/entities/deep_research_cli_atomic_write_entity.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { atomicWriteText } from "../../pai-tools/deep-research-cli/utils/atomic-write";

describe("deep-research-cli atomicWriteText (entity)", () => {
  test("writes full file via rename", async () => {
    const dir = path.join(os.tmpdir(), "dr-atomic-write-test");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, "out.txt");

    await atomicWriteText(target, "hello\n");
    const read = await fs.readFile(target, "utf8");
    expect(read).toBe("hello\n");
  });
});
```

Expected today: FAIL (helper doesn’t exist).

**Step 2: Implement helper + commit**

In `utils/atomic-write.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function atomicWriteText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, value, "utf8");
  await fs.rename(tmp, filePath);
}
```

Then:

```bash
bun test .opencode/tests/entities/deep_research_cli_atomic_write_entity.test.ts
git add .opencode/pai-tools/deep-research-cli/utils/atomic-write.ts .opencode/tests/entities/deep_research_cli_atomic_write_entity.test.ts
git commit -m "feat(dr-cli): add atomic write helper"
```

---

## Task 0d.3: Make halt artifacts atomic

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts:171-231`

**Step 1: Add failing entity test (optional but preferred)**

If feasible, add `.opencode/tests/entities/deep_research_cli_halt_atomic_entity.test.ts` that:
- calls `writeHaltArtifact()` in a temp run root
- asserts both files exist and are valid JSON

**Step 2: Replace direct writes**

Replace:

```ts
await fs.writeFile(tickPath, serialized, "utf8");
await fs.writeFile(latestPath, serialized, "utf8");
```

with:

```ts
await atomicWriteText(tickPath, serialized);
await atomicWriteText(latestPath, serialized);
```

Import the helper from `utils/atomic-write`.

**Step 3: Commit**

```bash
git add .opencode/pai-tools/deep-research-cli/triage/halt-artifacts.ts
git commit -m "fix(dr-cli): write halt artifacts atomically"
```

---

## Task 0d.4: Make init run-config write atomic

**Files:**
- Modify: `.opencode/pai-tools/deep-research-cli/handlers/init.ts:100-177`

**Step 1: Replace run-config write**

Replace:

```ts
await fs.writeFile(outPath, `${JSON.stringify(runConfig, null, 2)}\n`, "utf8");
```

with:

```ts
await atomicWriteText(outPath, `${JSON.stringify(runConfig, null, 2)}\n`);
```

**Step 2: Commit**

```bash
git add .opencode/pai-tools/deep-research-cli/handlers/init.ts
git commit -m "fix(dr-cli): write run-config atomically"
```

---

## Task 0d.5: Make tool-layer operator prompts/outputs atomic (start with post-summaries)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts` (wave2 prompts/outputs)
- Use existing helpers:
  - `.opencode/tools/deep_research_cli/utils.ts:atomicWriteText`
  - `.opencode/tools/deep_research_cli/utils.ts:atomicWriteJson`

**Step 1: Identify direct writes**

Replace `fs.promises.writeFile(...)` calls that write into:
- `<run_root>/operator/prompts/**`
- `<run_root>/operator/outputs/**`
- `<run_root>/**.meta.json`

with `atomicWriteText/atomicWriteJson`.

**Step 2: Add a regression test**

Create `.opencode/tests/regression/deep_research_operator_artifacts_atomic_regression.test.ts`:

- Run a tick in `driver=task` that writes prompts.
- Assert prompt file exists and is non-empty.

(This won’t prove atomicity under crash, but it protects against accidental path breakage.)

**Step 3: Commit**

```bash
bun test .opencode/tests/regression/deep_research_operator_artifacts_atomic_regression.test.ts
git add \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tests/regression/deep_research_operator_artifacts_atomic_regression.test.ts
git commit -m "fix(dr): write operator prompts/outputs atomically"
```

---

## Phase 0d Gate (completion)

Run:

```bash
bun test .opencode/tests/entities/deep_research_cli_atomic_write_entity.test.ts
```

Expected: PASS.
