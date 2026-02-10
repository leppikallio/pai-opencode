# Hook System (Legacy)

This document is preserved for historical compatibility with PAI v2.4 (Claude Code), which used **hooks**.

In the OpenCode port, hooks are implemented as **plugins**.

**Authority:** Legacy compatibility note only. Do not treat this file as primary implementation guidance.

For operational behavior, always use `THEPLUGINSYSTEM.md`.

## OpenCode Source Of Truth

- Plugin system overview: `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`
- Hook-to-plugin mapping: `~/.config/opencode/PAISYSTEM/PAI-TO-OPENCODE-MAPPING.md`

## Directory Convention (OpenCode)

- Runtime plugins directory: `~/.config/opencode/plugins/`

## Why This File Still Exists

Some older docs and references still point at this file. This stub prevents broken references while keeping the OpenCode implementation authoritative in `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`.
