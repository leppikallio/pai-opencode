# Hook System (Legacy)

This document is preserved for historical compatibility with PAI v2.4 (Claude Code), which used **hooks**.

In the OpenCode port, hooks are implemented as **plugins**.

## OpenCode Source Of Truth

- Plugin system overview: `SYSTEM/THEPLUGINSYSTEM.md`
- Hook-to-plugin mapping: `PAISYSTEM/PAI-TO-OPENCODE-MAPPING.md`

Note:
- Runtime path: `~/.config/opencode/PAISYSTEM/PAI-TO-OPENCODE-MAPPING.md`
- Repo path: `.opencode/PAISYSTEM/PAI-TO-OPENCODE-MAPPING.md`

## Directory Convention (OpenCode)

- Runtime plugins directory: `~/.config/opencode/plugins/`
- Repo plugins directory: `.opencode/plugins/`

## Why This File Still Exists

Some older docs and references still point at `SYSTEM/THEHOOKSYSTEM.md`. This stub prevents broken references while keeping the OpenCode implementation authoritative in `SYSTEM/THEPLUGINSYSTEM.md`.
