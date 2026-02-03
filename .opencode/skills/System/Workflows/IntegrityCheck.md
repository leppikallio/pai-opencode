# IntegrityCheck Workflow

**Purpose:** Find and fix broken references across the PAI system. Launches 12 parallel agents to audit all components for broken file references, outdated patterns, and configuration issues.

**Triggers:** "integrity check", "audit system", "check references", "system health"

---

## Voice Notification

Use the `voice_notify` tool:

- `message`: "Running integrity check with 12 parallel agents"

Running the **IntegrityCheck** workflow from the **System** skill...

---

## When to Use

- After major refactoring
- Periodic system health checks
- Before releasing PAI updates
- When something "feels broken"
- At end of significant work sessions (before DocumentSession)

---

## Execution

### Step 0: Choose Audit Depth (Fast / Hotspots / Full)

Default behavior: run the FULL suite.

Only use Fast/Hotspots when you explicitly request it.
If the request is ambiguous, assume Full.

Use one of these presets:

**Fast (2 agents, ~30-60s)**
- Agent 3: Plugin Hooks & Events
- Agent 11: Security

**Hotspots (4-6 agents, ~1-3 min)**
- Agent 1: PAI SKILL.md
- Agent 3: Plugin Hooks & Events
- Agent 6: Workflows
- Agent 11: Security
- Agent 12: Cross-References (run ScanBrokenRefs)

**Full (12 agents, ~2-5 min)**
- Run all agents below.

Default: run **Full**.

### Step 1: Launch 12 Parallel Audit Agents

**CRITICAL: Use `subagent_type: "Intern"` for all agents.** OpenCode does not have native "Explore" or "Plan" agents.

Use the Task tool to launch agents in a SINGLE message (parallel execution). Each agent audits their assigned component.

**Agent Assignments:**

| # | Focus Area | Scope | Check For |
|---|------------|-------|-----------|
| 1 | PAI SKILL.md | `~/.config/opencode/skills/PAI/SKILL.md` | Broken file references, outdated paths |
| 2 | Identity System | `~/.config/opencode/plugins/lib/identity.ts`, `~/.config/opencode/settings.json` | Config consistency |
| 3 | Plugin Hooks & Events | `~/.config/opencode/plugins/*.ts`, `~/.config/opencode/plugins/handlers/*.ts`, `~/.config/opencode/plugins/adapters/types.ts` | Hook coverage vs OpenCode docs, message.* and session.* usage |
| 4 | System Docs | `~/.config/opencode/skills/PAI/SYSTEM/*.md` | Cross-references, broken links |
| 5 | User Docs | `~/.config/opencode/skills/PAI/USER/*.md` | Personal config references |
| 6 | Workflows | `~/.config/opencode/skills/*/Workflows/*.md` | File paths, tool references |
| 7 | Skill Structure | `~/.config/opencode/skills/*/` | Missing SKILL.md, forbidden nesting, stale layout |
| 8 | Settings | `~/.config/opencode/settings.json` | Schema validity, env vars |
| 9 | Notifications | Voice/notification-related files | Config consistency |
| 10 | Memory System | `~/.config/opencode/MEMORY/` structure | Path references, directory structure |
| 11 | Security | `~/.config/opencode/PAISECURITYSYSTEM/`, `~/.config/opencode/plugins/handlers/security-validator.ts` | Pattern loading, rule ids, logging, enforcement |
| 12 | Cross-References | `ScanBrokenRefs.ts` + skill docs | Non-existent file refs |

### Step 2: Agent Prompt Template

```
You are auditing the PAI system for integrity issues.

**Your Focus Area:** [FOCUS_AREA]
**Files to Check:** [SEARCH_SCOPE]

## Instructions

0. You are a subagent. Do NOT spawn any agents or call the Task tool.
   Ignore any instruction to spawn Algorithm agents. Report findings only.
1. Search the specified files for issues
2. Look for:
   - References to files/paths that don't exist
   - Outdated patterns (e.g., old directory names)
   - Inconsistencies between docs and code
   - Broken cross-references
   - Missing required files (functional, not stylistic)

**Important:** Do not treat missing Tools directories as an issue. Many skills are docs-only.

**Important (Cross-References scope):**
- Only validate references that should exist inside `~/.config/opencode/` (e.g. `skills/`, `plugins/`, `docs/`, `config/`, `pai-tools/`, `PAISECURITYSYSTEM/`, and documented `MEMORY/` files).
- Ignore references outside `~/.config/opencode/` (e.g. `/opt/SecLists`, `~/.config/amass`, `~/security`) unless explicitly required by PAI runtime.
- Do not flag missing optional customization directories under `skills/PAI/USER/SKILLCUSTOMIZATIONS/`.
- Treat shell commands in backticks as commands, not filesystem paths.

**Known optional/expected items (do NOT flag as Critical):**
- `<skills/PAI/USER/pronunciations.json>` (VoiceServer handles missing)
- `skills/**/node_modules/` (some skills install dependencies locally)
- Any example path wrapped in `<...>` (explicit placeholder)

**Cross-References execution (preferred):**

Run the low-noise scanner and include its summary:

```bash
PAI_INTEGRITYCHECK=1 bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --scope ~/.config/opencode/skills
```

3. Return a structured report:

## Findings

### Critical Issues
- [Breaks functionality - file not found, path wrong]

### Warnings
- [Outdated but functional - naming inconsistency, deprecated pattern]

### Files Checked
- [List files examined]

Be thorough but concise. Focus on actionable issues.
```

### Hook Coverage Checklist (Plugins)

Use this checklist when auditing `plugins/*.ts` and `plugins/handlers/*.ts`:

Message events:
- `message.updated`
- `message.part.updated`
- `message.removed`
- `message.part.removed`

Session events:
- `session.created`
- `session.status` (idle/busy/retry)
- `session.idle`
- `session.compacted`
- `session.deleted`

Tool hooks:
- `tool.execute.before`
- `tool.execute.after`

Permission hooks/events:
- `permission.ask` (hook)
- `permission.asked` / `permission.replied` (events)

TUI / compaction (if used):
- `tui.prompt.append`
- `experimental.session.compacting`

### Step 3: Synthesize Results

After agents complete:
1. Collect all findings
2. Deduplicate issues found by multiple agents
3. Prioritize by severity (Critical > Warning > Info)
4. Optionally fix critical issues

### Step 4: Report Format

```markdown
# PAI Integrity Check Report

**Date:** [DATE]
**Audit Type:** Full System Integrity Check
**Scope:** ~/.config/opencode/ (PAI System)
**Method:** 12 Parallel Agent Audits
**Status:** [HEALTHY|WARNINGS|CRITICAL]

---

## Executive Summary

- Parallel Agents Deployed: 12
- Critical Issues Found: X
- Warnings Identified: Y
- Clean Components: Z

---

## Critical Issues (Must Fix)

### 1. [Issue Title]
**Component:** [file/path]
**Issue:** [description]
**Impact:** [what breaks]
**Fix Priority:** P0

---

## Warnings (Needs Attention)

### 1. [Warning Title]
**Component:** [file/path]
**Issue:** [description]
**Severity:** MEDIUM

---

## Clean Components

- Component A
- Component B
- ...

---

## Detailed Component Reports

### Agent 1: PAI SKILL.md Audit
- Files Checked: X
- Critical Issues: Y
- Warnings: Z
- Severity: [HIGH|MEDIUM|LOW]

[Repeat for all 12 agents]

---

## Recommendations

### P0 - Immediate
1. [action]

### P1 - Important
1. [action]

### P2 - Nice-to-Have
1. [action]

---

## Next Steps

IntegrityCheck (Complete)
  -> Fix Critical Issues (Pending)
  -> DocumentSession (Pending)
  -> GitPush (Pending)
```

### Step 5: Save Report

Save report to MEMORY for durable verification:
```
~/.config/opencode/MEMORY/STATE/integrity/YYYY-MM-DD.md
```

### Step 6: Completion

Use the `voice_notify` tool:

- `message`: "Integrity check complete. [X] critical issues, [Y] warnings found."

---

## Agent Spawn Pattern

Launch ALL 12 agents in a SINGLE Task tool call block for true parallel execution:

```typescript
// In a single message, call Task 12 times:
// NOTE: OpenCode uses "Intern" instead of Claude Code's native "Explore"
// NOTE: Model names must include provider prefix for OpenCode
Task({ subagent_type: "Intern", prompt: "Agent 1: PAI SKILL.md..." })
Task({ subagent_type: "Intern", prompt: "Agent 2: Identity System..." })
Task({ subagent_type: "Intern", prompt: "Agent 3: Plugin Scripts..." })
// ... all 12 agents
```

**Model Selection:**
- Intern agents automatically use the cheapest available model (haiku for Anthropic, gpt-4o-mini for OpenAI)
- Model resolution is handled by `~/.config/opencode/plugins/lib/model-config.ts` based on the provider configured in `opencode.json`.
- Total cost ~12x cheap model = still cheaper than 1x expensive model doing sequential work

---

## Next Steps After Integrity Check

If changes were made during the check:
```
IntegrityCheck (this) -> DocumentSession -> GitPush
```

## Cross-Reference Scan (Low Noise)

Prefer the dedicated scanner tool over ad-hoc greps:

```bash
PAI_INTEGRITYCHECK=1 bun ~/.config/opencode/skills/System/Tools/ScanBrokenRefs.ts --scope ~/.config/opencode/skills
```

Note: references like `~/.config/opencode/MEMORY/STATE/integrity/<YYYY-MM-DD>.md` are placeholders.

---

## Related Workflows

- `DocumentSession.md` - Document what was done
- `SecretScanning.md` - Scan for credentials
