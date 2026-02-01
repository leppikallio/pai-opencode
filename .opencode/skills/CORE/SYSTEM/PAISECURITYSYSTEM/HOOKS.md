# Security Validation (OpenCode Plugin)

In the OpenCode port, security validation is implemented as a **plugin**, not a Claude Code hook script.

## Where It Runs

- Plugin entrypoint: `~/.config/opencode/plugins/pai-unified.ts`
- Validator implementation: `~/.config/opencode/plugins/handlers/security-validator.ts`
- Pattern registry (YAML): `PAISECURITYSYSTEM/patterns.example.yaml` (USER override → SYSTEM fallback)

## What It Does

- Validates tool executions (especially `bash`, plus some file operations)
- Blocks obviously dangerous commands (e.g. destructive `rm -rf`, reverse shells)
- Prompts for confirmation on risky commands (e.g. force pushes)
- Blocks basic prompt-injection patterns found in tool `content`

## OpenCode Integration Points

- `tool.execute.before`: plugin can **throw** to block execution
- `permission.ask`: plugin can set `output.status = "deny" | "ask"` when OpenCode prompts

## How To Update Patterns

1. Copy `patterns.example.yaml` to `~/.config/opencode/skills/CORE/USER/PAISECURITYSYSTEM/patterns.yaml`.
2. Edit patterns (v2.4 schema: bash/paths).
3. Reinstall to runtime: `bun Tools/Install.ts --target "~/.config/opencode"`

Notes:
- `~/.config/opencode/PAISECURITYSYSTEM/` is a symlink to `~/.config/opencode/skills/CORE/SYSTEM/PAISECURITYSYSTEM/`.
- Security decisions are logged to `MEMORY/SECURITY/YYYY-MM/security.jsonl`.
