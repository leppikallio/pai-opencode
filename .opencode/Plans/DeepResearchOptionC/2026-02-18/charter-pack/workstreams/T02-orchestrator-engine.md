# Track T02 — Orchestrator Engine

## Mission
Implement the **tool-driven stage machine** and the operator command that coordinates tools, agents, and gates.

## In scope
- Deterministic stage transitions (init → wave1 → citations → summaries → synthesis → gates)
- Pause/resume: resume from on-disk artifacts (manifest + checkpoints)
- Hard-gate enforcement: stop on C/D failures; controlled retries via policy
- Operator UX command (entrypoint) that runs the pipeline without OpenCode core changes

## Out of scope
- Defining gate thresholds (T00)
- Implementing the citation tooling internals (T04)
- Implementing the synthesis/review factory internals (T05)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-02-orchestrator-engine.md`
- `spec-stage-machine-v1.md`
- `spec-pause-resume-v1.md`
- `spec-watchdog-v1.md`

## Interfaces (inputs/outputs)
- **Inputs:** T00 schemas/gates; T03 wave output contracts; T04/T05 tools
- **Outputs:** manifest + gates artifacts per run; standardized stage logs

## Acceptance criteria (binary)
- A canary run can be initialized, paused, resumed, and completed from artifacts alone
- Hard gates block advancement deterministically (fixture-based tests)
- Operator command produces a deterministic run root with expected artifacts

## Dependencies
- Blocked by: T01, T03 (contracts), T04 (citations tooling), T05 (synthesis tooling)

## Risks
- Orchestrator becomes a “giant prompt” in code form → mitigate with explicit stage contracts + tests per stage

## Owner / reviewer
- Owner: Engineer
- Reviewer: Architect
