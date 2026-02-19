---
name: deep-research
description: Canonical deep-research operator for Option C planning, execution, quality gates, and citations policy.
---

# Deep Research (Canonical Skill)

## Purpose

This is the canonical operator skill for Option C deep research. It is the source-of-truth for run contracts, workflows, quality gates, and CLI usage.

## Primary Surface

- Skill workflows in `Workflows/` (canonical operator guidance)
- CLI: `bun ".opencode/pai-tools/deep-research-option-c.ts" <command> [...flags]`
- Run artifacts (manifest, gates, stage artifacts) are the source of truth; do not rely on ambient env vars.

### Operator surface contract (modes)

This skill is the operator surface. Legacy slashcommand docs are removed.

- **plan (offline-first):** `init` with `--sensitivity no_web`, optionally one `tick --driver fixture`, then stop.
- **fixture (offline):** `init` with `--sensitivity no_web`, loop `tick --driver fixture` until terminal status or typed blocker; use `triage` when blocked.
- **live (operator run):** use task-driver seams (`tick --driver task` + `agent-result`) to produce wave artifacts, then proceed through citations/summaries/synthesis.

### Required final print contract

When operating a run (any mode), always capture/print:
- `run_id`
- `run_root`
- `manifest_path`
- `gates_path`
- `stage.current`
- `status`

## Compatibility

- `deep-research-option-c` and `deep-research-production` are retained as compatibility stubs only.
- Canonical workflow references and contracts now live in this skill.

## No-env-var guidance (required)

- Do not require manual env-var setup for normal operation.
- Use explicit CLI flags and artifacts printed by the CLI.

## Scratchpad policy (required)

- Keep temporary notes, drafts, and analysis in the active scratchpad only.
- Do not write temporary artifacts into the repository.

## Workflows

- `Workflows/RunPlan.md`
- `Workflows/DraftPerspectivesFromQuery.md`
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
