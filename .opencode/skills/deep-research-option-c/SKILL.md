---
name: deep-research-option-c
description: Deterministic Option C orchestration via the deep-research operator CLI.
---

# Deep Research Option C Skill

## Purpose

Use this skill to run Option C reliably from planning through finalize using the existing operator surface only.

## Primary Surface

- Command doc: `.opencode/commands/deep-research.md`
- CLI: `bun "Tools/deep-research-option-c.ts" <command> [...flags]`

## No-env-var Guidance (required)

- Do **not** require manual env var setup for normal operation.
- Use explicit CLI flags (`--mode`, `--sensitivity`, `--driver`, `--reason`) as the source of truth.
- Treat ambient env vars as non-authoritative; use run artifacts (`manifest.json`, `gates.json`, `run-config.json`) for state.

## Scratchpad Policy (required)

- Keep temporary notes, drafts, and analysis in the active scratchpad only.
- Do **not** write temporary artifacts into the repository.
- Only write outside scratchpad when the destination is explicitly required by the workflow (for example run-root artifacts produced by the CLI).

## Workflows

- `Workflows/RunPlan.md`
- `Workflows/RunLiveWave1ToPivot.md`
- `Workflows/RunFixtureToFinalize.md`
- `Workflows/TickUntilStop.md`
- `Workflows/PauseRun.md`
- `Workflows/ResumeRun.md`

## Readiness Gates Checklist

- [ ] **RunPlan** produced `manifest.json`, `gates.json`, `perspectives.json`, and `wave-1/wave1-plan.json` with `inputs_digest`.
- [ ] **RunFixtureToFinalize** exited 0 with `manifest.status=completed` and `manifest.stage.current=finalize`.
- [ ] **TickUntilStop** always ended each tick with either stage advancement or a typed halt artifact (`logs/halt.json`).
- [ ] **TickUntilStop** enforced watchdog checks before and after ticks.
- [ ] **PauseRun** wrote `manifest.status=paused` plus `logs/pause-checkpoint.md` with stage + next step.
- [ ] **ResumeRun** wrote `manifest.status=running`, reset stage timer semantics, and created `logs/resume-checkpoint.md`.

## Quick CLI Usage

```bash
bun "Tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
bun "Tools/deep-research-option-c.ts" tick --manifest "<abs>" --gates "<abs>" --reason "operator tick" --driver fixture
bun "Tools/deep-research-option-c.ts" run --manifest "<abs>" --gates "<abs>" --reason "operator run" --driver live --max-ticks 10
bun "Tools/deep-research-option-c.ts" pause --manifest "<abs>" --reason "operator pause"
bun "Tools/deep-research-option-c.ts" resume --manifest "<abs>" --reason "operator resume"
```
