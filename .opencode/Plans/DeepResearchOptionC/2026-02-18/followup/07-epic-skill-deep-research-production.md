# Epic E7 — New skill: `deep-research-production`

Status: TODO

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (contracts for wave outputs + citations policy + quality loop)
- Architect: `../architect-review-raw-2.md` (skill split recommendation + workflow list)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e7`
- Epic branch: `ws/epic-e7-production-skill`

## Target location
- New skill directory:
  - `.opencode/skills/deep-research-production/`

## Outcome (what “done” means)
This skill becomes the “production playbook” layer (prompting + policy + quality), separate from the mechanics skill (`deep-research-option-c`).

The new skill must:
- contain workflows that a new engineer/operator can follow
- include validation contracts (what to check, which artifacts prove PASS)
- avoid brittle doc references that break installer ScanBrokenRefs

## Bite-sized tasks

### E7-T0 — Skill skeleton
Create:
- `.opencode/skills/deep-research-production/SKILL.md`
- `.opencode/skills/deep-research-production/Workflows/`

SKILL.md must include:
- Purpose
- When to use vs `deep-research-option-c`
- “No env vars” guidance (explicit config as artifacts)
- Scratchpad policy
- Workflows list

### E7-T1 — Workflow: DraftPerspectivesFromQuery
Create: `Workflows/DraftPerspectivesFromQuery.md`
Include:
- how to derive multiple perspectives
- stability rules: ids, ordering
- tool budgets + required headings
- where to write `perspectives.json` (run root)
- validation contract:
  - schema version
  - unique ids
  - must-include sections

### E7-T2 — Workflow: RunWave1WithTaskDriver
Create: `Workflows/RunWave1WithTaskDriver.md`
This must align with E1’s chosen driver option.

Include:
- exact steps to run wave1 autonomously
- how to ingest outputs (`wave_output_ingest`)
- how to interpret retry directives
- how to record retries (`retry_record`)

### E7-T3 — Workflow: OnlineCitationsLadderPolicy
Create: `Workflows/OnlineCitationsLadderPolicy.md`
Include:
- offline vs online policy based on sensitivity
- how to handle blocked urls
- which artifacts to inspect:
  - `citations/blocked-urls.json`
  - `citations/online-fixtures.latest.json`
- validation contract for Gate C.

### E7-T4 — Workflow: SynthesisAndReviewQualityLoop
Create: `Workflows/SynthesisAndReviewQualityLoop.md`
Include:
- generate-mode (deterministic scaffolding) baseline
- future LLM mode (if applicable) as optional extension
- bounded iterations and exit criteria
- validation contract for Gate D/E artifacts.

### E7-T5 — Installer + docs validation
Goal: ensure the skill passes:
- ScanBrokenRefs
- ValidateSkillSystemDocs

Steps:
- run `bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --non-interactive --skills "...,deep-research-production" --dry-run`
  (or run it for real once the skill is ready).

### E7-T6 — Architect + QA gates

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E7-T0 Skill skeleton | TODO |  |  |  |
| E7-T1 DraftPerspectivesFromQuery | TODO |  |  |  |
| E7-T2 RunWave1WithTaskDriver | TODO |  |  |  |
| E7-T3 OnlineCitationsLadderPolicy | TODO |  |  |  |
| E7-T4 SynthesisAndReviewQualityLoop | TODO |  |  |  |
| E7-T5 Installer validation | TODO |  |  |  |
| Architect PASS | TODO |  |  |  |
| QA PASS | TODO |  |  |  |

## Validator gates

### Architect gate
- workflow contracts are complete and align with readiness rubric
- no brittle references

### QA gate
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e7"
bun Tools/Precommit.ts
```
