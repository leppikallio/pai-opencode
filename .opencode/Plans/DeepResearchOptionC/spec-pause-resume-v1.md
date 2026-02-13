# spec-pause-resume-v1 (P00-C02)

## Purpose
Defines how we **pause and resume** Option C work and long-running implementations safely.

This SOP is designed to survive:
- OpenCode session compaction,
- total session loss,
- multi-week gaps between work.

## Canonical planning directory
All Option C planning docs live here:
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/Plans/DeepResearchOptionC`

## Source of truth files
1. `deep-research-option-c-progress-tracker.md` (status)
2. `deep-research-option-c-recovery-pack.md` (bootstrap)
3. Current phase executable backlog (`deep-research-option-c-phase-XX-executable-backlog.md`)
4. Phase doc (`deep-research-option-c-phase-XX-*.md`)
5. Reference index + subagent archives (principles)

## Pause protocol (end of work session)
1. Update **progress tracker**:
   - current phase row status
   - active tasks (add/remove)
   - blockers
   - next 3 actions
2. Update current phase backlog statuses (in_progress/review/done).
3. If anything is mid-review, write a short note into tracker with:
   - deliverable path
   - what reviewer is checking
4. Cut a checkpoint file if milestone boundary reached.

## Resume protocol (new session)
1. Read tracker.
2. Read recovery pack.
3. Identify the next unblocked task in the backlog.
4. Spawn Builder + Reviewer (pairing).
5. Update backlog and tracker.

## Checkpoint file template
Filename:
- `PHASE-<NN>-CHECKPOINT-<SHORT-NAME>.md`

Template:
```markdown
## Checkpoint
- Phase: <NN>
- Date: <YYYY-MM-DD>

### Completed (done)
- <task-id> <deliverable>

### In flight
- <task-id> <who> <what next>

### Blocked
- <task-id> <blocker>

### Decisions made
- <decision> <rationale>

### Next action (single)
- <next action>
```

## Subagent execution templates

### Builder prompt template
```text
You are the Builder for task <TASK_ID>.
Read the executable backlog and phase doc.
Produce deliverable: <DELIVERABLE_FILE>.
Include a final section titled "Evidence" that shows what proves completion.
```

### Reviewer prompt template
```text
You are the Reviewer for task <TASK_ID>.
Read the executable backlog.
Review <DELIVERABLE_FILE> against acceptance criteria.
Return PASS or CHANGES_REQUIRED.
```

## Evidence (P00-C02)
This SOP includes:
- canonical read order,
- pause + resume steps,
- checkpoint template,
- builder/reviewer prompt templates.
