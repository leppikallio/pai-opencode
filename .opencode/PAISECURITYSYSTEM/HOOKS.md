# Security Hooks (OpenCode)

This document describes where the PAI security enforcement lives in this repo.

## Canonical Enforcement Points

- **Primary block point:** `$PAI_DIR/plugins/pai-unified.ts` via `tool.execute.before`
- **Validator implementation:** `$PAI_DIR/plugins/handlers/security-validator.ts`
- **Pattern definitions:** `$PAI_DIR/plugins/adapters/types.ts`

## Notes

- Pattern matching is currently code-defined (TypeScript arrays), not YAML-driven.
- `permission.asked` / `permission.replied` are OpenCode *events*; enforcement happens in `tool.execute.before`.
