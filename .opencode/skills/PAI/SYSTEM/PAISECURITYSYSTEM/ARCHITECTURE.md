# PAI Security Architecture

**Current architecture for the OpenCode security middleware stack.**

---

## Status and Scope

- `.opencode/pai-unified.ts` is **deprecated**.
- It is source-only reference material, not the target runtime security architecture.
- Canonical security logic now lives in `.opencode/plugins/security/`.

---

## Canonical Engine and Thin Adapters

### Canonical engine

Security policy logic is centralized under:

- `.opencode/plugins/security/index.ts`
- `.opencode/plugins/security/policy-loader.ts`
- `.opencode/plugins/security/bash-policy.ts`
- `.opencode/plugins/security/path-policy.ts`
- `.opencode/plugins/security/content-policy.ts`
- `.opencode/plugins/security/redaction.ts`
- `.opencode/plugins/security/audit-log.ts`
- `.opencode/plugins/security/decision.ts`
- `.opencode/plugins/security/adapter-decision.ts`

### Compatibility facade

- `.opencode/plugins/handlers/security-validator.ts` is a thin facade that re-exports canonical validator APIs.

### Hook/plugin bridge paths

- `.opencode/hooks/SecurityValidator.hook.ts` (hook adapter script)
- `.opencode/plugins/pai-cc-hooks/tool-before.ts` (tool.execute.before integration)
- `.opencode/plugins/pai-cc-hooks/security-adapter.ts` (SecurityResult → permission mapping)
- `.opencode/plugins/pai-cc-hooks/claude/pre-tool-use.ts` (PreToolUse command chain + fail-safe parse handling)

### research-shell shared adapter

- `.opencode/mcp/research-shell/security-adapter.ts`
- Reuses shared path matching, redaction, and audit logging from `.opencode/plugins/security/`.

---

## Security Decision Model

The canonical engine returns:

- `allow` → proceed
- `confirm` → ask/confirm gate
- `block` → deny

Adapters map these decisions into surface-specific permission semantics:

- hook/plugin path maps `confirm` → `ask`, `block` → `deny`
- hook parse-failure for security-critical hook output fails safe to `ask`

---

## Policy Loading and Overrides

Pattern/rule sources:

1. USER override: `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. SYSTEM fallback: `.opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml`

Project-scoped rules are resolved by runtime cwd through `project-rules.ts`.

---

## Logging and Audit Trail

Security events are written to:

- `MEMORY/SECURITY/YYYY-MM/security.jsonl`

Shared writer:

- `.opencode/plugins/security/audit-log.ts`

This writer is used by both:

- canonical validator path (tool security)
- `.opencode/mcp/research-shell/security-adapter.ts` (session_dir policy events)

---

## Composition Rule

Use TypeScript module composition for internal security logic.

- **Rule:** no internal CLI composition inside canonical security modules (`.opencode/plugins/security/`) or research-shell shared security adapter (`.opencode/mcp/research-shell/security-adapter.ts`).
- **Allowed boundary exception:** executing configured external hook commands in `.opencode/plugins/pai-cc-hooks/claude/pre-tool-use.ts`.

---

## Known Follow-ups

1. research-shell query regex/length validation still lives in `.opencode/mcp/research-shell/index.ts` (not centralized in shared security policy config).
2. `sourceCallId` is optional in research-shell security audit events and is not always wired from MCP request metadata.
3. `policy-loader.ts` still uses custom YAML parsing logic; stricter schema validation hardening is future work.

---

## Runtime Mapping Note

Paths in this document use source-controlled repository locations (`.opencode/...`).
After install (`bun Tools/Install.ts --target "~/.config/opencode"`), they map into the runtime root under `~/.config/opencode/...`.
