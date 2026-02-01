---
name: DocumentationIndex
description: Complete CORE documentation index with detailed descriptions. Reference material extracted from SKILL.md for on-demand loading.
created: 2025-12-17
extracted_from: SKILL.md lines 339-401
---

# CORE Documentation Index

**Quick reference in SKILL.md** → For full details, see this file

---

## 📚 Documentation Index & Route Triggers

**All documentation files are in `~/.config/opencode/skills/CORE/` under:**
- `~/.config/opencode/skills/CORE/SYSTEM/`
- `~/.config/opencode/skills/CORE/USER/`

**Core Architecture & Philosophy:**
- `~/.config/opencode/skills/CORE/SYSTEM/PAISYSTEMARCHITECTURE.md` - System architecture and philosophy | ⭐ PRIMARY REFERENCE
- `~/.config/opencode/skills/CORE/SYSTEM/SYSTEM_USER_EXTENDABILITY.md` - SYSTEM/USER extensibility pattern
- `~/.config/opencode/skills/CORE/SYSTEM/CLIFIRSTARCHITECTURE.md` - CLI-first pattern details
- `~/.config/opencode/skills/CORE/SYSTEM/SkillSystem.md` - Skill structure, routing, triggers | ⭐ CRITICAL

**Skill Execution:**

When a skill is invoked, follow the SKILL.md instructions step-by-step: execute voice notifications, use the routing table to find the workflow, and follow the workflow instructions in order.

**🚨 MANDATORY USE WHEN FORMAT (Always Active):**

Every skill description MUST use this format:
```
description: [What it does]. USE WHEN [intent triggers using OR]. [Capabilities].
```

**Example:**
```
description: Complete blog workflow. USE WHEN user mentions their blog, website, or site, OR wants to write, edit, or publish content. Handles writing, editing, deployment.
```

**Rules:**
- `USE WHEN` keyword is MANDATORY (skill index parses this)
- Use intent-based triggers: `user mentions`, `user wants to`, `OR`
- Do NOT list exact phrases like `'write a blog post'`
- Max 1024 characters

See `~/.config/opencode/skills/CORE/SYSTEM/SkillSystem.md` for complete documentation.

**Development & Testing:**
- `~/.config/opencode/skills/CORE/USER/TECHSTACKPREFERENCES.md` - Core technology stack | Triggers: "what stack do I use", "bun or npm"
- Testing standards → Development Skill

**Agent System:**
- **Agents Skill** (`~/.config/opencode/skills/Agents/`) - Complete agent composition system | See Agents skill for custom agent creation, traits, and voice mappings
- Delegation patterns are documented inline in the "Delegation & Parallelization" section below

**Response & Communication:**
- `~/.config/opencode/skills/CORE/SYSTEM/RESPONSEFORMAT.md` - Mandatory response format
- `~/.config/opencode/skills/CORE/SYSTEM/THEFABRICSYSTEM.md` - Fabric patterns
- Voice notifications → VoiceServer (system alerts, agent feedback)

**Configuration & Systems:**
- `~/.config/opencode/skills/CORE/SYSTEM/THEPLUGINSYSTEM.md` - Plugin system
- `~/.config/opencode/skills/CORE/SYSTEM/MEMORYSYSTEM.md` - Memory documentation
- `~/.config/opencode/skills/CORE/SYSTEM/TERMINALTABS.md` - Terminal tab state system

**Reference Data:**
- `~/.config/opencode/skills/CORE/USER/ASSETMANAGEMENT.md` - Digital assets registry | ⭐ CRITICAL
- `~/.config/opencode/skills/CORE/USER/CONTACTS.md` - Contact directory
- `~/.config/opencode/skills/CORE/USER/DEFINITIONS.md` - Canonical definitions
- `~/.config/opencode/PAISECURITYSYSTEM/` - Security docs + patterns
- `~/.config/opencode/skills/CORE/USER/PAISECURITYSYSTEM/` - Personal security policies (private)

**Workflows:**
- `Workflows/` - Operational procedures (git, delegation, MCP, blog deployment, etc.)

---

**See Also:**
- SKILL.md > Documentation Index - Condensed table version
