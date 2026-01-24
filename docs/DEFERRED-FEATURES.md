# Deferred Features

**Features from PAI 2.3 that are not in PAI-OpenCode v1.0, and when they're coming**

---

## Overview

PAI-OpenCode v1.0 focuses on **core functionality**—skills, agents, security, memory. Some advanced features from PAI 2.3 (Claude Code) are **deferred to future releases** to ensure a stable, well-tested foundation.

---

## Feature Status Matrix

| Feature | PAI 2.3 Status | PAI-OpenCode v1.0 | Target Version | Priority |
|---------|----------------|-------------------|----------------|----------|
| Skills System | ✅ Stable | ✅ Included | v1.0 | P0 |
| Agent System | ✅ Stable | ✅ Included | v1.0 | P0 |
| Security Validation | ✅ Stable | ✅ Included | v1.0 | P0 |
| MEMORY System | ✅ Stable | ✅ Included | v1.0 | P0 |
| Voice Server | ✅ Stable | ⏳ Deferred | v1.1 | P1 |
| Observability Dashboard | ✅ Stable | ⏳ Deferred | v1.2 | P2 |
| Installation Wizard | ✅ Stable | ⏳ Deferred | v1.3 | P2 |
| Auto-Migration | ✅ Stable | ⏳ Deferred | v1.x | P3 |
| MCP Server Adapters | ⚠️ Experimental | ⏳ Deferred | v1.x | P3 |

---

## 1. Voice Server (TTS Notifications)

**Status:** Deferred to v1.1
**Priority:** P1 (High)

### What It Does

The Voice Server provides **text-to-speech notifications** for:
- Task completion alerts
- Error notifications
- Session milestone announcements
- Long-running command completion

### Why Deferred

- Requires macOS-specific audio setup (`say` command)
- Need to verify OpenCode plugin can emit events
- Audio device selection needs testing

### Workaround (v1.0)

Voice line still appears in responses:
```
🗣️ Jeremy: Task completed successfully.
```

But no audio playback. Format preserved for v1.1.

---

## 2. Observability Dashboard

**Status:** Deferred to v1.2
**Priority:** P2 (Medium)

### What It Does

The Observability Dashboard provides **real-time monitoring** of:
- Active sessions
- Tool usage metrics
- Security events
- Learning capture
- Agent invocations

![Observability Dashboard](images/observability-dashboard.png)

### Why Deferred

- Vue + Vite build system needs OpenCode testing
- Event capture requires plugin `tool.execute.after` testing
- Real-time SSE needs validation

### Workaround (v1.0)

View events manually:
```bash
cat .opencode/MEMORY/raw-outputs/2026-01/*.jsonl | jq
```

---

## 3. Installation Wizard

**Status:** Deferred to v1.3
**Priority:** P2 (Medium)

### What It Does

The Installation Wizard provides **interactive setup** for:
- Identity configuration (name, AI preferences)
- Security pattern customization
- Skill selection (enable/disable skills)
- Agent customization

### Why Deferred

- Interactive CLI needs testing in OpenCode context
- Default config works well (wizard might be unnecessary)
- Focus on getting core features stable first

### Workaround (v1.0)

Manual setup:
```bash
git clone https://github.com/Steffen025/pai-opencode.git
cd pai-opencode
bun install
opencode
```

Default config works immediately—no setup required.

---

## 4. Auto-Migration

**Status:** Deferred to v1.x
**Priority:** P3 (Low)

### What It Does

Auto-Migration provides **automatic updates** from Claude Code PAI:
- Detects new PAI 2.x releases
- Pulls upstream changes
- Applies to OpenCode installation
- Preserves USER customizations

### Why Deferred

- Need stable v1.0 baseline first
- Upstream detection requires GitHub API
- Migration strategies need per-component logic

### Workaround (v1.0)

Manual migration using converter:
```bash
bun Tools/pai-to-opencode-converter.ts \
  --source vendor/PAI/Releases/v2.x \
  --target .opencode \
  --mode selective
```

---

## 5. MCP Server Adapters

**Status:** Deferred to v1.x
**Priority:** P3 (Low)

### What It Does

MCP Server Adapters provide **external tool integration**:
- **deepwiki-enhanced**: GitHub repo Q&A via Devin API
- **Community MCP servers**: Various integrations from the MCP ecosystem

### Why Deferred

- OpenCode MCP server support needs testing
- MCP protocol compatibility unknown
- Authentication needs secure handling

### Workaround (v1.0)

Use external tools directly or via web interfaces.

---

## Roadmap Summary

### v1.0 (Current) - Foundation

**Included:**
- ✅ Skills System (20+ skills)
- ✅ Agent System (13 agents, PascalCase)
- ✅ Security Validation (pattern-based)
- ✅ MEMORY System (work, learning, state)
- ✅ Unified Plugin (context + security)
- ✅ Converter Tool (Claude Code → OpenCode)

**Deferred:**
- ⏳ Voice Server
- ⏳ Observability Dashboard
- ⏳ Installation Wizard
- ⏳ Auto-Migration
- ⏳ MCP Server Adapters

---

### v1.1 - Voice & Notifications

**Target:** Q1 2026

- Voice Server (macOS TTS)
- Task completion notifications
- Error alerts

---

### v1.2 - Observability

**Target:** Q2 2026

- Event capture plugin
- Dashboard server (Bun + HTTP)
- Vue client (real-time feed)
- Session timeline visualization

---

### v1.3 - Installation & UX

**Target:** Q2 2026

- Interactive installation wizard
- Identity setup
- Security configuration
- Skill/agent customization

---

### v1.x - Advanced Features

**Target:** TBD

- Auto-migration from upstream PAI
- MCP server adapters
- Cross-platform support (Windows, Linux)

---

## Contributing

Want to help implement deferred features?

1. **Check GitHub Issues** for feature discussions
2. **Read technical docs** for architecture details
3. **Start with tests** - verify OpenCode compatibility first
4. **Submit PRs** with tests and documentation

**Priority order:**
1. Voice Server (v1.1) - Clear use case, macOS only
2. Observability (v1.2) - High value, moderate complexity
3. Wizard (v1.3) - Nice-to-have
4. Auto-Migration (v1.x) - Complex, needs stable baseline
5. MCP Adapters (v1.x) - Experimental

---

## Next Steps

- **PLUGIN-SYSTEM.md** - How OpenCode plugins work
- **PAI-ADAPTATIONS.md** - What we changed from PAI 2.3
- **MIGRATION.md** - Migrating from Claude Code PAI

---

**PAI-OpenCode v1.0** - Foundation First, Features Follow
