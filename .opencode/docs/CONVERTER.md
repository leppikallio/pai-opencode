# Converter (Claude Code PAI -> OpenCode)

This repo includes a migration tool for converting a Claude Code PAI tree into an OpenCode-compatible runtime tree.

## Quick Start

From the repository root:

```bash
# Preview changes
bun Tools/pai-to-opencode-converter.ts --source ~/.claude --target .opencode --dry-run

# Apply
bun Tools/pai-to-opencode-converter.ts --source ~/.claude --target .opencode
```

## Notes

- The canonical runtime install location is `~/.config/opencode/`.
- After conversion, deploy with `bun Tools/Install.ts --target ~/.config/opencode`.
- For how Claude Code hooks map to OpenCode plugins, see `docs/HOOK-TO-PLUGIN-TRANSLATION.md`.
