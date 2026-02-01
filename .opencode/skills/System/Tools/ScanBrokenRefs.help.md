# ScanBrokenRefs

Scan markdown files for local file references that do not exist.

## Usage

```bash
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --help

# Default: scan ~/.config/opencode/skills
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts

# Scan a narrower scope
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts \
  --scope ~/.config/opencode/skills/System

# JSON output
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --format json
```

## What It Checks

- Inline-code references and markdown link targets that look like file paths
- Resolves common PAI prefixes: `skills/`, `plugins/`, `docs/`, `config/`, `pai-tools/`, `PAISECURITYSYSTEM/`

## What It Ignores (By Design)

- Shell commands in backticks (contain whitespace)
- Placeholders like `YYYY-MM-DD`, `<slug>`, `${var}`, globs
- Optional customization paths under `skills/CORE/USER/SKILLCUSTOMIZATIONS/`
