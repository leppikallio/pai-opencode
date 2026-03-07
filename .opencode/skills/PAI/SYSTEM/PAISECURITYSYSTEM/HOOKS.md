# Security Hooks and PreToolUse Bridge

This document describes the current hook-side integration for security decisions.

## Canonical vs Adapter Boundaries

- Canonical policy engine: `plugins/security/`
- Thin facade: `plugins/handlers/security-validator.ts`
- Hook script adapter: `~/.config/opencode/hooks/SecurityValidator.hook.ts`

`SecurityValidator.hook.ts` imports the facade and returns hook-compatible allow/ask/deny output.

## PreToolUse Integration Path

Security checks in the plugin/hook bridge flow through:

1. `plugins/pai-cc-hooks/tool-before.ts`
2. `plugins/pai-cc-hooks/claude/pre-tool-use.ts`
3. configured PreToolUse commands (including `SecurityValidator.hook.ts`)

When security returns `confirm`, the bridge converts that into ask-gate flow.

## Decision Mapping

`plugins/pai-cc-hooks/security-adapter.ts` maps canonical results:

- `allow` → `allow`
- `confirm` → `ask`
- `block` → `deny`

## Fail-safe Behavior

For security-critical PreToolUse commands (matching `securityvalidator.hook`):

- exit code `0` + empty stdout => fail-safe `ask`
- exit code `0` + non-JSON stdout => fail-safe `ask`

This behavior is implemented in `plugins/pai-cc-hooks/claude/pre-tool-use.ts`.

## Composition Rule

- Canonical security logic stays in TypeScript modules under `plugins/security/`.
- There is **no internal CLI composition** inside the canonical engine.
- Runtime command spawning is limited to configured hook-command boundaries in PreToolUse.

## Related Paths

- `plugins/pai-cc-hooks/hook.ts` (composition root)
- `plugins/pai-cc-hooks/ask-gate.ts` (confirm gate state)
- `~/.config/opencode/mcp/research-shell/security-adapter.ts` (shared security adapter for MCP surface)
