# PAI v2.5 reference intent (Claude hooks + MEMORY)

Source explored:
- `/Users/zuul/Projects/ti2/Personal_AI_Infrastructure/Releases/v2.5/.claude`

## Canonical intent (high signal)

### History capture
- **Source of truth is Claude Code transcripts** (`projects/` JSONL). PAI should not create a second raw “firehose”.
  - `/.../.claude/MEMORY/README.md`
  - `/.../.claude/skills/PAI/SYSTEM/MEMORYSYSTEM.md`
- Hooks create *derived* artifacts directly into `MEMORY/` (WORK, LEARNING, RESEARCH, STATE).

### Work tracking (WORK + STATE)
- `MEMORY/WORK/` is the primary tracking surface; `MEMORY/STATE/` is ephemeral.
- Flow is hook-driven:
  - `UserPromptSubmit` → `AutoWorkCreation.hook.ts`
  - `Stop` → `StopOrchestrator.hook.ts` → handler fan-out (`ResponseCapture.ts`, `ISCValidator.ts`, …)
  - `SessionEnd` → `SessionSummary.hook.ts`
- `ISCValidator.ts` can **block** if the Algorithm was attempted but ISC is missing.

### Learning capture
- Learnings are **derived insights**, not raw events (`MEMORY/LEARNING/README.md`).
- Entry points:
  - Stop-time detection from response (ResponseCapture)
  - Explicit ratings + implicit sentiment → `LEARNING/SIGNALS/ratings.jsonl` + learning notes
  - `WorkCompletionLearning.hook.ts` bridges WORK → LEARNING (significant work only)
  - Ratings 1–3 → **FailureCapture**: full context bundle (`CONTEXT.md`, transcript, tool-calls, …)

### Subagent capture
- `AgentOutputCapture.hook.ts` writes Task/subagent output into `MEMORY/RESEARCH/YYYY-MM/`.

### Plugin/extensibility model (WHY)
- **Hooks** are the event-driven “plugin” layer (non-blocking, fail gracefully, single responsibility).
- **Skills** are modular domain packages with canonical structure + triggers (`SKILLSYSTEM.md`).
- **SYSTEM/USER tiering** enables private overrides and safe updates (`SYSTEM_USER_EXTENDABILITY.md`).

## Key intent invariants (for a later diff)
1. Transcripts (`projects/`) are the history source of truth.
2. Hooks derive artifacts directly; no duplicate firehose layer.
3. WORK primary; STATE ephemeral.
4. Low ratings/sentiment create durable learnings; 1–3 capture full failure context.
5. Algorithm scaffolding is enforced (including ISC presence).
