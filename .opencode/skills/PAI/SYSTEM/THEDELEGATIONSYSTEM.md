---
name: DelegationReference
description: Comprehensive delegation and agent parallelization patterns. Reference material extracted from SKILL.md for on-demand loading.
created: 2025-12-17
extracted_from: SKILL.md lines 535-627
---

# Delegation & Parallelization Reference

**Quick reference in SKILL.md** → For full details, see this file

---

## 🤝 Delegation & Parallelization (Always Active)

**WHENEVER A TASK CAN BE PARALLELIZED, USE MULTIPLE AGENTS!**

### Depth Selection for Agents (Runtime-safe)

Do not assume Task supports an explicit `model` parameter in this runtime.

Speed/quality should be optimized through:

1. Correct `subagent_type` selection
2. Prompt scope and verification depth control
3. Parallel fan-out for independent tasks

**Examples:**

```typescript
// Simple verification task (short prompt)
Task({ prompt: "Check if blue bar exists on website", subagent_type: "Intern" })

// Standard implementation task
Task({ prompt: "Implement the login form validation", subagent_type: "Engineer" })

// Deep architecture task (explicitly request deeper analysis)
Task({ prompt: "Design distributed caching strategy with tradeoff analysis", subagent_type: "Architect" })
```

If explicit model override support is later added, verify tool schema first and then document exact supported fields.

### Agent Types

The Intern Agent is your high-agency genius generalist - perfect for parallel execution:
- Updating multiple files simultaneously
- Researching multiple topics at once
- Testing multiple approaches in parallel
- Processing multiple items from a list

**How to launch:**
- Use a SINGLE message with MULTIPLE Task tool calls
- Each intern gets FULL CONTEXT and DETAILED INSTRUCTIONS
- Launch as many as needed (no artificial limit)
- **ALWAYS launch a spotcheck intern after parallel work completes**

**CRITICAL: Interns vs Engineers:**
- **INTERNS:** Research, analysis, investigation, file reading, testing, coordinating
- **ENGINEERS:** Writing ANY code (TypeScript, Python, etc.), building features, implementing changes
- If task involves writing code → route to Engineer capability (and Architect/Designer as needed)
- Interns can delegate to engineers when code changes are needed

### 🚨 CUSTOM AGENTS vs GENERIC AGENTS (Always Active)

**The word "custom" is the KEY trigger:**

| User Says | What to Use | Why |
|-------------|-------------|-----|
| "**custom agents**", "spin up **custom** agents" | **AgentFactory** | Unique prompts, unique voices |
| "spin up agents", "bunch of agents", "launch agents" | **Intern agents** | Generic parallel workers |
| "interns", "use interns" | **Intern agents** | Obviously |

**When user says "custom agents":**
1. Invoke the agents skill → CreateCustomAgent workflow
2. Use DIFFERENT trait combinations to get unique voices
3. Launch with the full AgentFactory-generated prompt
4. Each agent gets a personality-matched ElevenLabs voice

**When user says "spin up agents" (no "custom"):**
1. Invoke the agents skill → SpawnParallelAgents workflow
2. All get the same Dev Patel voice (fine for grunt work)
3. No AgentFactory needed

**Reference:** agents skill (`~/.config/opencode/skills/agents/SKILL.md`)

**Full Context Requirements:**
When delegating, ALWAYS include:
1. WHY this task matters (business context)
2. WHAT the current state is (existing implementation)
3. EXACTLY what to do (precise actions, file paths, patterns)
4. SUCCESS CRITERIA (what output should look like)

---

**See Also:**
- SKILL.md > Delegation (Quick Reference) - Condensed trigger table
- Workflows/Delegation.md - Operational delegation procedures
- Workflows/BackgroundDelegation.md - Background agent patterns
- skills/agents/SKILL.md - Custom agent creation system
