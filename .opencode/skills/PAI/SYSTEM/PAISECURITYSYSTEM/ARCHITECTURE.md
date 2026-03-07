# PAI Security Architecture

**Current architecture for the OpenCode security middleware stack.**

---

## Status and Scope

- `pai-unified.ts` is **deprecated**.
- It is source-only reference material, not the target runtime security architecture.
- Canonical security logic now lives in `plugins/security/`.

---

## Canonical Engine and Thin Adapters

### Canonical engine

Security policy logic is centralized under:

- `plugins/security/index.ts`
- `plugins/security/policy-loader.ts`
- `plugins/security/bash-policy.ts`
- `plugins/security/path-policy.ts`
- `plugins/security/content-policy.ts`
- `plugins/security/redaction.ts`
- `plugins/security/audit-log.ts`
- `plugins/security/decision.ts`
- `plugins/security/adapter-decision.ts`

### Compatibility facade

- `plugins/handlers/security-validator.ts` is a thin facade that re-exports canonical validator APIs.

### Hook/plugin bridge paths

- `~/.config/opencode/hooks/SecurityValidator.hook.ts` (hook adapter script)
- `plugins/pai-cc-hooks/tool-before.ts` (tool.execute.before integration)
- `plugins/pai-cc-hooks/security-adapter.ts` (SecurityResult → permission mapping)
- `plugins/pai-cc-hooks/claude/pre-tool-use.ts` (PreToolUse command chain + fail-safe parse handling)

### research-shell shared adapter

- `~/.config/opencode/mcp/research-shell/security-adapter.ts`
- Reuses shared path matching, redaction, and audit logging from `plugins/security/`.

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
2. SYSTEM fallback: `skills/PAI/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml`

Project-scoped rules are resolved by runtime cwd through `project-rules.ts`.

---

## Logging and Audit Trail

Security events are written to:

- `MEMORY/SECURITY/YYYY-MM/security.jsonl`

Shared writer:

- `plugins/security/audit-log.ts`

This writer is used by both:

- canonical validator path (tool security)
- `~/.config/opencode/mcp/research-shell/security-adapter.ts` (session_dir policy events)

---

## Composition Rule

Use TypeScript module composition for internal security logic.

- **Rule:** no internal CLI composition inside canonical security modules (`plugins/security/`) or the research-shell shared security adapter (`~/.config/opencode/mcp/research-shell/security-adapter.ts`).
- **Allowed boundary exception:** executing configured external hook commands in `plugins/pai-cc-hooks/claude/pre-tool-use.ts`.

---

## Known Follow-ups

1. research-shell query regex/length validation still lives in `~/.config/opencode/mcp/research-shell/index.ts` (not centralized in shared security policy config).
2. `sourceCallId` is optional in research-shell security audit events and is not always wired from MCP request metadata.
3. `plugins/security/policy-loader.ts` still uses custom YAML parsing logic; stricter schema validation hardening is future work.

---

## Runtime Mapping Note

Paths in this document are written for the installed runtime under `~/.config/opencode`.
When editing source-controlled files in the repo, map them back to `~/Projects/pai-opencode/.opencode/...`.
