# cmux Capability Map (for OpenCode PAI Terminal UX)

**Purpose:** A reusable capability map of `cmux` to support a Kitty → cmux transition for OpenCode PAI terminal UX (attention, question-pending, progress, status, notifications).

**Source (local):** `/Users/zuul/Projects/cmux`

## What cmux is optimized for

cmux is a Ghostty-based macOS terminal with **first-class agent notifications**:
- “Notification rings” (blue ring + tab highlight) when agents need attention.
- Notification panel with unread tracking.
- Sidebar shows: git branch, working directory, listening ports, latest notification text.

Evidence: `/Users/zuul/Projects/cmux/README.md:22-61,93-104`

## Interfaces we can use from PAI/OpenCode

### 1) CLI (good fallback)

cmux provides a CLI intended to be wired into agent hooks.

Key detection pattern:

```bash
command -v cmux &>/dev/null && cmux notify --title "Done" --body "Task complete"
```

Evidence + examples: `/Users/zuul/Projects/cmux/docs/notifications.md:7-27,42-53`

### 2) Socket API (recommended for adapters)

cmux supports a socket control API. The repo includes tests using a Python client (`tests_v2/cmux.py`) and docs discussing the v2 API migration.

Practical note: for a PAI-owned TypeScript adapter (status/progress/sidebar), prefer the **socket API** for lower latency and fewer process spawns; keep CLI as a fallback.

## Environment variables (targeting)

cmux sets env vars in child shells:
- `CMUX_SOCKET_PATH`
- `CMUX_TAB_ID`
- `CMUX_PANEL_ID`

Evidence: `/Users/zuul/Projects/cmux/docs/notifications.md:133-142`

## Capability catalog (relevant commands)

### Notifications (attention / question / permission)

```bash
cmux notify --title "OpenCode" --subtitle "Permission" --body "Approval needed"
cmux notify --title "Done" --tab 0 --panel 1
cmux list-notifications
cmux clear-notifications
cmux ping
```

Evidence: `/Users/zuul/Projects/cmux/docs/notifications.md:42-53,143-150`

### Visual cue / attention flash

```bash
cmux trigger-flash --surface surface:7
cmux trigger-flash --workspace workspace:2
cmux surface-health
```

Evidence: `/Users/zuul/Projects/cmux/skills/cmux/references/trigger-flash-and-health.md:5-21`

### Sidebar + status + progress (agent UX primitives)

cmux has a status/progress/sidebar state model exposed via command handlers. This is the key to “agent needs attention” being visible without relying on Kitty.

Notable operations (v1 command surface):
- set/clear/list status entries (key/value + icon/color)
- set/clear progress
- sidebar_state + reset_sidebar
- focus_notification (debug path)

Evidence (command implementation):
- `/Users/zuul/Projects/cmux/Sources/TerminalController.swift` (status/progress/sidebar handlers)

## Mapping to OpenCode PAI (what we can replace)

The CC v3 hooks that currently assume Kitty + `localhost:8888` can be re-expressed in cmux as:

### A) “Agent needs attention”
- `cmux notify` (panel + macOS notification)
- `cmux trigger-flash` (visual confirm)
- optional status pill: `set-status opencode_pai "attention"`

### B) “Question pending”
- `cmux notify --subtitle "Question" --body "<short header>"`
- optional status pill: `set-status opencode_pai "question"`

### C) “Working/progress”
- `set-progress 0..1 --label "BUILD"` (or similar)
- status key to show current phase

## Attention taxonomy + routing chain (current contract)

The canonical event model now lives in:

- `docs/reference/cmux-attention-taxonomy.md`

Routing order for attention events is deterministic:

1. `notification.create_for_target`
2. fallback `notification.create_for_surface`
3. fallback `notification.create`

Fallback mirror behavior keeps attention glanceable in status/progress:

- status mirror (`oc_attention`, `oc_phase`) remains enabled by default
- progress mirror follows `PAI_CMUX_PROGRESS_ENABLED`
- `P0` flash nudges follow `PAI_CMUX_FLASH_ON_P0`

Rollout defaults (non-breaking):

- `PAI_CMUX_ATTENTION_ENABLED=1`
- `PAI_CMUX_PROGRESS_ENABLED=1`
- `PAI_CMUX_FLASH_ON_P0=1`

## Safety requirements (for our hook integration)

Non-negotiables:
- If cmux CLI missing or unreachable → **no-op** (never block hooks).
- Notifications must be rate-limited/debounced (avoid spam).
- Terminal UX features are **modular**: one shared adapter, not duplicated per hook.

cmux docs explicitly recommend availability checks + fallbacks:
- `/Users/zuul/Projects/cmux/docs/notifications.md:15-27,152-156`

## Residual open questions (non-blocking)

- How to handle stale mappings (surface closed / workspace moved):
  - If `notification.create_for_surface(surface_id)` fails → fall back to untargeted `notification.create` and wait for the next env-var upsert.

## Current decisions (captured)

- **MVP scope:** Full UX primitives
  - notifications + status + progress + sidebar-state semantics (with safe no-op behavior if cmux absent)
- **Voice:** keep both always
  - requires strong gating/debouncing to avoid spam

- **Adapter transport:** socket-first (v2 JSON)
  - Implement a small TS Unix-socket client using `CMUX_SOCKET_PATH` and the v2 JSON line protocol.
  - Keep CLI as a fallback for minimal notifications or debugging.
- **Targeting:** env-var driven
  - If `CMUX_SOCKET_PATH` is missing → no-op (never block hooks).
  - If present, prefer `CMUX_WORKSPACE_ID` + `CMUX_SURFACE_ID` to target the current surface.
  - Maintain a mapping store so background completions can still target the right surface.

- **Session mapping fallback (DECIDED):**
  - Store file (default): `~/.cmuxterm/opencode-hook-sessions.json` (schema mirrors cmux CLI’s `claude-hook-sessions.json`).
  - On any hook run where `CMUX_WORKSPACE_ID`/`CMUX_SURFACE_ID` are present: upsert `{ session_id -> workspace_id, surface_id, cwd, updatedAt }`.
  - When env vars are missing: lookup by `session_id` and target `notification.create_for_surface(surface_id)`.
  - If no mapping exists: fall back to `notification.create` (untargeted), and skip status/progress updates (no-op).
- **Debounce policy (MVP):**
  - Drop duplicate notifications (same title/subtitle/body) within **2s** per session.
  - Throttle progress/status updates to **~4 Hz** (latest-wins).

## Proposed voice integration approach (phased; validate before refactor)

### Phase 1 (low-cost validation): mirror existing voice signals to cmux

Goal: get immediate cmux value **without touching** the many existing voice calls across PAI.

Approach:
- Add an OpenCode hook/plugin handler that detects voice notifications and emits a matching cmux notification.
- Sources to mirror (in priority order):
  1) `voice_notify` tool calls (structured: title/message)
  2) (Optional later) Bash calls that hit `http://localhost:8888/notify` (legacy voice curls)

Why this works:
- It validates that cmux is a good attention channel while keeping the existing voice channel intact.
- It avoids a repo-wide refactor until we have confidence.

Safety requirements:
- Debounce duplicates (same message within a short window).
- No-op if cmux missing/unreachable.
- Gate to main session if needed (avoid subagent spam).

### Phase 2 (optional, expensive): reduce/remove direct voice calls

Only after Phase 1 proves reliable:
- Introduce a single PAI-owned “notify adapter” used by hooks/plugins that sends:
  - cmux notify/status/progress updates
  - voice server notifications
- Then gradually replace scattered `voice_notify` usage (and/or voice curls) with that adapter.

This is intentionally a separate large work item.
