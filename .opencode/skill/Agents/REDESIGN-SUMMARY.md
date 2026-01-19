# Agent Profile System Redesign Summary

**Date**: 2025-12-18
**Version**: v2.0.0 (Simplified)

---

## What Changed

### Before (v1.0.0 - Over-engineered)

- ❌ 5 elaborate YAML files with memory blocks and init prompts
- ❌ Duplicated CORE content (stack preferences, coding standards)
- ❌ Complex AgentProfileLoader.ts with YAML parsing
- ❌ Three layers of redundant context

### After (v2.0.0 - Simplified)

- ✅ 5 simple markdown context files (one per agent type)
- ✅ References Skills, doesn't duplicate content
- ✅ Simple LoadAgentContext.ts (just reads markdown)
- ✅ Supplements CORE without redundancy

---

## New Files Created

```
~/.opencode/skill/Agents/
├── ArchitectContext.md      ✅ NEW - Simple reference file
├── EngineerContext.md        ✅ NEW - Simple reference file
├── DesignerContext.md        ✅ NEW - Simple reference file
├── ArtistContext.md          ✅ NEW - Simple reference file
├── QATesterContext.md        ✅ NEW - Simple reference file
├── AgentProfileSystem.md     🔄 UPDATED - New simplified docs
└── Tools/
    └── LoadAgentContext.ts   ✅ NEW - Simple loader utility
```

---

## Deprecated Files (Backed Up)

Old YAML system backed up to: `~/.opencode/History/Backups/2025-12-18-AgentProfiles/`

- Architect.yaml
- Engineer.yaml
- Designer.yaml
- Artist.yaml
- QATester.yaml
- AgentProfileLoader.ts (old complex loader)

---

## How It Works Now

### 1. Each Agent Has ONE Context File

Example: `ArchitectContext.md`

```markdown
# Architect Agent Context

**Role**: Software architecture specialist
**Model**: opus

## Required Knowledge (Pre-load from Skills)
- **skills/CORE/CONSTITUTION.md** - Foundational principles
- **skills/CORE/CoreStack.md** - Stack preferences

## Task-Specific Knowledge
- **api** → skills/Development/References/APIDesign.md
- **security** → skills/CORE/SecurityProtocols.md
```

### 2. Simple Loader Reads Context

```typescript
const loader = new AgentContextLoader();
const { prompt, model } = loader.generateEnrichedPrompt(
  "Architect",
  "Design new REST API"
);

// prompt = context file + task description
// model = opus (from context file)
```

### 3. Spawn Agent with Enriched Prompt

```typescript
await Task({
  subagent_type: "general-purpose",
  description: "Architecture design task",
  prompt: prompt,
  model: model
});
```

---

## Key Benefits

1. **No Duplication**: CORE already provides constitutional principles, stack preferences, etc.
2. **Simple**: One markdown file per agent - easy to understand and maintain
3. **References Skills**: Acts as "reading list" pointing to existing knowledge
4. **Supplements CORE**: Adds agent-specific context without replacing base knowledge
5. **Maintainable**: When Skills change, just update references, not content

---

## Testing

All commands work as expected:

```bash
# List available agents
bun run ~/.opencode/skill/Agents/Tools/LoadAgentContext.ts
# Output: Architect, Artist, Engineer, Designer, QATester

# View specific context
bun run ~/.opencode/skill/Agents/Tools/LoadAgentContext.ts Architect

# Generate enriched prompt
bun run ~/.opencode/skill/Agents/Tools/LoadAgentContext.ts Engineer "Implement TDD workflow"
```

---

## Migration Notes

- Old YAML profiles are deprecated but backed up
- New system uses markdown context files
- LoadAgentContext.ts replaces AgentProfileLoader.ts
- No breaking changes to how agents are spawned (just simpler prompts)

---

## What Agents Get When Spawned

1. **CORE context** (auto-loaded at session start)
   - Constitutional principles
   - Stack preferences
   - Security protocols

2. **Agent-specific context** (from `*Context.md`)
   - Role definition
   - References to relevant Skills
   - Task-specific knowledge pointers
   - Output format guidance

3. **Current task** (provided when spawning)
   - The specific work to be done

---

## Summary

**Before**: Over-engineered YAML system with duplicated content
**After**: Simple markdown "reading lists" that reference existing Skills

This is the goal: agents get loaded with knowledge of "how to do that particular task of our entire system" by referencing the Skills system, not duplicating it.
