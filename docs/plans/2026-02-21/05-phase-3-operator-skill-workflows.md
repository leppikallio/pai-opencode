# Deep Research Option C — Phase 3 (operator skill docs + workflows) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make the `deep-research` skill the clear, LLM-drivable operator surface by adding missing workflows and fixing invocation/expectations footguns.

**Architecture:** Documentation-only changes under `.opencode/skills/deep-research/**` that:
- add one canonical LLM driver loop workflow,
- add M2/M3 canary workflows grounded in existing smoke tests,
- make “repo vs runtime invocation” rules explicit,
- clearly label generate-mode summaries/synthesis/review as scaffolding.

**Tech Stack:** Markdown docs; bun:test smoke references for evidence.

---

## Phase outputs (deliverables)

- New workflows exist:
  - `Workflows/LLMDriverLoop.md`
  - `Workflows/RunM2Canary.md`
  - `Workflows/RunM3Canary.md`
- Existing docs are updated:
  - `.opencode/skills/deep-research/SKILL.md` includes the new workflows and invocation rules.
  - `Workflows/SynthesisAndReviewQualityLoop.md` includes a prominent “scaffolding, not real research” warning.

## Task 3.1: Create Phase 3 worktree

**Files:**
- (none)

**Step 1: Create a worktree**

```bash
git worktree add /tmp/pai-dr-phase3 -b dr-phase3-skill-workflows
```

**Step 2: Verify clean state**

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 3.2: Add workflow doc — LLMDriverLoop

**Files:**
- Create: `.opencode/skills/deep-research/Workflows/LLMDriverLoop.md`

**Step 1: Write the workflow (complete doc)**

Create with this content:

```md
# LLM Driver Loop (task-driver)

This is the canonical “LLM drives the pipeline” loop:

`tick --driver task` → HALT → external agent writes outputs → `agent-result` ingest → `tick` again.

## Canonical CLI invocation (repo vs runtime)

Use whichever exists in your environment:

- Repo: `bun ".opencode/pai-tools/deep-research-cli.ts"`
- Runtime install: `bun "pai-tools/deep-research-cli.ts"`

All examples below assume repo invocation.

## Step 0: Init

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --json
```

Capture from JSON output:
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`

## Loop

Repeat until `stage.current == finalize` or `status` becomes `failed`/`cancelled`.

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --driver task \
  --reason "llm-driver-loop" \
  --json
```

### If `ok:true`

- Continue looping.

### If `ok:false` with `error.code == RUN_AGENT_REQUIRED`

1) Read `halt.next_commands[]` from the JSON response.
2) Open the referenced prompt file(s) under `<run_root>/operator/prompts/**`.
3) Run the external agent(s).
4) Write outputs to the exact `<run_root>/operator/outputs/**` paths.
5) Ingest:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage "<stage_from_halt>" \
  --perspective "<perspective_id>" \
  --input "<output_path_from_halt>" \
  --agent-run-id "<agent_run_id>" \
  --reason "llm-driver-loop ingest"
```

6) Re-run `tick`.

## Notes

- `--json` mode reserves stdout for one JSON object; logs go to stderr.
- Don’t rely on env vars; use the printed artifact paths.
```

**Step 2: Commit**

```bash
git add .opencode/skills/deep-research/Workflows/LLMDriverLoop.md
git commit -m "docs(dr): add LLM driver loop workflow"
```

---

## Task 3.3: Add workflow docs — RunM2Canary + RunM3Canary

**Files:**
- Create: `.opencode/skills/deep-research/Workflows/RunM2Canary.md`
- Create: `.opencode/skills/deep-research/Workflows/RunM3Canary.md`

**Step 1: Write RunM2Canary.md**

```md
# Run M2 Canary (Wave1 → Pivot)

This workflow runs the M2 smoke canary test as executable evidence.

## Run

From repo root:

```bash
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
```

## What it proves

- The artifact-first pipeline can progress to `pivot`.
- Gate B is computed and can be `pass`.

## What it does NOT prove

- Real web citations (canary is fixture-seeded).
- Fully autonomous agent spawning (task-driver seams may still halt).
```

**Step 2: Write RunM3Canary.md**

```md
# Run M3 Canary (Finalize)

This workflow runs the M3 smoke canary test as executable evidence.

## Run

```bash
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

## What it proves

- The stage machine can reach `finalize`.
- Gate E can be `pass` for the canary.

## What it does NOT prove

- Qualitative “real research” output quality.
- Online citations robustness without configured endpoints.
```

**Step 3: Commit**

```bash
git add \
  .opencode/skills/deep-research/Workflows/RunM2Canary.md \
  .opencode/skills/deep-research/Workflows/RunM3Canary.md
git commit -m "docs(dr): add M2/M3 canary workflows"
```

---

## Task 3.4: Update SKILL.md workflow list + invocation rules

**Files:**
- Modify: `.opencode/skills/deep-research/SKILL.md`

**Step 1: Add “repo vs runtime invocation” note (near Primary Surface)**

Add:

```md
### Repo vs runtime invocation

- Repo: `bun ".opencode/pai-tools/deep-research-cli.ts" ...`
- Runtime install: `bun "pai-tools/deep-research-cli.ts" ...`
```

**Step 2: Add workflows to list**

Append to the Workflows list:

- `Workflows/LLMDriverLoop.md`
- `Workflows/RunM2Canary.md`
- `Workflows/RunM3Canary.md`

**Step 3: Commit**

```bash
git add .opencode/skills/deep-research/SKILL.md
git commit -m "docs(dr): document invocation rules and new workflows"
```

---

## Task 3.5: Make scaffolding warning explicit in SynthesisAndReviewQualityLoop

**Files:**
- Modify: `.opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md`

**Step 1: Add warning block at top**

Add a prominent warning, for example:

```md
> **Warning:** The current `generate` paths for summaries/synthesis/review are deterministic scaffolding.
> They can pass Gate D/E while still being low-value research. For real research runs, prefer task/LLM-backed artifacts.
```

**Step 2: Commit**

```bash
git add .opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md
git commit -m "docs(dr): clarify generate-mode is scaffolding"
```

---

## Phase 3 Gate (completion)

**Manual verification:**

- `SKILL.md` lists the new workflows.
- The new workflow files exist and render.
