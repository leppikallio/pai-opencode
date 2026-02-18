---
name: deep-research-production
description: Production playbook for Option C deep research runs, with operator contracts for wave execution, citations policy, and synthesis quality loops.
---

# Deep Research Production Skill

## Purpose

Use this skill as the production operations layer for Option C: perspective authoring, autonomous wave execution policy, citations ladder policy, and synthesis/review quality loops.

## When to use this vs `deep-research-option-c`

- Use `deep-research-option-c` for CLI mechanics (`init`, `tick`, `run`, `status`, `inspect`, `triage`).
- Use `deep-research-production` for production operator behavior and quality contracts.
- Typical pairing: `deep-research-option-c` runs stages, `deep-research-production` defines how outputs must be produced and validated.

## No-env-var guidance (required)

- Treat run artifacts as configuration truth (`manifest.json`, `gates.json`, `run-config.json`, wave artifacts).
- Pass run controls explicitly via CLI flags and tool inputs.
- Do not depend on ambient env vars for core run behavior.

## Scratchpad policy (required)

- Keep temporary notes/drafts in the active scratchpad only.
- Do not write temporary operator notes into the repository.
- Write outside scratchpad only when a workflow requires run-root artifacts.

## Workflows

- `Workflows/DraftPerspectivesFromQuery.md`
- `Workflows/RunWave1WithTaskDriver.md`
- `Workflows/OnlineCitationsLadderPolicy.md`
- `Workflows/SynthesisAndReviewQualityLoop.md`

## Cross-workflow validation contracts

- [ ] Wave outputs pass `wave_output_validate` and are represented in `wave-review.json`.
- [ ] Any retry is recorded with `retry_record` and writes a typed retry directives artifact.
- [ ] Citations used by synthesis resolve to the validated CID pool.
- [ ] Gate D and Gate E artifacts exist before calling final readiness PASS.
