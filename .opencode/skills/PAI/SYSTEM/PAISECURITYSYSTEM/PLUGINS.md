# Security Plugin Architecture (OpenCode)

Current source-of-truth plugin architecture for security middleware parity work.

---

## Canonical Security Engine

Security policy logic is centralized in:

- `.opencode/plugins/security/index.ts`
- `.opencode/plugins/security/policy-loader.ts`
- `.opencode/plugins/security/bash-policy.ts`
- `.opencode/plugins/security/path-policy.ts`
- `.opencode/plugins/security/content-policy.ts`
- `.opencode/plugins/security/redaction.ts`
- `.opencode/plugins/security/audit-log.ts`
- `.opencode/plugins/security/decision.ts`

Compatibility facade:

- `.opencode/plugins/handlers/security-validator.ts`

---

## Plugin Integration Points

- Plugin entry: `.opencode/plugins/pai-cc-hooks.ts`
- Composition root: `.opencode/plugins/pai-cc-hooks/hook.ts`
- Security gate hook point: `.opencode/plugins/pai-cc-hooks/tool-before.ts`
- Hook command runner: `.opencode/plugins/pai-cc-hooks/claude/pre-tool-use.ts`
- Security result mapper: `.opencode/plugins/pai-cc-hooks/security-adapter.ts`
- Hook script: `.opencode/hooks/SecurityValidator.hook.ts`

Behavior summary:

- Canonical engine computes allow/confirm/block.
- bridge maps allow/confirm/block to allow/ask/deny for PreToolUse.
- ask decisions are gated through confirm-id flow in ask-gate.

---

## research-shell Security Reuse

Shared adapter path:

- `.opencode/mcp/research-shell/security-adapter.ts`

It reuses canonical modules for:

- path allowlist matching
- security audit event writing
- preview redaction

Provider auth/HTTP/response formatting stays local in `.opencode/mcp/research-shell/index.ts`.

---

## Deprecated Source

- `.opencode/pai-unified.ts` is deprecated and not target-state runtime architecture.
- It is not a dependency of the canonical security path.

---

## Composition Constraints

- Internal security composition must use TypeScript imports/exports.
- no internal CLI composition inside canonical engine and shared MCP adapter.
- process spawning is allowed only for real runtime boundaries (configured external hook commands).

---

## Logging

Security events are written to:

- `MEMORY/SECURITY/YYYY-MM/security.jsonl`

Writer:

- `.opencode/plugins/security/audit-log.ts`

---

## Known follow-ups

1. research-shell query validation (`MAX_QUERY_LENGTH`, allowlist regex) remains local to `.opencode/mcp/research-shell/index.ts`.
2. MCP `sourceCallId` is not always propagated into security audit event fields.
3. `policy-loader.ts` custom parser remains a future hardening target for stricter schema validation.
