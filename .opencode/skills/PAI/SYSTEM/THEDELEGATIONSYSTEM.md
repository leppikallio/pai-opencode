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
// Simple UI verification task (short prompt)
functions.task({ description: "Visual check", prompt: "Check if blue bar exists on website", subagent_type: "QATester" })

// Standard implementation task
functions.task({ description: "Implement login validation", prompt: "Implement the login form validation", subagent_type: "Engineer" })

// Deep architecture task (explicitly request deeper analysis)
functions.task({ description: "Design caching strategy", prompt: "Design distributed caching strategy with tradeoff analysis", subagent_type: "Architect" })
```

If explicit model override support is later added, verify tool schema first and then document exact supported fields.

### Routing Decision Tree (Authoritative)

Use this order consistently:

1. **Specialist first:** route to a runtime specialist when the task clearly maps (`Engineer`, `Architect`, `Designer`, `QATester`, `Pentester`, `explore`, research variants).
2. **Then `general`:** if no better specialist fit exists, use native `general` as the catch-all fallback.
3. **Reserve `Intern` for broad parallel grunt work:** use it only for safely split fan-out grunt tasks, not as the default catch-all.
4. **Dynamic composition only when explicit/bounded:** if the request is explicitly "custom agents" or a bounded "expert in X" ask, use AgentFactory via the `agents` skill.

Routing mentions like `@general` or `@<agent>` are intent hints. They remain advisory, not imperative.

### Runtime Subagent Guidance

| Subagent | Primary use |
|----------|-------------|
| `Engineer` / `Architect` / `Designer` / `QATester` / `Pentester` / `explore` / research variants | Clear specialist ownership |
| `general` | Catch-all fallback when specialist mapping is unclear |
| `Intern` | Broad parallel grunt work only |

**CRITICAL: Interns vs Engineers:**
- **INTERNS:** broad parallel grunt work with explicit checklists (tagging, extraction, categorization)
- **ENGINEERS:** writing and modifying code, implementing features, bug fixes
- **SPOTCHECKS / VISUAL CHECKS / SYNTHESIS:** route to the best-fit specialist (`QATester`, `Engineer`, `Architect`, or `general`)
- If work requires code changes, route to Engineer (plus Architect/Designer as needed)

### Background Launch Example (Current Runtime)

```typescript
functions.task({
  description: "Backlog triage sweep",
  prompt: "Classify open backlog items into implementation, design, and QA buckets.",
  subagent_type: "general",
  run_in_background: true,
})
```

### 🚨 CUSTOM AGENTS vs RUNTIME SUBAGENTS

**The word "custom" remains the trigger for AgentFactory:**

| User Says | What to Use | Why |
|-------------|-------------|-----|
| "**custom agents**", "spin up **custom** agents" | **AgentFactory** | Unique prompts and unique voices |
| "I need an expert in X" (explicit + bounded) | **AgentFactory** | Specialized one-off composition |
| "spin up agents", "launch agents" | **Runtime subagents** | Specialist-first, then `general`, Intern only for broad grunt work |

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
