# spec-session-progress-v1 (P01-07)

## Purpose
Define how Option C updates user-visible progress via OpenCode server APIs (no core changes).

## Evidence
OpenCode exposes session todo *reading* via server API:
- `/Users/zuul/Projects/opencode/packages/web/src/content/docs/server.mdx` (GET "/session/:id/todo")

Todo *writing* is exposed to the LLM via the built-in `todowrite` tool (not via a public server endpoint):
- `/Users/zuul/Projects/opencode/packages/opencode/src/tool/todo.ts` (TodoWriteTool -> Todo.update)

## Progress surfaces (v1)
1. **Session todos**: phase/stage updates.
2. **Artifact pointers**: write the run root path early.
3. **Gate results**: summarize pass/fail and link to `gates.json`.

## Conventions
Todo items:
- Content:
  - `DR: init` / `DR: wave1` / `DR: pivot` / `DR: citations` / `DR: summaries` / `DR: synthesis` / `DR: review`
- Recommended stable IDs:
  - `dr:init`, `dr:wave1`, `dr:pivot`, `dr:citations`, `dr:summaries`, `dr:synthesis`, `dr:review`

Status mapping:
- stage started -> todo `in_progress`
- stage complete -> todo `completed`
- stage failed -> todo `blocked` with reason

## Abort behavior
If watchdog triggers, orchestrator must:
1. mark current todo blocked with reason
2. call session abort endpoint (server API)
3. persist failure record into manifest (`failures[]`)

## Acceptance criteria
- A user can tell what stage is running without reading logs.
- Abort is visible and leaves a durable artifact trail.

## Evidence
This file defines exact progress conventions and abort behavior.
