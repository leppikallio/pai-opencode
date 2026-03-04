# OpenCode Binding Overlay

OPEN-CODE CONSTITUTION: Keep enforcement-gate contract; v3.5.0 adapts to it.
OPEN-CODE POLICY BRIDGE: todowrite is canonical ISC.json source.

## Runtime roots (OpenCode)

- Runtime root: `~/.config/opencode`
- PRD format spec: `~/.config/opencode/PAISYSTEM/PRDFORMAT.md`
- Current work registry: `~/.config/opencode/MEMORY/STATE/current-work.json`

## Tool bindings (OpenCode)

- Voice: use the `voice_notify` tool (main session only; background agents never call voice).
- Questions: use the `question` tool (hook-normalized name: AskUserQuestion).
- Subagents: use the `task` tool; default `run_in_background: true` unless FAST.
