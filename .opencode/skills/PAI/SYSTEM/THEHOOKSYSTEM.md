# Hook System (Legacy)

This document is preserved for historical compatibility with PAI v2.4 (Claude Code), which used **hooks**.

In the OpenCode port, hooks are implemented as **plugins**.

**Authority:** Legacy compatibility note only. Do not treat this file as primary implementation guidance.

For operational behavior, always use `THEPLUGINSYSTEM.md`.

## OpenCode Source Of Truth

- Plugin system overview: `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`
- Hook-to-plugin mapping: `~/.config/opencode/PAISYSTEM/PAI-TO-OPENCODE-MAPPING.md`

## Hooks Still Used In OpenCode

Even though OpenCode primarily implements behavior as plugins, a small set of Bun-runnable hook scripts is still used for deterministic runtime wiring.

Common hook entrypoints:
- `~/.config/opencode/hooks/PRDSync.hook.ts` - Sync PRD edits into `~/.config/opencode/MEMORY/STATE/work.json`
- `~/.config/opencode/hooks/SessionAutoName.hook.ts` - Persist `~/.config/opencode/MEMORY/STATE/session-names.json` and seed `work.json`
- `~/.config/opencode/hooks/LoadContext.hook.ts` - Load configured context files (optionally appends learning digest)
- `~/.config/opencode/hooks/WorkJsonBackfill.ts` - Backfill `work.json` from existing PRDs (best-effort)

Notes:
- `~/.config/opencode/MEMORY/STATE/current-work.json` is the canonical session pointer; `~/.config/opencode/MEMORY/STATE/work.json` is a derived dashboard registry.
- PRDSync is read-only with respect to PRDs: it reads PRDs and writes projections.

## Directory Convention (OpenCode)

- Runtime plugins directory: `~/.config/opencode/plugins/`

## Why This File Still Exists

Some older docs and references still point at this file. This stub prevents broken references while keeping the OpenCode implementation authoritative in `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md`.
