# PAI-OpenCode Installation Guide

Welcome to PAI (Personal AI Infrastructure) on OpenCode.

## Prerequisites

1. **Bun** - JavaScript/TypeScript runtime
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **OpenCode** - AI coding assistant
   ```bash
   # Option A: Via Go (recommended)
   go install github.com/anomalyco/opencode@latest

   # Option B: Build from source
   git clone https://github.com/anomalyco/opencode.git
   cd opencode && go build -o opencode . && sudo mv opencode /usr/local/bin/
   ```

## Installation (Recommended)

PAI-OpenCode is designed to run from OpenCode's **global config directory**:
`~/.config/opencode/`

```bash
# Clone the repository
git clone https://github.com/leppikallio/pai-opencode.git
cd pai-opencode

# Install/upgrade the runtime tree
bun Tools/Install.ts

# Note: Agent models are defined explicitly in `.opencode/agents/*.md`.
# The installer does not rewrite agent models unless you opt in.

# Configure your identity + provider (writes into ~/.config/opencode)
bun ~/.config/opencode/PAIOpenCodeWizard.ts

# Start OpenCode (from any directory)
opencode
```

Why this matters:
- Your private content stays in `~/.config/opencode/` (not in the git repo).
- You can update by pulling the repo and re-running `bun Tools/Install.ts`.
- The installer maintains `~/.config/opencode/AGENTS.md` with a hard safety rule.

## Runtime Safety Rule (Important)

OpenCode loads global rules from `~/.config/opencode/AGENTS.md`.

PAI-OpenCode installs a managed block there that enforces:
- Do not edit `~/.config/opencode/` directly.
- Make shareable changes in this repository under `.opencode/`, then deploy.

### Method 2: Migration from Claude Code PAI

If you have an existing PAI installation on Claude Code:

```bash
# Preview changes (dry run)
bun Tools/pai-to-opencode-converter.ts --source ~/.claude --target .opencode --dry-run

# Review the output, then run for real
bun Tools/pai-to-opencode-converter.ts --source ~/.claude --target .opencode
```

See `docs/CONVERTER.md` for detailed migration guide.

## Verification

Start OpenCode and verify:
- **Skills load**: Ask "What skills do I have?"
- **Agents work**: Try `@intern hello`
- **Security active**: Check `/tmp/pai-opencode-debug.log`

## Configuration

Edit `~/.config/opencode/settings.json` for PAI-specific settings.
Edit `~/.config/opencode/opencode.json` for OpenCode platform settings.

## What's Included

| Component | Count | Description |
|-----------|-------|-------------|
| Skills | 29 | PAI 2.4 skills adapted for OpenCode |
| Agents | 14 | Named AI personalities |
| Plugin | 1 | Unified (security + context) |
| Converter | 1 | For migrating PAI updates |

> **Note:** For detailed installation instructions including the Installation Wizard, see [INSTALL.md](../INSTALL.md) in the repository root.

## What's Different from Claude Code PAI

| PAI 2.4 (Claude Code) | PAI-OpenCode |
|-----------------------|--------------|
| `hooks/` | `plugins/` |
| `.claude/` | `.opencode/` |
| Claude Code CLI | OpenCode CLI |
| Exit code blocking | Throw Error blocking |

See `docs/HOOK-TO-PLUGIN-TRANSLATION.md` for technical details.

## Troubleshooting

### "opencode: command not found"
```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

### Plugin doesn't load
```bash
cat /tmp/pai-opencode-debug.log
# Should show: "PAI-OpenCode Plugin Loaded"
```

### TUI corruption
```bash
reset && opencode
```

## Getting Help

- **Documentation**: `skills/CORE/SKILL.md`
- **GitHub**: [github.com/leppikallio/pai-opencode](https://github.com/leppikallio/pai-opencode)

---

Welcome to PAI-OpenCode!
