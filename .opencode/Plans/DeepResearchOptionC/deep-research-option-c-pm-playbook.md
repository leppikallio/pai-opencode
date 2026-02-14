# Option C PM Playbook (How to run this program)

## 0) Immediate orientation
If you only read one thing, read:
- `deep-research-option-c-progress-tracker.md`

Plan root directory:
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC`

If session context is missing, read:
- `deep-research-option-c-recovery-pack.md`

## 1) What “a good plan” means here
Every task must have:
- a deliverable file/code artifact,
- acceptance criteria,
- explicit evidence of completion,
- an owner (builder) and reviewer.

## 2) What happens next (algorithm)
1. Read tracker → identify current phase.
2. Open current phase executable backlog → pick next unblocked task.
3. Spawn Builder with task + deliverable path.
4. Spawn Reviewer with acceptance checklist.
5. Update backlog status (in_progress → review → done).
6. Repeat until phase gate signoff task is done.

## 3) Anti-drift rule
If anyone proposes changing the vision:
- update `deep-research-option-c-master-plan.md` invariants,
- update Phase 00 schemas/gates, then proceed.
If it’s not updated in files, it’s not real.

## 4) Key constraints
- No OpenCode core changes.
- Existing runtime agents only.
- Artifact-first; synthesis bounded.

## 5) Testing requirement (Phase 01+)
No phase may be signed off unless:
- entity-level tests exist for new functional entities introduced in the phase
- tests can run in isolation (fixtures/dry-run) without executing full research

Canonical strategy doc:
- `deep-research-option-c-testing-strategy-v1.md`
