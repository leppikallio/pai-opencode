# Security Incident Response Guide

Operational incident workflow for the canonical security engine and adapters.

## 1) Evidence sources

- Security audit log:
  - `/Users/zuul/.config/opencode/MEMORY/SECURITY/YYYY-MM/security.jsonl`
- Hook gate messages (when `ask` is returned from `tool.execute.before`):
  - format includes `Hook:`, `Tool:`, `Input:` and `PAI_CONFIRM <id>`
- Research-shell artifacts (per session dir):
  - `<session_dir>/research-shell/evidence/research-shell.jsonl`
  - `<session_dir>/research-shell/*.json`
  - `<session_dir>/research-shell/*.md`

### How to locate `<session_dir>`

Use one of these practical sources:

1. Scratchpad/session root:
   - `/Users/zuul/.config/opencode/scratchpad/sessions/<session_id>/`
2. Work-scoped scratch root when current work tracking is active:
   - `/Users/zuul/.config/opencode/MEMORY/WORK/<work_dir>/scratch/<rootSessionId>/`
3. Correlate from `sessionId` in `security.jsonl`, then check matching scratchpad or MCP artifact directories.

## 2) Correlate session ID, hook, tool, target preview

1. Collect incident context from the failed tool call:
   - session id (example: `ses_...`)
   - tool name (example: `Bash`, `Read`, `Write`, `apply_patch`, `perplexity_search`)
   - hook name from ask-gate message when present
2. Query audit log by session id:

```bash
rg '"sessionId":"<SESSION_ID>"' "/Users/zuul/.config/opencode/MEMORY/SECURITY/$(date +%Y-%m)/security.jsonl"
```

3. Narrow by tool and inspect `targetPreview`, `ruleId`, `reason`, `action`:

```bash
rg '"sessionId":"<SESSION_ID>".*"tool":"<TOOL>"' "/Users/zuul/.config/opencode/MEMORY/SECURITY/$(date +%Y-%m)/security.jsonl"
```

4. If this was `PAI_CONFIRM` flow, correlate with ask-gate context from the blocked message (`Hook`, `Tool`, `Input`) and matching timestamp window.

## 3) Classify: false positive vs bypass attempt

### Likely false positive

- Legitimate command/workflow was blocked/confirmed.
- `ruleId` maps to broad policy pattern (for example `path.confirm`, `path.block`, or a specific regex id).
- Reproduces consistently on safe command variants.

### Likely bypass attempt

- Command is obfuscated to evade matching (env-prefix wrappers, subshell/command substitution, xargs chaining, encoded wrapper payload).
- `ruleId` matches known bypass families, e.g.:
  - `bash.traversal_destructive`
  - `bash.xargs_destructive`
  - `bash.subshell_destructive`
  - `bash.wrapper_destructive`
- Target is destructive and not required for normal operation.

## 4) Rule tuning workflow (mandatory)

> Rule: **add a regression test before changing policy**.

1. Capture the exact triggering input and audit evidence.
2. Add or update a failing test first in the most relevant suite:
   - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_bash_bypass_regressions.test.ts`
   - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_current_behavior_baseline.test.ts`
   - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_policy_loading.test.ts`
   - `/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity/.opencode/tests/entities/security_project_rules.test.ts`
3. Apply the minimal policy/engine change.
4. Run targeted suite + branch security suite.
5. Deploy runtime changes:

> Warning: this updates the live runtime under `~/.config/opencode` and may affect future sessions immediately.
> Restart OpenCode/MCP after code changes and prefer a fresh session for verification.

```bash
cd "/Users/zuul/Projects/pai-opencode/.worktrees/feat-security-middleware-parity" && bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

6. Restart OpenCode when code changed (required for hook/plugin/MCP code updates).
7. Validate from fresh audit events that the new behavior matches intended classification.

## 5) Immediate containment playbook

For active bypass attempts:

1. Add a temporary USER override rule in:
   - `/Users/zuul/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. Re-run bypass regression tests.
3. Deploy from repo branch when permanent fix is ready.
4. Confirm new `block` events appear with expected `ruleId` and reason.

## 6) Post-incident checklist

- Incident classified (false positive / bypass).
- Regression test added before policy changes.
- Rule update deployed and verified.
- Audit evidence captured (session id + rule id + targetPreview + action).
- Follow-up issue created if broader architectural fix is needed.
