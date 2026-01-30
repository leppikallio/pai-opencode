# Security Validation (OpenCode Plugin)

In the OpenCode port, security validation is implemented as a **plugin**, not a Claude Code hook script.

## Where It Runs

- Plugin entrypoint: `.opencode/plugins/pai-unified.ts`
- Validator implementation: `.opencode/plugins/handlers/security-validator.ts`
- Pattern registry (dangerous + warning patterns): `.opencode/plugins/adapters/types.ts`

## What It Does

- Validates tool executions (especially `bash`, plus some file operations)
- Blocks obviously dangerous commands (e.g. destructive `rm -rf`, reverse shells)
- Prompts for confirmation on risky commands (e.g. force pushes)
- Blocks basic prompt-injection patterns found in tool `content`

## OpenCode Integration Points

- `tool.execute.before`: plugin can **throw** to block execution
- `permission.ask`: plugin can set `output.status = "deny" | "ask"` when OpenCode prompts

## How To Update Patterns

1. Edit patterns in `.opencode/plugins/adapters/types.ts` (`DANGEROUS_PATTERNS`, `WARNING_PATTERNS`).
2. Reinstall to runtime: `bun Tools/Install.ts --target "$PAI_DIR"`
