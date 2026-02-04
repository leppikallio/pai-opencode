# Documentation plan + roadmap skeleton (scratch)

## Proposed docs (runtime-to-be)
1. `PLUGIN-SYSTEM-RATIONALE.md` — WHY plugins, invariants, failure modes.
2. `CAPTURE-FLOW-END-TO-END.md` — Events → RAW → WORK/ISC → LEARNING/RESEARCH/RELATIONSHIP.
3. `VERIFICATION-CHECKLIST-CAPTURE.md` — binary checks + operator procedure.
4. `DIFF-v2.5-vs-opencode.md` — “same intent, different mechanism” + gaps.

## Evidence anchors (cite in docs)
- Runtime:
  - `~/.config/opencode/plugins/pai-unified.ts`
  - `~/.config/opencode/plugins/handlers/history-capture.ts`
  - `~/.config/opencode/plugins/handlers/work-tracker.ts`
  - `~/.config/opencode/plugins/handlers/isc-parser.ts`
  - `~/.config/opencode/plugins/handlers/learning-capture.ts`
  - `~/.config/opencode/plugins/handlers/agent-capture.ts`
  - `~/.config/opencode/plugins/handlers/relationship-memory.ts`
- Reference:
  - `.../v2.5/.claude/hooks/StopOrchestrator.hook.ts`
  - `.../v2.5/.claude/hooks/handlers/ResponseCapture.ts`
  - `.../v2.5/.claude/hooks/handlers/ISCValidator.ts`
  - `.../v2.5/.claude/hooks/WorkCompletionLearning.hook.ts`
  - `.../v2.5/.claude/skills/PAI/Tools/FailureCapture.ts`

## Roadmap (gap backlog)

### P1 — correctness / alignment
- ✅ DONE: Persist `todowrite` state into `WORK/.../ISC.json` on tool completion. (Effort: M)
- Clarify/standardize accepted ISC output formats (so parsing is deterministic). (Effort: S)

### P2 — parity with v2.5
- Implement v2.5-style **FailureCapture bundle** for ratings 1–3 (context + transcript + tool calls). (Effort: L)
- Add “significant work” heuristics before emitting `work_*.md` learnings (v2.5 bridge behavior). (Effort: M)

### P3 — operator experience
- Add “where to look” troubleshooting flowcharts (RAW missing? WORK missing? ISC empty? LEARNING missing?). (Effort: S)
