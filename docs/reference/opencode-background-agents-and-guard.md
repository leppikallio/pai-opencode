# OpenCode Background Agents + AgentExecutionGuard (Research)

**Purpose:** Document what “background agent execution” can mean in OpenCode today, and what we can enforce for CC-hook-parity without forking OpenCode.

**Local sources:**
- OpenCode upstream: `/Users/zuul/Projects/opencode`
- oh-my-opencode reference implementation: `/Users/zuul/Projects/oh-my-opencode`

---

## Key finding (summary)

1) **OpenCode built-in `task` tool is synchronous** (no `run_in_background` param). It creates/resumes a child session and **awaits** its completion.

2) **OpenCode plugins can define custom tools** via `Hooks.tool` (a map of tool definitions). This means we can ship a PAI-owned **background-capable `task` tool override** (with `run_in_background`) **without** forking OpenCode.

3) **oh-my-opencode already implements this pattern**: it adds delegate/background tools, a `BackgroundManager`, and a `run_in_background` boolean to choose async vs sync behavior.

4) **PAI now implements a minimal parity surface** (without a full BackgroundManager port yet):
   - `task(run_in_background:true)` returns a **string** (plugin tool contract) and launches via `promptAsync` when available.
   - `background_output(task_id="bg_<sessionId>")` retrieves messages from the child session.
   - `background_cancel(task_id=...)` aborts the child session.
   - Background completion notifications are handled via `session.idle` event hooks + persisted state.

---

## Current implementation (PAI plugin) — practical notes

### `task` (background mode)

- Call: `task(description="...", prompt="...", subagent_type="...", run_in_background=true)`
- Creates a child session with `parentID=<current session>`
- Launches the prompt using `client.session.promptAsync(...)` (falls back to `prompt(...)` if needed)
- Persists state under `${PAI_DIR}/MEMORY/STATE/background-tasks.json` (defaults to `~/.config/opencode/...`)
- Returns a **string** like:

```text
Background task launched.

Task ID: bg_<childSessionId>
Session ID: <childSessionId>
Agent: <subagent_type>

System notifies on completion. Use `background_output` with task_id="bg_<childSessionId>" to check.
```

**Important:** `Task ID` and `Session ID` are intentionally different.

- `task_id` format: `bg_<childSessionId>`
- `child_session_id` format: `ses_...` (OpenCode session id)

### `background_output`

- Call: `background_output(task_id="bg_<childSessionId>")`
- Defaults: `full_session=true`, `message_limit=50`
- Uses `client.session.messages({ path: { id: <childSessionId> }, query: { limit } })`
- Useful args:
  - `full_session`: return a readable transcript (role + text)
  - `since_message_id`: only return messages after a known message id
  - `block=true`: wait until state shows completion (rarely needed; completion is notified)

### `background_cancel`

- Call: `background_cancel(task_id="bg_<childSessionId>")`
- Uses `client.session.abort({ path: { id: <childSessionId> } })`
- Marks the state record as completed with `launch_error="cancelled"` for observability.

---

## Evidence (OpenCode plugin supports custom tools)

OpenCode plugin API allows plugins to add tools:
- `/Users/zuul/Projects/opencode/packages/plugin/src/index.ts:148-154`

```ts
export interface Hooks {
  ...
  tool?: {
    [key: string]: ToolDefinition
  }
  ...
}
```

Implication: PAI can ship a background-capable `task` tool override as a plugin tool.

---

## Evidence (OpenCode built-in Task tool is synchronous)

OpenCode Task tool schema does **not** include `run_in_background`:
- `packages/opencode/src/tool/task.ts:14-25` (see agent discovery notes)

OpenCode Task tool awaits the sub-session prompt:
- `packages/opencode/src/tool/task.ts:128-143` (awaits `SessionPrompt.prompt(...)`)

Implication: CC v3.0’s `AgentExecutionGuard` expectation (`run_in_background: true`) cannot be met by the built-in `task` tool alone.

Practical implication for PAI: you must use the **plugin tool override** (which adds `run_in_background`) to get non-blocking delegation.

---

## Evidence (oh-my-opencode background model)

### `run_in_background` exists and is first-class

- `oh-my-opencode/src/tools/delegate-task/types.ts:16` — `run_in_background: boolean`
- `oh-my-opencode/src/tools/delegate-task/tools.ts:241-245` — routes by `run_in_background`

### Background execution lifecycle

Background execution is implemented with queueing + concurrency + event/poll hybrid completion:
- `oh-my-opencode/src/features/background-agent/manager.ts:142-209` — create task + enqueue
- `manager.ts:249-399` — startTask creates child session + starts prompt (fire-and-forget)
- `manager.ts:744-801` — completion on `session.idle`
- `manager.ts:1794-1866` — polling fallback

---

## What AgentExecutionGuard can enforce (OpenCode PAI)

### Today (even without custom tools)

Guard can enforce **policy** at `tool.execute.before` (tool=="task"):
- restrict which `subagent_type` is allowed
- require opt-in markers in task description/prompt
- enforce max prompt size / max parallelism

But without a background-capable tool override, it cannot make `task` non-blocking.

### Implemented (PAI): plugin background-capable `task` tool

Implemented as a plugin tool based on **oh-my-opencode** (preferred): exposed as tool id **`task`** (override builtin) with inputs:

```ts
{
  description: string,
  prompt: string,
  subagent_type: string,
  run_in_background: boolean,
}
```

Behaviors:
- If `run_in_background: true`:
  - create a child session (parentID)
  - call `promptAsync` (or equivalent client call)
  - return immediately with a **string** containing `Task ID` + `Session ID`
  - completion is detected via `session.idle` event hooks + persisted state (cmux/voice notification)
- If false:
  - optionally run synchronous path (not the priority for parity)

Then AgentExecutionGuard changes meaning:
- Prefer/require `task(run_in_background=true)` for long-running work
- Ask/warn on `task(run_in_background=false)` usage that would block

## Evidence: tool override without touching OpenCode source

- Tool list order is **built-ins first, custom tools last**:
  - `/Users/zuul/Projects/opencode/packages/opencode/src/tool/registry.ts:101-122` (includes `TaskTool` then `...custom`).
- Tool selection in the prompt is a **map keyed by tool id**; later duplicates override earlier:
  - `/Users/zuul/Projects/opencode/packages/opencode/src/session/prompt.ts:744-787` (`tools[item.id] = tool(...)`).

## Decision captured

- Implemented: minimal parity surface (background-capable `task` tool override + `background_output` + `background_cancel`).
- Deferred: full `BackgroundManager` port (queueing, concurrency controls, richer status formatting) — implement later if needed.

---

## Open questions (to decide in the master plan)

1) Completion UX (CAPTURED):
   - Default completion surface: **cmux + voice**.
   - Must be debounced/deduped to prevent spam.

2) Completion dedupe policy (CAPTURED):
   - Emit **at most one completion notification per `task_id`**.
   - Additionally, drop identical repeats (same title+body) within **2 seconds per sessionId**.

3) Policy thresholds (CAPTURED):
   - “Background” means the **plugin-defined** `task` tool with `run_in_background: true`.
   - Guard default action on policy violations (once background-capable `task` exists): **ASK** (not DENY).
   - Foreground allowed (no ask) only if either:
     - `subagent_type == "explore"`, OR
     - prompt explicitly declares `Timing: FAST`.
   - Foreground requires ASK if any of:
     - prompt declares `Timing: STANDARD` or `Timing: DEEP`
     - prompt length > ~800 chars (heuristic)
     - prompt contains “run tests / build / implement / refactor / debug / investigate” (heuristic)

---

## Proposed Decision Tree (AgentExecutionGuard)

**Goal:** prevent UI stalls by steering long-running spawns to `task(run_in_background=true)`.

Inputs available at `tool.execute.before` (`task`):
- `subagent_type`
- `prompt`
- `run_in_background` (PAI tool override arg; OpenCode builtin TaskTool does not expose it)

Decision tree:

1) If tool == `task` AND `run_in_background == true` → **ALLOW**.

2) Compute `isFast` if prompt contains `Timing: FAST`.

3) Compute `isLongLikely` if any:
   - prompt contains `Timing: STANDARD` or `Timing: DEEP`
   - prompt length > ~800 chars
   - prompt matches regex `\b(run tests|build|implement|refactor|debug|investigate)\b`

4) If NOT `isLongLikely` AND (`subagent_type == "explore"` OR `isFast`) → **ALLOW** (but may emit a warning systemMessage).

5) Otherwise (likely long) → **ASK** with reason: “This will block. Use task with run_in_background:true.”

Notes:
- Before background-capable `task` exists, the hook can only **WARN** (it cannot make built-in `task` non-blocking).
- After background-capable `task` exists, ASK becomes enforceable and actionable.
