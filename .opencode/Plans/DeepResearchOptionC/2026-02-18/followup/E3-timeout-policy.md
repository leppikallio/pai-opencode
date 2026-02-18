# E3 Timeout Policy — Progress heartbeat semantics

Status: ACCEPTED

## Chosen design

Use **progress heartbeat timeouts**.

- Watchdog timeout origin is `max(stage.started_at, stage.last_progress_at)`.
- Stage timeout limits remain `STAGE_TIMEOUT_SECONDS_V1`.
- Long-running stages stay alive if orchestrators emit progress heartbeats.

## Why this design

Mode-based timeout multipliers alone do not detect stalled runs.
Heartbeat semantics keep deterministic timeout budgets while preventing false failures during active long stages.

## Authoritative fields

- `manifest.stage.started_at` — stage start anchor.
- `manifest.stage.last_progress_at` — latest heartbeat for current stage.
- `STAGE_TIMEOUT_SECONDS_V1[stage]` — inactivity budget in seconds.

`stage.last_progress_at` is optional for backward compatibility.
If absent, watchdog falls back to `stage.started_at`.

## Determinism guarantees

- Heartbeats are written via `manifest_write` with optimistic locking.
- Heartbeat timestamps do not enter gate metric digests.
- Timeout decisions are deterministic given `{stage timeout, started_at, last_progress_at, now_iso}`.
- Progress updates are emitted at fixed orchestration milestones.
