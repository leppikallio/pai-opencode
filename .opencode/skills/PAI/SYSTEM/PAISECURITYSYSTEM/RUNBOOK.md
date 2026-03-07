# Security Operations Runbook

Operational guide for changing security rules and validating runtime behavior after Tasks 4–8.

## 1) Canonical implementation paths (runtime-first)

- Canonical engine: `~/.config/opencode/plugins/security/index.ts`
- Security modules:
  - `~/.config/opencode/plugins/security/policy-loader.ts`
  - `~/.config/opencode/plugins/security/bash-policy.ts`
  - `~/.config/opencode/plugins/security/path-policy.ts`
  - `~/.config/opencode/plugins/security/content-policy.ts`
  - `~/.config/opencode/plugins/security/redaction.ts`
  - `~/.config/opencode/plugins/security/audit-log.ts`
  - `~/.config/opencode/plugins/security/decision.ts`
  - `~/.config/opencode/plugins/security/adapter-decision.ts`
  - `~/.config/opencode/plugins/security/tool-normalization.ts`
  - `~/.config/opencode/plugins/security/project-rules.ts`
- Compatibility facade:
  - `~/.config/opencode/plugins/handlers/security-validator.ts`
- Hook/plugin adapters:
  - `~/.config/opencode/hooks/SecurityValidator.hook.ts`
  - `~/.config/opencode/plugins/pai-cc-hooks/security-adapter.ts`
  - `~/.config/opencode/plugins/pai-cc-hooks/tool-before.ts`
- MCP shared adapter:
  - `~/.config/opencode/mcp/research-shell/security-adapter.ts`

> Deprecated and non-target: `pai-unified.ts` in the repo root.

Repo source equivalent for edits before deployment:

- `~/Projects/pai-opencode/.opencode/...`

## 2) Policy files and precedence (runtime)

The policy loader resolves these runtime paths in order:

1. `/Users/zuul/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. `/Users/zuul/.config/opencode/USER/PAISECURITYSYSTEM/` (optional legacy directory; create `patterns.yaml` if needed)
3. `/Users/zuul/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml` (fallback default)

System template source in this repo:

- `~/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml`

## 3) Rule-change workflow

1. Change policy intent (USER override for hotfix, SYSTEM template for baseline defaults).
2. Add/adjust tests first (see section 4).
3. Run security test suite.
4. Deploy to runtime.
5. Restart OpenCode if code changed; otherwise verify by log evidence.

## 4) Exact test commands (Task 1–8 coverage)

Run from any directory:

```bash
cd "~/Projects/pai-opencode"
bun test \
  ./.opencode/tests/entities/security_current_behavior_baseline.test.ts \
  ./.opencode/tests/entities/security_bash_bypass_regressions.test.ts \
  ./.opencode/tests/entities/security_policy_loading.test.ts \
  ./.opencode/tests/entities/security_project_rules.test.ts \
  ./.opencode/tests/entities/security_module_contract.test.ts \
  ./.opencode/tests/entities/security_pai_unified_extraction.test.ts \
  ./.opencode/tests/entities/security_hook_modularity_contract.test.ts \
  ./.opencode/tests/entities/security_adapter_contract.test.ts \
  ./.opencode/tests/entities/research_shell_security_adapter.test.ts \
  ./.opencode/tests/entities/pai_security_validator_apply_patch_move_to.test.ts \
  ./.opencode/tests/entities/pai_cc_hooks_ask_gate.test.ts \
  ./.opencode/tests/entities/pai_cc_hooks_tool_execute_before_args.test.ts
```

Fast single-suite check (MCP adapter only):

```bash
cd "~/Projects/pai-opencode"
bun test ./.opencode/tests/entities/research_shell_security_adapter.test.ts
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
cd "~/Projects/pai-opencode" && bun Tools/Install.ts --target "~/.config/opencode"
```

## 6) Restart / reload requirements

- **Required restart:** after changing TypeScript implementation under:
  - `~/.config/opencode/plugins/security/`
  - `~/.config/opencode/plugins/pai-cc-hooks/`
  - `~/.config/opencode/hooks/`
  - `~/.config/opencode/mcp/research-shell/`
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

This runbook uses exact runtime paths where operational behavior matters most.
Portable equivalents are:

- repo root → `~/Projects/pai-opencode`
- worktree root → `~/Projects/pai-opencode/.worktrees/<branch>`
- runtime root → `~/.config/opencode`
