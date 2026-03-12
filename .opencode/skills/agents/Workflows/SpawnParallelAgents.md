# SpawnParallelAgents Workflow

**Launches broad parallel grunt-work batches (NOT custom composition).**

## When to Use

{principal.name} says:
- "Launch 5 agents to research these companies"
- "Spin up agents to process this list"
- "Create intern agents to process this queue fast"
- "Use interns to check these URLs"

**KEY: Route specialist-first, then native `general` (never `general-purpose`); use `Intern` only for broad parallel grunt work.**

## The Workflow

### Step 1: Identify Task List

Extract what needs to be done in parallel:
- List of companies to research
- Files to analyze
- URLs to check
- Data points to investigate

### Step 2: Create Task-Specific Prompts

**Each agent gets a DETAILED prompt with FULL CONTEXT:**

```typescript
const agent1Prompt = `
## Context
We're researching competitors in the AI security space for strategic planning.

## Current State
We have 10 companies identified. You're analyzing Company A.

## Task
1. Research Company A's recent product launches (last 6 months)
2. Identify their target market and positioning
3. Note any key partnerships or acquisitions
4. Assess their technical approach

## Success Criteria
- Specific product names and launch dates
- Clear target market definition
- List of partnerships with dates
- Technical stack/approach summary

Company A: Acme AI Security Corp
`;
```

### Step 3: Launch ALL Agents in SINGLE Message

**CRITICAL: Use ONE message with MULTIPLE Task calls for true parallel execution:**

```typescript
// Send as a SINGLE message with all Task calls:
Task({
  description: "Research Company A",
  prompt: agent1Prompt,
  subagent_type: "general" // fallback; prefer a research specialist when available
})
Task({
  description: "Research Company B",
  prompt: agent2Prompt,
  subagent_type: "general" // fallback; prefer a research specialist when available
})
Task({
  description: "Research Company C",
  prompt: agent3Prompt,
  subagent_type: "general" // fallback; prefer a research specialist when available
})
// ... up to N agents
```

**All agents run simultaneously and return results together.**

### Step 4: Spotcheck Results (Mandatory)

**ALWAYS launch a spotcheck agent after parallel work completes:**

```typescript
Task({
  description: "Spotcheck parallel results",
  prompt: `Review these research results for consistency and completeness:

Company A: [results]
Company B: [results]
Company C: [results]

Check for:
1. Missing information across any companies
2. Inconsistent data formats
3. Obvious gaps or errors
4. Recommendations for follow-up research

Provide a brief assessment and any issues found.`,
  subagent_type: "QATester"
})
```

## Runtime Model Handling

- Do not pass `model` in `Task(...)`; it is unsupported.
- Let runtime policy choose model allocation per delegated task.
- Optimize speed by keeping prompts scoped and batches independent.

## Example: Research 5 Companies

**{principal.name}:** "Launch agents to research these 5 AI security companies"

**{daidentity.name}'s Execution:**
```typescript
// Single message with 5 Task calls:
Task({
  description: "Research Acme AI Security",
  prompt: "Research Acme AI Security Corp: products, market, partnerships, tech stack",
  subagent_type: "general"
})
Task({
  description: "Research Bolt Security AI",
  prompt: "Research Bolt Security AI: products, market, partnerships, tech stack",
  subagent_type: "general"
})
Task({
  description: "Research Cipher AI Defense",
  prompt: "Research Cipher AI Defense: products, market, partnerships, tech stack",
  subagent_type: "general"
})
Task({
  description: "Research Delta Threat Intel",
  prompt: "Research Delta Threat Intelligence: products, market, partnerships, tech stack",
  subagent_type: "general"
})
Task({
  description: "Research Echo AI Protection",
  prompt: "Research Echo AI Protection Systems: products, market, partnerships, tech stack",
  subagent_type: "general"
})

// After results return, spotcheck:
Task({
  description: "Spotcheck company research",
  prompt: "Review these 5 company research results for consistency and gaps: [results]",
  subagent_type: "QATester"
})
```

**Result:** 5 agents research in parallel, spotcheck validates consistency.

## Common Patterns

### Pattern 1: List Processing

**Input:** List of items (companies, files, URLs, people)
**Action:** Create one agent per item, identical task structure
**Routing:** Keep `Intern` for bounded grunt batches

```typescript
const items = ["Item1", "Item2", "Item3", "Item4", "Item5"];

// Single message with all agents:
items.forEach(item => {
  Task({
    description: `Process ${item}`,
    prompt: `Analyze ${item} for: [criteria]`,
    subagent_type: "Intern"
  });
});
```

### Pattern 2: Multi-File Analysis

**Input:** Multiple files to analyze
**Action:** One agent per file, same analysis criteria
**Routing:** `Pentester` for security analysis, `Engineer` for general code review
**Fallback:** Use `general` if no specialist clearly fits

```typescript
const files = ["src/auth.ts", "src/db.ts", "src/api.ts"];

// Single message:
files.forEach(file => {
  Task({
    description: `Analyze ${file}`,
    prompt: `Review ${file} for security issues, focusing on: [checklist]`,
    subagent_type: "Pentester"
  });
});
```

### Pattern 3: Data Point Investigation

**Input:** Multiple data points/questions
**Action:** One agent per question, independent research
**Routing:** Specialist-first, then `general`; use `Intern` only for broad grunt substeps

```typescript
const questions = [
  "What is OpenAI's current revenue?",
  "How many employees does Anthropic have?",
  "What's Google's AI chip roadmap?",
  "When is GPT-5 releasing?",
  "What's the latest on AI regulation in EU?"
];

// Single message:
questions.forEach(q => {
  Task({
    description: `Research: ${q}`,
    prompt: `Find reliable answer to: ${q}. Include sources.`,
    subagent_type: "general"
  });
});
```

## Spotcheck Pattern (Mandatory)

**WHY:** Parallel agents may produce inconsistent formats, miss details, or have conflicting information.

**WHEN:** After EVERY parallel agent batch completes

**HOW:**
```typescript
Task({
  description: "Spotcheck results",
  prompt: `Review these parallel results:

[Agent 1 results]
[Agent 2 results]
[Agent N results]

Verify:
- Consistent formatting
- No missing information
- No obvious errors
- No conflicting data

Flag any issues for follow-up.`,
  subagent_type: "QATester"
})
```

## Common Mistakes to Avoid

**❌ WRONG: Sequential execution**
```typescript
await Task({ ... }); // Agent 1 (blocks)
await Task({ ... }); // Agent 2 (waits for 1)
await Task({ ... }); // Agent 3 (waits for 2)
// Takes 3x as long!
```

**✅ RIGHT: Parallel execution**
```typescript
// Send ONE message with multiple Task calls:
Task({ ... })  // Agent 1
Task({ ... })  // Agent 2
Task({ ... })  // Agent 3
// All run simultaneously
```

**❌ WRONG: Using AgentFactory for generic agents**
```bash
# Overkill for simple parallel work
bun run AgentFactory.ts --traits "research,analytical"
```

**✅ RIGHT: Specialist-first routing with native fallback**
```typescript
// Substantive research defaults to specialist-first, then `general`
Task({
  description: "Research X",
  prompt: "Research X and report findings",
  subagent_type: "general"
})

// Use Intern only for bounded grunt work
Task({
  description: "Collect 50 plain-language URL summaries",
  prompt: "Summarize each URL in one sentence using this fixed template",
  subagent_type: "Intern"
})
```

**❌ WRONG: Skipping spotcheck**
```typescript
// Launch agents, get results, done
// No validation = potential inconsistencies
```

**✅ RIGHT: Always spotcheck**
```typescript
// Launch agents
// Get results
// Spotcheck for consistency
// THEN report as complete
```

**❌ WRONG: Passing unsupported extra arguments in Task calls**
```typescript
Task({ ..., subagent_type: "Intern", extra_option: "fast" })
```

**✅ RIGHT: Let runtime pick model; keep routing explicit**
```typescript
Task({ ..., subagent_type: "Intern" })
Task({ ..., subagent_type: "Intern" })
Task({ ..., subagent_type: "Intern" })
```

## Voice Output

All `Intern` agents in this workflow use the same voice:
- **Dev Patel** (d3MFdIuCfbAIwiu7jC4a)
- High-energy genius generalist
- 270 wpm speaking rate
- Enthusiastic and eager

This is intentional - for parallel grunt work, we don't need personality diversity. That's what custom agents are for.

## When to Use Custom Agents Instead

Use **CreateCustomAgent workflow** when:
- You need distinct personalities/perspectives
- Voice diversity matters (presenting results)
- Different analytical approaches required
- Each agent brings unique expertise

Use **SpawnParallelAgents workflow** when:
- Simple parallel processing
- Same task, different inputs
- Speed matters more than personality
- Voice diversity not needed

## Related Workflows

- **CreateCustomAgent** - For agents with unique personalities/voices
- **ListTraits** - Show available traits for custom agents

## References

- Agent personalities: `~/.config/opencode/skills/agents/AgentPersonalities.md`
- Intern agent definition: Line 277-287 in AgentPersonalities.md
- Delegation patterns: `~/.config/opencode/skills/PAI/Workflows/Delegation.md`
