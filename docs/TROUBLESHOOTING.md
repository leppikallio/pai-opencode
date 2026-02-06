# Troubleshooting

This document focuses on failure modes that can make OpenCode appear stuck, and how to diagnose them using PAI-OpenCode's plugin debug log.

## Where to look first

- Debug log: `~/.config/opencode/plugins/debug.log`
- Tail it live:

```bash
tail -f ~/.config/opencode/plugins/debug.log
```

## Symptom: Agent appears frozen during a tool call

OpenCode tool calls are a handshake: the model emits a tool call, OpenCode executes it, and only then the model continues.
So if a tool call (or a pre-hook) never returns, the session will look stalled.

### Case A: Last log line is `Tool before: <tool>` and then nothing

This usually means the unified plugin is blocked inside `tool.execute.before`.

Common root cause: **history capture serialization queue is stuck**.

Fast mitigations:

```bash
# Disable per-session serialization
PAI_SERIALIZE_EVENTS=0 opencode
```

Optional (more visibility):

```bash
# Enable debug logging and fail-open toasts (if the client supports TUI toasts)
PAI_DEBUG=1 PAI_HISTORY_CAPTURE_TOASTS=1 opencode
```

If fail-open is working, you should see warnings in the debug log such as:

- `HistoryCapture fail-open: timeout label=...`
- `HistoryCapture serial queue wait timed out ...`

Timeout knobs:

- `PAI_SERIAL_WAIT_TIMEOUT_MS` (default `2000`)
- `PAI_SERIAL_FN_TIMEOUT_MS` (default `8000`)
- `PAI_HISTORY_CAPTURE_TOOL_TIMEOUT_MS` (default `350`)
- `PAI_HISTORY_CAPTURE_EVENT_TIMEOUT_MS` (default `1200`)

### Case B: You see `Security check passed for <tool>` but no `Tool after: <tool>`

This usually means the tool implementation itself is stuck (not the plugin pre-hook).

Examples:

- Network calls without a hard wall-clock timeout
- External processes that never exit
- Waiting for interactive input

Note: this can happen even for tools like `voice_notify` if the implementation awaits a request that never resolves.

For tool-specific debugging, try reproducing the underlying action outside of OpenCode (e.g. the equivalent command in a terminal).

## Notes on toasts

PAI-OpenCode can show warning toasts on fail-open capture events.

- Enable explicitly: `PAI_HISTORY_CAPTURE_TOASTS=1`
- Or enable via debug: `PAI_DEBUG=1`

Toast support is best-effort and depends on the active OpenCode client exposing `tui.showToast`.
