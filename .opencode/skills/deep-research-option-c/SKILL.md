---
name: deep-research-option-c
description: Deterministic Option C orchestration via the deep-research operator CLI.
---

# Deep Research Option C Skill

## Purpose

Use this skill to run Option C reliably from planning through finalize using the existing operator surface only.

## Primary Surface

- Command: `/deep-research` (installed command doc in the OpenCode runtime)
- CLI: `bun "pai-tools/deep-research-option-c.ts" <command> [...flags]` (run from the OpenCode runtime root)

## No-env-var Guidance (required)

- Do **not** require manual env var setup for normal operation.
- Use explicit CLI flags (`--mode`, `--sensitivity`, `--driver`, `--reason`) as the source of truth.
- Treat ambient env vars as non-authoritative; use the run artifacts printed by the CLI for state.

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

- [ ] **RunPlan** produced the run contract fields plus a deterministic Wave 1 plan (paths printed by the CLI).
- [ ] **RunFixtureToFinalize** exited 0 with `manifest.status=completed` and `manifest.stage.current=finalize`.
- [ ] **TickUntilStop** always ended each tick with either stage advancement or a typed halt artifact (path printed by the CLI).
- [ ] **TickUntilStop** enforced watchdog checks before and after ticks.
- [ ] **PauseRun** wrote `manifest.status=paused` plus a pause checkpoint containing stage + next step guidance.
- [ ] **ResumeRun** wrote `manifest.status=running`, reset stage timer semantics, and wrote a resume checkpoint.

## Quick CLI Usage

```bash
bun "pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
bun "pai-tools/deep-research-option-c.ts" tick --manifest "<abs>" --gates "<abs>" --reason "operator tick" --driver fixture
bun "pai-tools/deep-research-option-c.ts" run --manifest "<abs>" --gates "<abs>" --reason "operator run" --driver live --max-ticks 10
bun "pai-tools/deep-research-option-c.ts" pause --manifest "<abs>" --reason "operator pause"
bun "pai-tools/deep-research-option-c.ts" resume --manifest "<abs>" --reason "operator resume"
```
