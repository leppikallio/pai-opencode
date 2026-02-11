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

**When independent workstreams are substantial, use multiple agents.**

### Depth Selection for Agents (Runtime-safe)

Do not assume Task supports an explicit `model` parameter in this runtime.

Speed/quality should be optimized through:

1. Correct `subagent_type` selection
2. Prompt scope and verification depth control
3. Parallel fan-out for independent tasks

**Examples:**

```typescript
// Simple verification task (short prompt)
functions.task({ description: "Visual check", prompt: "Check if blue bar exists on website", subagent_type: "Intern" })

// Standard implementation task
functions.task({ description: "Implement login validation", prompt: "Implement the login form validation", subagent_type: "Engineer" })

// Deep architecture task (explicitly request deeper analysis)
functions.task({ description: "Design caching strategy", prompt: "Design distributed caching strategy with tradeoff analysis", subagent_type: "Architect" })
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
- Each intern gets the context required for its assigned criterion
- Launch only as many as needed (default 3-5 unless justified)
- Launch a spotcheck intern when outputs are high-stakes, heterogeneous, or conflict-prone

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
1. Use runtime Task subagent types directly (usually Intern for generic parallel work)
2. Route by capability when needed (Engineer/Architect/Designer/etc.)
3. Do not invoke AgentFactory unless the user explicitly asked for custom agents

**Reference:** agents skill (`../../agents/SKILL.md`)

**Full Context Requirements:**
When delegating non-trivial or high-risk work, include:
1. WHY this task matters (business context)
2. WHAT the current state is (existing implementation)
3. EXACTLY what to do (precise actions, file paths, patterns)
4. SUCCESS CRITERIA (what output should look like)

---

**See Also:**
- SKILL.md > Delegation (Quick Reference) - Condensed trigger table
- Workflows/Delegation.md - Operational delegation procedures
- Workflows/BackgroundDelegation.md - Background agent patterns
- ../../agents/SKILL.md - Custom agent creation system
