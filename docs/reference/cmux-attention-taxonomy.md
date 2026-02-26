# cmux Attention Taxonomy

This document defines the attention event model used by PAI hooks and the deterministic routing chain used to publish events to cmux.

## Feature flags (rollout safety)

- `PAI_CMUX_ATTENTION_ENABLED` (default `1`)
  - `0` disables all attention emissions (notifications, status mirror, progress mirror, flash nudges).
- `PAI_CMUX_PROGRESS_ENABLED` (default `1`)
  - `0` keeps notifications and status mirror enabled, but disables progress mirror updates only.
- `PAI_CMUX_FLASH_ON_P0` (default `1`)
  - `0` disables flash nudges for `P0` events only.

## Event taxonomy

| Event key | Priority | Typical source | Mirror token | Flash nudge |
| --- | --- | --- | --- | --- |
| `QUESTION_PENDING` | `P0` | `SetQuestionTab.hook.ts` | `QUESTION` | Yes (unless disabled) |
| `PERMISSION_PENDING` | `P0` | Tool/permission guard hooks | `QUESTION` | Yes (unless disabled) |
| `AGENT_BLOCKED` | `P0` | Background/agent orchestration hooks | `WORK` | Yes (unless disabled) |
| `AGENT_FAILED` | `P1` | Background/agent orchestration hooks | `WORK` | No |
| `AGENT_COMPLETED` | `P2` | Background completion hook | `DONE` | No |
| `QUESTION_RESOLVED` | `P2` | `QuestionAnswered.hook.ts` | `DONE` | No |

## Deterministic routing chain

For interrupt/ambient emissions, routing order is fixed:

1. `notification.create_for_target`
2. fallback `notification.create_for_surface`
3. fallback `notification.create`

If routing falls back to surface/global/none, the legacy mirror path updates glanceable state:

- `set_status oc_attention <token>` (interrupt path)
- `set_status oc_phase <token>`
- `set_progress <value> <token>` (only when `PAI_CMUX_PROGRESS_ENABLED=1`)

For `P0` events, flash nudge path is:

- `surface.trigger_flash` for the resolved surface target
- skipped when `PAI_CMUX_FLASH_ON_P0=0`

## Operational triage playbook

When attention behavior looks wrong, check in this order:

1. **Feature flags**: verify `PAI_CMUX_ATTENTION_ENABLED`, `PAI_CMUX_PROGRESS_ENABLED`, `PAI_CMUX_FLASH_ON_P0` values.
2. **Targeting context**: verify `CMUX_SOCKET_PATH`, `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` and session mapping freshness.
3. **Dedupe state**: inspect `MEMORY/STATE/cmux-attention-dedupe.json` for suppression windows.
4. **Routing fallback**: confirm target -> surface -> create path and legacy mirror commands are emitted.
5. **Best-effort contract**: hooks should still exit successfully (`0`) even if cmux is unavailable.
