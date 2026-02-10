---
name: DocumentationIndex
description: Complete PAI documentation index with detailed descriptions. Reference material extracted from SKILL.md for on-demand loading.
created: 2025-12-17
extracted_from: SKILL.md lines 339-401
---

# PAI Documentation Index

**Quick reference in SKILL.md** → For full details, see this file

---

## 📚 Documentation Index & Route Triggers

**Authority baseline:** `~/.config/opencode/skills/PAI/SYSTEM/DOC_AUTHORITY_MAP.md`

**All documentation files are in `~/.config/opencode/skills/PAI/` under:**
- `~/.config/opencode/skills/PAI/SYSTEM/`
- `~/.config/opencode/skills/PAI/USER/`

**Core Architecture & Philosophy:**
- `~/.config/opencode/skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md` - System architecture and philosophy | ⭐ PRIMARY REFERENCE
- `~/.config/opencode/skills/PAI/SYSTEM/DOC_AUTHORITY_MAP.md` - Domain-by-domain source-of-truth map | ⭐ AUTHORITATIVE INDEX
- `~/.config/opencode/skills/PAI/SYSTEM/COHERENCE_BACKLOG.md` - Deferred coherence findings and follow-up queue
- `~/.config/opencode/skills/PAI/SYSTEM/SYSTEM_USER_EXTENDABILITY.md` - SYSTEM/USER extensibility pattern
- `~/.config/opencode/skills/PAI/SYSTEM/CLIFIRSTARCHITECTURE.md` - CLI-first pattern details
- `~/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md` - Skill structure, routing, triggers | ⭐ CRITICAL

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

See `~/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md` for complete documentation.

**Development & Testing:**
- `~/.config/opencode/skills/PAI/USER/TECHSTACKPREFERENCES.md` - Core technology stack | Triggers: "what stack do I use", "bun or npm"
- Testing standards → Engineer capability workflows (plus Architect/Designer when relevant)

**Agent System:**
- **agents Skill** (`~/.config/opencode/skills/agents/`) - Complete agent composition system | See agents skill for custom agent creation, traits, and voice mappings
- Delegation patterns are documented inline in the "Delegation & Parallelization" section below

**Response & Communication:**
- `~/.config/opencode/skills/PAI/SKILL.md` - Authoritative response/process contract (Algorithm + adapter guardrails) | ⭐ AUTHORITATIVE
- `~/.config/opencode/skills/PAI/SYSTEM/RESPONSEFORMAT.md` - Compatibility formatting guidance (non-authoritative)
- `~/.config/opencode/skills/PAI/SYSTEM/THEFABRICSYSTEM.md` - Fabric patterns
- Voice notifications → VoiceServer (system alerts, agent feedback)

**Configuration & Systems:**
- `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md` - Plugin system
- `~/.config/opencode/skills/PAI/SYSTEM/THEHOOKSYSTEM.md` - Legacy hook compatibility note (non-authoritative)
- `~/.config/opencode/skills/PAI/SYSTEM/MEMORYSYSTEM.md` - Memory documentation
- `~/.config/opencode/skills/PAI/SYSTEM/TERMINALTABS.md` - Terminal tab state system

**Reference Data:**
- `~/.config/opencode/skills/PAI/USER/ASSETMANAGEMENT.md` - Digital assets registry | ⭐ CRITICAL
- `~/.config/opencode/skills/PAI/USER/CONTACTS.md` - Contact directory
- `~/.config/opencode/skills/PAI/USER/DEFINITIONS.md` - Canonical definitions
- `~/.config/opencode/PAISECURITYSYSTEM/` - Security docs + patterns
- `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/` - Personal security policies (private)

**Workflows:**
- `Workflows/` - Operational procedures (git, delegation, MCP, blog deployment, etc.)

---

**See Also:**
- SKILL.md > Documentation Index - Condensed table version
