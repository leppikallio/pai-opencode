# PAI Adaptations

**What we changed from vanilla PAI 2.4 and why**

---

## Overview

PAI-OpenCode is **PAI 2.4 ported to OpenCode**. Most of the system is unchanged—same skills, same agents, same memory structure. But some parts required adaptation due to fundamental platform differences.

This document explains **what we changed** and **why**.

---

## Core Changes

### 1. Hooks → Plugins

**What changed:**
- Claude Code: Multiple hook files in `.claude/hooks/`
- OpenCode: Single unified plugin in `.opencode/plugins/pai-unified.ts`

**Why:**
- OpenCode doesn't support the hooks pattern (separate subprocess execution)
- Plugins are in-process TypeScript functions (faster, simpler)
- Unified plugin allows shared state between event handlers

**Impact:**
- Security validation logic preserved, just different wrapper
- Context injection preserved, same CORE skill loading
- Hook exit codes → throw Error for blocking

**Files affected:**
```
hooks/load-core-context.ts      → plugins/handlers/context-loader.ts
hooks/security-validator.ts     → plugins/handlers/security-validator.ts
hooks/initialize-session.ts     → plugins/pai-unified.ts (event handler)
```

---

### 2. Directory Structure

**What changed:**
```
.claude/         → .opencode/
```

**Why:**
- OpenCode expects config in `.opencode/` directory
- Different platform convention

**Impact:**
- All path references updated (`$PAI_DIR` points to `.opencode/`)
- Skills, agents, MEMORY structure unchanged
- Tools updated to use `.opencode/` paths

---

### 3. Agent File Naming

**What changed:**
- Claude Code: `intern.md`, `researcher.md` (lowercase)
- OpenCode: `Intern.md`, `Researcher.md` (PascalCase)

**Why:**
- OpenCode requires PascalCase agent filenames
- Agent invocation syntax: `@Intern` expects `Intern.md`

**Impact:**
- All agent files renamed during conversion
- Agent content unchanged
- Invocation: `@Intern`, `@Researcher`, `@Architect`

---

### 4. Plugin Logging

**What changed:**
- Claude Code hooks: Can use `console.log()` (separate process)
- OpenCode plugins: Must use file logging (in-process)

**Why:**
- OpenCode plugins run in the same process as the TUI
- `console.log()` corrupts the terminal interface
- File logging preserves TUI integrity

**Implementation:**
```typescript
// lib/file-logger.ts
export function fileLog(message: string, level = "info") {
  appendFileSync("/tmp/pai-opencode-debug.log",
    `[${level}] ${message}\n`);
}
```

---

### 5. Security System Documentation

**What changed:**
- Added `PAISECURITYSYSTEM/PLUGINS.md`
- Documents plugin-specific security implementation

**Why:**
- Security validation is fundamentally different in plugins
- Exit codes → throw Error
- Need clear docs for OpenCode-specific security

---

## What Stayed The Same

### Skills System

**100% unchanged:**
- All 20+ skills work identically
- SKILL.md format unchanged
- Workflow files unchanged
- Skill trigger logic unchanged

### Memory Structure

**100% unchanged:**
- `MEMORY/` directory structure identical
- Session tracking unchanged
- Work session format unchanged
- Learning capture format unchanged

### Agent Personalities

**Content unchanged, only filenames:**
- Agent YAML frontmatter unchanged
- Agent instructions unchanged
- Agent invocation syntax same (`@AgentName`)

---

## Configuration Differences

### settings.json → opencode.json

| PAI 2.4 (Claude Code) | PAI-OpenCode |
|-----------------------|--------------|
| `settings.json` | `settings.json` (kept for PAI config) |
| No plugin config | `opencode.json` for plugin registration |

**Why two files:**
- `settings.json` - PAI configuration (env vars, identity, permissions)
- `opencode.json` - OpenCode configuration (plugins)

**Example opencode.json:**
```json
{
  "plugins": [
    ".opencode/plugins/pai-unified.ts"
  ]
}
```

---

## What We Removed (Deferred to v1.x)

These features exist in PAI 2.4 but are **deferred** in PAI-OpenCode v1.0:

| Feature | Status | Target |
|---------|--------|--------|
| Voice Server (TTS) | Deferred | v1.1 |
| Observability Dashboard | Deferred | v1.2 |
| Installation Wizard | Deferred | v1.3 |
| Auto-Migration | Deferred | v1.x |
| MCP Server Adapters | Deferred | v1.x |

See **DEFERRED-FEATURES.md** for detailed roadmap.

---

## Version Compatibility

| Component | PAI 2.4 | PAI-OpenCode v1.0 |
|-----------|---------|-------------------|
| Skills | ✅ Identical | ✅ Identical |
| Agents | ✅ Content identical | ⚠️ Filename casing changed |
| MEMORY | ✅ Identical | ✅ Identical |
| Security Patterns | ✅ Identical | ✅ Identical |
| Hooks/Plugins | ❌ Different architecture | ✅ Plugin system |
| Voice Server | ✅ Available | ⏳ Deferred |
| Observability | ✅ Available | ⏳ Deferred |

---

## Migration Path

### From PAI 2.4 (Claude Code)

```bash
# Use converter tool
bun Tools/pai-to-opencode-converter.ts \
  --source ~/.claude \
  --target .opencode

# What transfers:
✅ All skills
✅ All agents (renamed to PascalCase)
✅ All MEMORY
✅ All security patterns
✅ USER customizations

# What doesn't transfer:
❌ Hooks (need manual plugin migration)
❌ Observability (deferred)
❌ Voice Server (deferred)
```

See **MIGRATION.md** for full guide.

---

## Summary of Changes

| Category | Change | Reason | Impact |
|----------|--------|--------|--------|
| **Architecture** | Hooks → Plugins | OpenCode platform requirement | Implementation only |
| **Directory** | `.claude/` → `.opencode/` | Platform convention | Path updates |
| **Agents** | Lowercase → PascalCase | OpenCode requirement | Filename only |
| **Logging** | stdout → file logging | TUI integrity | Debug workflow change |
| **Deferred** | Voice/Observability | Focus on core first | Available in v1.x |

---

## Next Steps

- **PLUGIN-SYSTEM.md** - How OpenCode plugins work
- **DEFERRED-FEATURES.md** - Roadmap for v1.x features
- **MIGRATION.md** - Migrating from Claude Code PAI

---

**PAI-OpenCode v1.0** - Same Power, Different Platform
