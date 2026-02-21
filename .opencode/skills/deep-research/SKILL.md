---
name: deep-research
description: Canonical deep-research operator for Option C planning, execution, quality gates, and citations policy.
---

# Deep Research (Canonical Skill)

## Purpose

This is the canonical operator skill for Option C deep research. It is the source-of-truth for run contracts, workflows, quality gates, and CLI usage.

## Primary Surface

- Skill workflows in `Workflows/` (canonical operator guidance)
- CLI: `bun ".opencode/pai-tools/deep-research-cli.ts" <command> [...flags]`
- Run artifacts (manifest, gates, stage artifacts) are the source of truth; do not rely on ambient env vars.

## CLI invocation (repo vs runtime)

Use whichever path exists.

### Repo checkout (this repository)

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" <command> [...flags]
```

### Runtime install (`~/.config/opencode`)

```bash
bun "pai-tools/deep-research-cli.ts" <command> [...flags]
```

### LLM-driving recommendations

- Prefer `--json` when an LLM is driving the loop.
  - The CLI emits a single-line JSON envelope: `schema_version="dr.cli.v1"`.
  - When a command halts, `halt.next_commands` is included **inline** in that JSON.
- Prefer `--run-id` on `init` for deterministic reproduction/debugging.

## Perspective Drafting (task-driver seam)

Use this when you want **agent-authored perspectives** instead of the default `init`-generated `perspectives.json`.

### Why/when to run `init --no-perspectives`

Run `init` with `--no-perspectives` when:

1) You need the **perspectives stage** (`stage.current=perspectives`) and the `perspectives-draft` task-driver seam.
2) You want to **halt**, let an external agent produce a JSON payload, then ingest it deterministically.
3) You want `perspectives-draft` to **promote** `perspectives.json`, **regenerate** the Wave 1 plan, and **stage-advance** to `wave1`.

If you do **not** pass `--no-perspectives`, `init` may write `perspectives.json`, generate the Wave 1 plan, and advance directly to `stage.current=wave1` (skipping the perspectives drafting seam).

### Canonical happy path (end-to-end)

> Canonical workflow doc: `Workflows/DraftPerspectivesFromQuery.md`

1) Init without perspectives:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" init "<query>" \
  --mode standard \
  --sensitivity normal \
  --run-id "<run_id>" \
  --no-perspectives
```

2) Advance into the perspectives stage:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" stage-advance \
  --manifest "<manifest_abs>" \
  --gates "<gates_abs>" \
  --requested-next perspectives \
  --reason "enter perspectives drafting"
```

3) Prompt-out + HALT (task driver):

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "draft perspectives" \
  --driver task
```

4) Create a JSON output file matching **exactly** `perspectives-draft-output.v1`:

- Prompt: `<run_root>/operator/prompts/perspectives/primary.md`
- Write agent output JSON to: `<run_root>/operator/outputs/perspectives/primary.raw.json`

5) Ingest the JSON output:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" agent-result \
  --manifest "<manifest_abs>" \
  --stage perspectives \
  --perspective "primary" \
  --input "<run_root>/operator/outputs/perspectives/primary.raw.json" \
  --agent-run-id "<agent_run_id>" \
  --reason "ingest perspectives primary"
```

6) Rerun `perspectives-draft` to auto-promote + regenerate Wave 1 plan + stage-advance to Wave 1:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" perspectives-draft \
  --manifest "<manifest_abs>" \
  --reason "approve perspectives draft" \
  --driver task
```

7) Continue with Wave 1 task-driver loop:

- `Workflows/RunWave1WithTaskDriver.md`

### New/important artifacts

- `<run_root>/operator/state/perspectives-state.json`
- `<run_root>/operator/config/perspectives-policy.json`
- `<run_root>/operator/drafts/perspectives.draft.json`

### Staleness guard (Wave 1)

If `wave1` execution fails fast with `WAVE1_PLAN_STALE`, it means the Wave 1 plan’s perspectives digest no longer matches `perspectives.json`.

- Fix: **regenerate the Wave 1 plan** by re-running the perspectives drafting/promotion flow (see `Workflows/DraftPerspectivesFromQuery.md`).
- Note: `stage-advance` only moves forward; if you’re already in `stage.current=wave1`, recovery is typically a **fresh run** + re-draft perspectives.

### Operator surface contract (modes)

This skill is the operator surface. Legacy slashcommand docs are removed.

- **plan (offline-first):** `init` with `--sensitivity no_web`, optionally one `tick --driver fixture`, then stop.
- **fixture (offline):** `init` with `--sensitivity no_web`, loop `tick --driver fixture` until terminal status or typed blocker; use `triage` when blocked.
- **live (operator run):** use task-driver seams (`tick --driver task` + `agent-result`) to produce wave artifacts, then proceed through citations/summaries/synthesis.

> **Scaffold warning (required):** `--driver fixture` and `mode=generate` paths are deterministic scaffolding.
> They validate contracts/gates/artifacts, but do **not** constitute “real research” unless you are explicitly running
> the task-driver loop (`tick --driver task` + `agent-result`) with agent-authored outputs.

### Required final print contract

When operating a run (any mode), always capture/print:
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

## Canonical naming

- Canonical workflow references and contracts live in this skill (`deep-research`).

## No-env-var guidance (required)

- Do not require manual env-var setup for normal operation.
- Use explicit CLI flags and artifacts printed by the CLI.

## Scratchpad policy (required)

- Keep temporary notes, drafts, and analysis in the active scratchpad only.
- Do not write temporary artifacts into the repository.

## Workflows

- `Workflows/RunPlan.md`
- `Workflows/LLMDriverLoop.md`
- `Workflows/DraftPerspectivesFromQuery.md`
- `Workflows/RunM2Canary.md`
- `Workflows/RunM3Canary.md`
- `Workflows/RunWave1WithTaskDriver.md`
- `Workflows/RunFixtureToFinalize.md`
- `Workflows/RunLiveWave1ToPivot.md`
- `Workflows/TickUntilStop.md`
- `Workflows/OnlineCitationsLadderPolicy.md`
- `Workflows/SynthesisAndReviewQualityLoop.md`
- `Workflows/PauseRun.md`
- `Workflows/ResumeRun.md`

## Readiness contracts

- Run contracts and stage transitions in each workflow.
- Gate and artifact contract checks are expected before moving past each stage.
