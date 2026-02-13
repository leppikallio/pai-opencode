# Phase 01 — Platform Core Scaffolding (Weeks 2–3)

## PM / Orchestrator note
- For recovery/pause/resume, follow: `deep-research-option-c-recovery-pack.md`
- Do not violate Option C invariants in: `deep-research-option-c-master-plan.md`
- Execution backlog for this phase lives in: `deep-research-option-c-phase-01-executable-backlog.md`

## Objective
Build foundational runtime/state scaffolding for first-class deep research execution.

**Constraint:** no changes to OpenCode core; implement via tools/plugins/orchestrator.

## Dependencies
- Phase 00 Gate A passed.

## Workstreams (parallel)
### WS-01A: Run ledger and storage layout
- Implement run directory conventions.
- Implement manifest lifecycle updates.
- Implement deterministic artifact naming.

### WS-01B: Session integration
- Map run ledger to OpenCode session via supported surfaces:
  - server API calls (session todo updates, command execution)
  - plugin/tool emitted artifacts

### WS-01C: Feature flag scaffolding
- Add flags for enabling/disabling Option C components **in the integration layer** (config + tool behavior).
- Add per-mode limits to avoid runaway parallelization.

## Reviewer Pairing
- Builder: Engineer
- Reviewer: Architect

## Acceptance Criteria
- A run can be initialized, persisted, and resumed by reading manifest state.
- Artifacts are isolated and deterministic.
- Flags can disable Option C execution cleanly.

## Deliverables
- Run-state schema implementation plan
- Session mapping spec
- Feature flag matrix

## Risks
- Path inconsistency across environments.
- Partial writes to manifest.

## Mitigation
- Atomic write strategy and schema validation on every update.
