# ScanBrokenRefs

Scan markdown files for local file references that do not exist.

Safety: this tool refuses to run unless invoked from the System IntegrityCheck
workflow (`PAI_INTEGRITYCHECK=1`) or you pass `--allow-standalone`.

## Usage

```bash
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --help

# Default: scan ~/.config/opencode/skills
PAI_INTEGRITYCHECK=1 bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts

# Scan a narrower scope
PAI_INTEGRITYCHECK=1 bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts \
  --scope ~/.config/opencode/skills/System

# JSON output
PAI_INTEGRITYCHECK=1 bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --format json

# Standalone run (explicit)
bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --allow-standalone
```

## What It Checks

- Inline-code references and markdown link targets that look like file paths
- Resolves common PAI prefixes: `skills/`, `plugins/`, `docs/`, `config/`, `pai-tools/`, `PAISECURITYSYSTEM/`

## What It Ignores (By Design)

- Shell commands in backticks (contain whitespace)
- Placeholders like `YYYY-MM-DD`, `<slug>`, `${var}`, globs
- Optional customization paths under `skills/PAI/USER/SKILLCUSTOMIZATIONS/`
