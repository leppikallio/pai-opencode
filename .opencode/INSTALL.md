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

## Installation

### Method 1: Fresh Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/Steffen025/pai-opencode.git
cd pai-opencode

# Install dependencies
bun install

# Start OpenCode
opencode
```

That's it! PAI 2.4 is now running on OpenCode.

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

Edit `.opencode/settings.json` to customize:
- Your name
- AI preferences
- Permissions

## What's Included

| Component | Count | Description |
|-----------|-------|-------------|
| Skills | 20 | Same as PAI 2.4 |
| Agents | 13 | Named AI personalities |
| Plugin | 1 | Unified (security + context) |
| Converter | 1 | For migrating PAI updates |

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
- **GitHub**: [github.com/Steffen025/pai-opencode](https://github.com/Steffen025/pai-opencode)

---

Welcome to PAI-OpenCode!
