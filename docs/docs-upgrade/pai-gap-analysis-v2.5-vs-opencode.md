# Gap analysis: v2.5 reference intent vs current runtime

This is a *design alignment* diff: what v2.5 intended, what runtime does, and whether it’s a **preserved intent**, a **necessary adaptation**, or a **missing capability**.

## A) History capture

### Intent (v2.5)
- Transcripts (`projects/` JSONL) are the raw history source of truth.
- PAI should not duplicate raw history into a second firehose.

### Runtime (OpenCode)
- Creates its own append-only RAW firehose:
  - `~/.config/opencode/MEMORY/RAW/YYYY-MM/ses_<id>.jsonl`
  - `plugins/handlers/history-capture.ts`

### Assessment
- **Adaptation (likely necessary):** OpenCode doesn’t provide Claude’s `projects/` transcript store; RAW becomes the replacement source-of-truth.
- **Doc requirement:** explicitly state the reason for this divergence.

## B) Work tracking surface

### Intent (v2.5)
- WORK is primary tracking; STATE is ephemeral.
- Work scaffolding is task-centric under WORK (tasks/{NNN_slug}/ISC.json, THREAD.md, etc.).

### Runtime
- Work directory is session-centric:
  - `~/.config/opencode/MEMORY/WORK/YYYY-MM/ses_<id>/`
  - `META.yaml`, `THREAD.md`, `ISC.json`
- STATE keeps a per-session pointer map: `STATE/current-work.json`.

### Assessment
- **Adaptation:** session-centric model is fine, but doc should clarify how/if “tasks/” are used.

## C) ISC capture (biggest behavioral mismatch)

### Intent (v2.5)
- ISC is created via the algorithm format and validated; missing ISC can block.
- Persistence is explicit in WORK/task files.

### Runtime
- `ISC.json` starts empty.
- Persistence is now **dual-path**:
  1) **todowrite tool-state persistence** (preferred)
  2) **assistant-text parsing** (fallback)

### Evidence (current session)
- Previously observed: ISC could remain empty when captured only via `todowrite` tool-calls.
- Fix implemented: `todowrite` tool calls are now persisted directly into `ISC.json` from `tool.after`.

### Assessment
- **Resolved gap:** “todowrite” tool state is now part of persisted ISC.
- **Remaining doc requirement:** document the dual-path persistence, and the precedence rules.

## D) Learning capture

### Intent (v2.5)
- Multiple triggers; ratings 1–3 generate full FailureCapture bundles.
- SessionEnd bridge: “significant work only” heuristic.

### Runtime
- Extracts learnings from WORK artifacts (`THREAD.md`, `ISC.json`, `scratch/*.md`).
- Ratings are stored in `LEARNING/SIGNALS/ratings.jsonl`.
- “Failures” on low ratings are markdown notes; no evidence (yet) of full context bundle like v2.5’s `FailureCapture.ts`.

### Assessment
- **Partial gap:** failure-capture depth appears reduced vs v2.5.
- **Doc requirement:** explain current behavior and why; list as roadmap item if we want parity.

## E) Plugin/hook model

### Intent (v2.5)
- Claude Code hooks in settings.json; StopOrchestrator parses transcript once, fans out handlers.

### Runtime
- OpenCode plugin event handlers in-process, unified in `plugins/pai-unified.ts`.

### Assessment
- **Preserved intent:** event-driven “plugins” exist; non-blocking + graceful failure is still a core principle.

## F) Relationship memory

### Intent (v2.5)
- RelationshipMemory hook writes relationship notes.

### Runtime
- `plugins/handlers/relationship-memory.ts` writes daily notes under `MEMORY/RELATIONSHIP/YYYY-MM/YYYY-MM-DD.md`.

### Assessment
- **Preserved intent**.
