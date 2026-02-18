# Track T01 — Platform Core

## Mission
Provide the **implementation substrate** in the integration repo: install layout, tool scaffolding, and deterministic file I/O conventions.

## In scope
- Implementation repo layout for tools/commands used by Option C
- Deterministic run-root layout under `~/.config/opencode/research-runs/`
- Shared utilities: schema validation helpers, path helpers, atomic writes
- Fixture and dry-run harness scaffolding (entity-test friendly)

## Out of scope
- Orchestrator sequencing logic (T02)
- Citation pipeline logic (T04)
- Reviewer factory logic (T05)

## Key artifacts (canonical refs)
- `deep-research-option-c-phase-01-platform-core.md`
- `spec-install-layout-v1.md`
- `spec-schema-validation-v1.md`

## Interfaces (inputs/outputs)
- **Input:** T00 specs (schemas, gates, thresholds)
- **Outputs:** reusable code modules and stable install paths that other tracks import

## Acceptance criteria (binary)
- A minimal tool can create a run root and write a validated `manifest.json` (fixture-driven test)
- Atomic write utilities prevent partial artifacts (test demonstrates power-loss safe behavior)
- Install/deploy flow documented and consistent with runtime constraints

## Dependencies
- Blocked by: T00

## Risks
- Path drift between repo and runtime → mitigate with single source mapping and install tests

## Owner / reviewer
- Owner: Engineer
- Reviewer: QATester
