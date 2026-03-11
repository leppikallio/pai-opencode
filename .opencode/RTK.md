RTK may rewrite shell commands transparently (for example `git status` -> `rtk git status`).

This runtime document is the semantic RTK source of truth for OpenCode. The SessionStart awareness hook is only a capability/status reminder.

The `rtk` prefix is expected and normal whenever rewrite is active.

RTK-proxied output is authoritative by default.

Shorter optimized output is normal and should not be treated as missing or incomplete output.

Do not rerun raw commands outside RTK by default just to get longer output.

## Meta Commands (always use rtk directly)

```bash
rtk gain
rtk gain --history
rtk discover
rtk proxy <cmd>
```

## Raw-output/tee recovery

Raw-output/tee recovery is an exception path.

If RTK emits a `[full output: ~/.local/share/rtk/tee/... ]` hint, recover from that path with OpenCode `Read` or with `rtk proxy`, instead of rerunning the original command outside RTK.

Example recovery commands:

- `Read ~/.local/share/rtk/tee/<file>`
- `rtk proxy cat ~/.local/share/rtk/tee/<file>`
