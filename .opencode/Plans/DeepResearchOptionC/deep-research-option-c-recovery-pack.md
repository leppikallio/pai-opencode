# Option C Recovery Pack (Session Loss Safe)

## READ THIS FIRST (PM / Orchestrator)
If you are responsible for continuing this project (human or agent):
- Do **not** rely on chat history.
- Reconstruct state by reading the files below in order.

## Why this exists
If session context is compacted or lost, this file is the bootstrap to resume execution without relying on memory.

## Plan root directory (canonical)
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC`

## Canonical Source of Truth Files (read in this exact order)
1. `deep-research-option-c-progress-tracker.md`
2. `deep-research-option-c-phase-00-executable-backlog.md`
3. `deep-research-option-c-phase-00-governance.md`
4. `deep-research-option-c-master-plan.md`
5. `deep-research-roadmap-subagent-archive.md`
6. `deep-research-architecture-subagent-archive.md`

## Linked Reference Sources
- Legacy extracted implementation root (structured):
  - `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured`
- Subagent in-depth reports:
  - `/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3a9526b1cffeoLAYfHa1RNDLPi/scratch/deep-research-roadmap-subagent-archive.md`
  - `/Users/zuul/.config/opencode/MEMORY/WORK/2026-02/ses_3a9526b1cffeoLAYfHa1RNDLPi/scratch/deep-research-architecture-subagent-archive.md`

## Program Decision Snapshot
- Selected strategy: **Option C (Ambitious, 12–16 weeks)**
- Current phase: **Phase 01**
- Current status: **in_progress**

## Phase 00 status
Phase 00 is complete (Gate A PASS):
- `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md`

## Resume Procedure (new session)
1. Open and read the tracker file first.
2. Open current phase executable backlog.
3. Select one active task (or next unblocked task).
4. Spawn **Builder** subagent with task-specific prompt and explicit output file path.
5. Spawn **Reviewer** subagent with acceptance criteria + deliverable path.
6. Update tracker and backlog statuses (`in_progress` -> `review` -> `done`).
7. Repeat until the current phase checkpoint/signoff task is complete.

## Roles (who does what)
- **PM / Orchestrator**: reads tracker, selects next unblocked task, spawns builder+reviewer, updates statuses.
- **Builder**: produces the deliverable file and includes an “Evidence” section.
- **Reviewer**: returns PASS/CHANGES_REQUIRED strictly against acceptance criteria.

## Subagent Prompt Pattern (Builder)
```text
You are executing task <TASK_ID> from the current phase backlog.
Read:
- deep-research-option-c-phase-00-executable-backlog.md
- deep-research-option-c-phase-00-governance.md
- deep-research-option-c-master-plan.md

Produce deliverable:
- <DELIVERABLE_FILE>

Requirements:
- Follow dependencies and acceptance criteria exactly.
- Keep output implementation-ready and specific.
- Return a completion summary + key decisions.
```

## Subagent Prompt Pattern (Reviewer)
```text
You are reviewing deliverable <DELIVERABLE_FILE> for task <TASK_ID>.
Read:
- deep-research-option-c-phase-00-executable-backlog.md
- deep-research-option-c-phase-00-governance.md

Check:
1) Acceptance criteria pass/fail
2) Missing or ambiguous requirements
3) Risks introduced by the deliverable

Return:
- PASS or CHANGES_REQUIRED
- exact required edits if changes required
```

## Completion Condition for Phase 00 (historical)
Phase 00 completion evidence:
- `PHASE-00-CHECKPOINT-ARCH-REVIEW.md`
- `PHASE-00-CHECKPOINT-QA-REVIEW.md`
- `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md`
