# Security Operations Runbook

Operational guide for changing security rules and validating runtime behavior after Tasks 4–8.

## 1) Canonical implementation paths (this branch)

- Canonical engine: `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/index.ts`
- Security modules:
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/policy-loader.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/bash-policy.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/path-policy.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/content-policy.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/redaction.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/audit-log.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/decision.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/adapter-decision.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/tool-normalization.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/security/project-rules.ts`
- Compatibility facade:
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/handlers/security-validator.ts`
- Hook/plugin adapters:
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/hooks/SecurityValidator.hook.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/pai-cc-hooks/security-adapter.ts`
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/plugins/pai-cc-hooks/tool-before.ts`
- MCP shared adapter:
  - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/mcp/research-shell/security-adapter.ts`

> Deprecated and non-target: `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/pai-unified.ts`

## 2) Policy files and precedence (runtime)

The policy loader resolves these runtime paths in order:

1. `/Users/zuul/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. `/Users/zuul/.config/opencode/USER/PAISECURITYSYSTEM/patterns.yaml`
3. `/Users/zuul/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml` (fallback default)

System template source in this repo:

- `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml`

## 3) Rule-change workflow

1. Change policy intent (USER override for hotfix, SYSTEM template for baseline defaults).
2. Add/adjust tests first (see section 4).
3. Run security test suite.
4. Deploy to runtime.
5. Restart OpenCode if code changed; otherwise verify by log evidence.

## 4) Exact test commands (Task 1–8 coverage)

Run from any directory:

```bash
bun test \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_current_behavior_baseline.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_bash_bypass_regressions.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_policy_loading.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_project_rules.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_module_contract.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_pai_unified_extraction.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_hook_modularity_contract.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_adapter_contract.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/research_shell_security_adapter.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/pai_security_validator_apply_patch_move_to.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/pai_cc_hooks_ask_gate.test.ts" \
  "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/pai_cc_hooks_tool_execute_before_args.test.ts"
```

Fast single-suite check (MCP adapter only):

```bash
bun test "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/research_shell_security_adapter.test.ts"
```

## 5) Deploy to runtime

> Warning: `bun Tools/Install.ts --target "/Users/zuul/.config/opencode"` writes into the live runtime under `~/.config/opencode`.
> This can replace SYSTEM hooks, docs, and plugin code for future sessions, and it may disrupt active OpenCode/MCP sessions until they restart.

Pre-deploy safety checklist:

1. Confirm you are in the intended worktree/branch.
2. Confirm the relevant test suite from section 4 is green.
3. Expect to restart OpenCode and MCP subprocesses after deployment.
4. Start a fresh session after deployment if behavior appears stale.

```bash
cd "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity" && bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

## 6) Restart / reload requirements

- **Required restart:** after changing TypeScript implementation under:
  - `.opencode/plugins/security/`
  - `.opencode/plugins/pai-cc-hooks/`
  - `.opencode/hooks/`
  - `.opencode/mcp/research-shell/`
- **MCP subprocesses:** restart OpenCode so `research-shell` subprocesses respawn with new code/env.
- **Policy-only YAML edits:** policy loader re-checks file mtime/size and reloads automatically; restart is not strictly required, but open a new session if behavior appears stale.

## 7) Inspect security audit logs

Audit location pattern:

- `/Users/zuul/.config/opencode/MEMORY/SECURITY/YYYY-MM/security.jsonl`

Examples:

```bash
eza "/Users/zuul/.config/opencode/MEMORY/SECURITY"
```

```bash
rg '"action":"(block|confirm|allow)"' "/Users/zuul/.config/opencode/MEMORY/SECURITY/$(date +%Y-%m)/security.jsonl"
```

```bash
rg '"sessionId":"ses_' "/Users/zuul/.config/opencode/MEMORY/SECURITY/$(date +%Y-%m)/security.jsonl"
```

```bash
rg '"ruleId":"' "/Users/zuul/.config/opencode/MEMORY/SECURITY/$(date +%Y-%m)/security.jsonl"
```

## 8) Locate `<session_dir>` artifacts in practice

When incident docs reference `<session_dir>`, use one of these deterministic sources:

1. Scratchpad root for current sessions:
   - `/Users/zuul/.config/opencode/scratchpad/sessions/<session_id>/`
2. Work-scoped scratch root when active work tracking is present:
   - `/Users/zuul/.config/opencode/MEMORY/WORK/<work_dir>/scratch/<rootSessionId>/`
3. Audit correlation:
   - start from `sessionId` in `security.jsonl`
   - correlate the same session with scratchpad files, ask-gate messages, or MCP evidence artifacts
4. For `research-shell`, expect artifacts below:
   - `<session_dir>/research-shell/`
   - `<session_dir>/research-shell/evidence/`

## 9) Path portability note

This runbook uses exact `/Users/zuul/...` paths for this branch.
Portable equivalents are:

- repo root → `~/Projects/pai-opencode`
- worktree root → `~/Projects/pai-opencode/.worktrees/feat-security-middleware-parity`
- runtime root → `~/.config/opencode`
