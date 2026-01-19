# PAI Agent System

**Authoritative reference for agent routing in PAI-OpenCode. Verified via testing 2026-01-19.**

---

## 🚨 CRITICAL: Two Different Invocation Contexts

**OpenCode has TWO contexts for agent invocation - don't confuse them!**

### Context 1: AI-zu-Agent Delegation (Task Tool)

**When the AI needs to spawn an agent, use the Task tool:**

```typescript
// ✅ WORKS - Task tool with subagent_type for named agents
Task({ subagent_type: "Intern", prompt: "research X" })      // ✅ Klickbare Session
Task({ subagent_type: "Architect", prompt: "design Y" })     // ✅ Klickbare Session
Task({ subagent_type: "Engineer", prompt: "implement Z" })   // ✅ Klickbare Session

// ✅ WORKS - Native OpenCode types
Task({ subagent_type: "Explore", prompt: "find files" })     // ✅ Native
Task({ subagent_type: "Plan", prompt: "plan feature" })      // ✅ Native
Task({ subagent_type: "general-purpose", prompt: "..." })    // ✅ Native

// ❌ DOES NOT WORK - @syntax in AI response
@intern research X    // ❌ This is just TEXT, not an invocation!
@architect design Y   // ❌ Agent is NOT called!
```

**Test Results (2026-01-19):**
| Method | Result | UI Behavior |
|--------|--------|-------------|
| `Task({subagent_type: "Intern"})` | ✅ Works | Klickbare Session |
| `Task({subagent_type: "Architect"})` | ✅ Works | Klickbare Session |
| `@architect` in AI response | ❌ Nothing | No agent called |

### Context 2: User-zu-Agent (User Input)

**When the USER types in the input field:**

```
@intern research TypeScript    → Agent wird aufgerufen ✅
@architect design a system     → Agent wird aufgerufen ✅
```

**The `@agentname` syntax ONLY works when the USER types it!**

---

## Agent Invocation Summary

| Who | Method | Works? |
|-----|--------|--------|
| **AI** | `Task({subagent_type: "AgentName"})` | ✅ Yes |
| **AI** | `@agentname` in response text | ❌ No (just text) |
| **User** | `@agentname` in input | ✅ Yes |

---

## Task Tool Subagent Types

**All these subagent_types work in OpenCode:**

| Subagent Type | Purpose | Model |
|---------------|---------|-------|
| `Intern` | Fast parallel grunt work | Haiku |
| `Architect` | System design | Sonnet |
| `Engineer` | Code implementation | Sonnet |
| `Designer` | UX/UI design | Sonnet |
| `Pentester` | Security testing | Sonnet |
| `Researcher` | General research | Sonnet |
| `Explore` | Native codebase exploration | Haiku |
| `Plan` | Native implementation planning | Sonnet |
| `general-purpose` | Custom prompts, AgentFactory | Varies |

**Note:** Agent names are case-insensitive (`intern` = `Intern`)

---

## Custom Agents (Dynamic Composition)

**For truly custom agents with unique trait combinations, use AgentFactory:**

```bash
# Generate custom agent prompt with specific traits
bun run ~/.opencode/skill/Agents/Tools/AgentFactory.ts --traits "research,enthusiastic,exploratory"
bun run ~/.opencode/skill/Agents/Tools/AgentFactory.ts --traits "security,skeptical,adversarial"
```

Then launch via Task:
```typescript
Task({
  subagent_type: "general-purpose",
  prompt: generatedPrompt
})
```

---

## Routing Rules for AI

| User Says | AI Action |
|-----------|-----------|
| "use the Intern" / "lass den Intern..." | `Task({subagent_type: "Intern", prompt: ...})` |
| "Architect soll..." / "get the Architect" | `Task({subagent_type: "Architect", prompt: ...})` |
| "parallel agents" / "mehrere Agenten" | Multiple `Task()` calls in parallel |
| "custom agents" / "benutzerdefinierte Agenten" | AgentFactory + `general-purpose` Task |

---

## Agent Files Location

All agent definitions are in `.opencode/agent/*.md`:

| Agent | File | Model |
|-------|------|-------|
| Intern | `intern.md` | `anthropic/claude-haiku-4-5` |
| Architect | `architect.md` | `anthropic/claude-sonnet-4-5` |
| Engineer | `engineer.md` | `anthropic/claude-sonnet-4-5` |
| Designer | `designer.md` | `anthropic/claude-sonnet-4-5` |
| Pentester | `pentester.md` | `anthropic/claude-sonnet-4-5` |
| Researcher | `researcher.md` | `anthropic/claude-sonnet-4-5` |
| QATester | `QATester.md` | `anthropic/claude-sonnet-4-5` |
| Artist | `Artist.md` | `anthropic/claude-sonnet-4-5` |
| ClaudeResearcher | `ClaudeResearcher.md` | `anthropic/claude-sonnet-4-5` |
| GeminiResearcher | `GeminiResearcher.md` | `anthropic/claude-sonnet-4-5` |
| GrokResearcher | `GrokResearcher.md` | `anthropic/claude-sonnet-4-5` |
| CodexResearcher | `CodexResearcher.md` | `anthropic/claude-sonnet-4-5` |
| Writer | `writer.md` | `anthropic/claude-sonnet-4-5` |

---

## Named Agents (Persistent Identities)

Named agents have rich backstories and personality traits. They provide relationship continuity across sessions.

| Agent | Character | Use For |
|-------|-----------|---------|
| Dev Patel | High-energy genius intern | Parallel grunt work, research |
| Serena Blackwood | Academic visionary | System architecture |
| Marcus Webb | Battle-scarred pragmatist | Code implementation |
| Rook Blackburn | Security specialist | Security testing |

**Full backstories:** `skill/Agents/AgentPersonalities.md`

---

## Model Selection (Cost-Aware)

| Agent Type | Model | Cost Reason |
|------------|-------|-------------|
| Intern, Explore | Haiku | Fast, cheap for parallel work |
| All other named agents | Sonnet | Balanced cost/capability |
| Main orchestrator (PAI) | Opus | Maximum intelligence |

```typescript
// Cost-effective parallel execution
Task({ subagent_type: "Intern", model: "haiku", prompt: "..." })  // Cheap
Task({ subagent_type: "Intern", model: "haiku", prompt: "..." })  // Cheap
Task({ subagent_type: "Intern", model: "haiku", prompt: "..." })  // Cheap
// Then synthesize with Architect (Sonnet)
Task({ subagent_type: "Architect", model: "sonnet", prompt: "synthesize..." })
```

---

## Spotcheck Pattern

**Always launch a spotcheck agent after parallel work:**

```typescript
Task({
  subagent_type: "Intern",
  model: "haiku",
  prompt: "Verify consistency across all agent outputs: [results]"
})
```

---

## References

- **Agents Skill:** `skill/Agents/SKILL.md` — Custom agent creation
- **AgentFactory:** `skill/Agents/Tools/AgentFactory.ts` — Dynamic composition
- **Agent Files:** `.opencode/agent/*.md` — Agent definitions

---

*Last updated: 2026-01-19 (verified via testing)*
