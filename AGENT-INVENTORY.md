# PAI Agent Types Inventory

**Comprehensive catalog of all available agent types in the Personal AI Infrastructure system.**

Last Updated: 2026-01-19

---

## Executive Summary

The PAI system provides **16 Task tool subagent types** optimized for different work domains:
- **5 Execution Agents** (Architect, Engineer, Designer, Explore, Plan) for code and design work
- **6 Research Agents** (PerplexityResearcher, GeminiResearcher, GrokResearcher, ClaudeResearcher, CodexResearcher, + legacy) for investigation
- **3 Testing/Security Agents** (QATester, Pentester, Pentester variants) for QA and security
- **2 Generic Agents** (Intern, general-purpose) for parallel grunt work

---

## Task Tool Subagent Types (Internal Workflow Use)

These are pre-built agents in Claude Code's Task tool, available for internal workflow execution. **Not for user-requested "custom agents."**

### Execution Agents

| Type | Capabilities | Model | Use Cases |
|------|--------------|-------|-----------|
| **Architect** | System design, architecture planning, infrastructure decisions | Opus | Complex distributed systems, long-term strategic planning, major refactors |
| **Engineer** | Code implementation, feature development, bug fixes | Sonnet | Writing TypeScript/Python, building features, implementing specifications |
| **Designer** | UX/UI design, user experience, interface specifications | Sonnet | Design mockups, interaction flows, visual specifications, design systems |
| **Explore** | Codebase exploration, file discovery, structure understanding | Haiku | Finding files, understanding code organization, generating inventory, searching repos |
| **Plan** | Implementation planning, task breakdown, approach design | Sonnet | Breaking down complex tasks, creating execution plans, identifying dependencies |

### Research Agents

| Type | Capabilities | Model | Use Cases |
|------|--------------|-------|-----------|
| **PerplexityResearcher** | Web research, current events, real-time data, citations with sources | Sonnet | Finding latest information, verifying current facts, discovering recent developments |
| **ClaudeResearcher** | Academic research, scholarly sources, professional backgrounds, peer-reviewed literature | Sonnet | Deep academic analysis, professional history, institutional knowledge, comprehensive records |
| **GeminiResearcher** | Multi-perspective analysis, parallel decomposition, cross-domain connections | Sonnet | Comparing multiple viewpoints, connecting unrelated concepts, synthesizing diverse sources |
| **GrokResearcher** | Contrarian analysis, fact-checking, verification of claims, skeptical review | Sonnet | Challenging assertions, fact-checking claims, identifying contradictions, risk assessment |
| **CodexResearcher** | Technical archaeology, code patterns, technical documentation, GitHub exploration | Sonnet | Finding code examples, discovering technical patterns, exploring open source, searching GitHub |

### Testing & Security Agents

| Type | Capabilities | Model | Use Cases |
|------|--------------|-------|-----------|
| **QATester** | Quality assurance, testing workflows, visual regression, functionality verification | Haiku/Sonnet | Browser testing, regression validation, functionality checks, visual verification |
| **Pentester** | Security testing, vulnerability assessment, penetration testing, threat modeling | Sonnet | Security assessments, vulnerability discovery, attack simulations, threat analysis |

### General Purpose Agents

| Type | Capabilities | Model | Use Cases |
|------|--------------|-------|-----------|
| **Intern** | General-purpose parallel work, multi-document analysis, parallel processing, high agency | Haiku/Sonnet | Parallel grunt work, research, analysis, coordination, investigation |
| **Explore** (General) | Generic codebase exploration | Haiku | Finding information in repos, searching codebases |

---

## Named Agents (Persistent Identities with Voices)

Named agents have rich backstories and mapped ElevenLabs voices for relationship continuity.

| Agent | Specialty | Voice Type | Use For |
|-------|-----------|-----------|---------|
| **Serena Blackwood** | System Architecture | Premium UK Female | Long-term architecture decisions |
| **Marcus Webb** | Technical Leadership | Premium Male | Strategic engineering leadership |
| **Rook Blackburn** | Security/Pentesting | Enhanced UK Male | Security testing with personality |
| **Dev Patel** | Parallel Work | High-Energy Genius | Parallel grunt work and coordination |
| **Ava Sterling** | Strategic Research | Premium US Female | High-level research and synthesis |
| **Alex Rivera** | Multi-Perspective Analysis | Analytical | Comprehensive cross-perspective analysis |
| **Ava Chen** | Investigation/OSINT | Investigative | People/company research and due diligence |
| **Priya Desai** | Visual/Creative Work | Aesthetic | Design, visual content, creative projects |
| **Aditi Sharma** | UX/Design Details | Design-Focused | Detailed design work, interaction design |
| **Emma Hartley** | Technical Writing | Technical Storyteller | Documentation, technical content, explanations |

---

## Custom Agents (Dynamic Composition via AgentFactory)

Custom agents are composed on-the-fly from traits. Each unique trait combination maps to a different ElevenLabs voice.

### Trait Categories

**Expertise** (domain knowledge):
`security`, `legal`, `finance`, `medical`, `technical`, `research`, `creative`, `business`, `data`, `communications`

**Personality** (behavior style):
`skeptical`, `enthusiastic`, `cautious`, `bold`, `analytical`, `creative`, `empathetic`, `contrarian`, `pragmatic`, `meticulous`

**Approach** (work style):
`thorough`, `rapid`, `systematic`, `exploratory`, `comparative`, `synthesizing`, `adversarial`, `consultative`

### Voice Mapping Examples

| Trait Combination | Example Voice | Reasoning |
|-------------------|---------------|-----------|
| contrarian + skeptical | Clyde (gravelly) | Challenging intensity |
| enthusiastic + creative | Jeremy (energetic) | High-energy creativity |
| security + adversarial | Callum (edgy) | Hacker character |
| analytical + meticulous | Charlotte (sophisticated) | Precision analysis |
| legal + cautious | Breeze (measured) | Legal formality |
| creative + exploratory | Aria (experimental) | Creative risk-taking |

---

## Model Assignment Reference

Always specify the appropriate model for agent execution:

| Task Type | Model | Speed vs Sonnet | Intelligence | Use When |
|-----------|-------|-----------------|--------------|----------|
| Grunt work, lookups, verification, file reads | **Haiku** | 10-20x faster | Sufficient for simple tasks | Parallel simple tasks, verification work |
| Standard implementation, moderate complexity, research, analysis | **Sonnet** | Baseline | Well-balanced | Most tasks (default for agents) |
| Deep reasoning, architecture, strategic decisions, complex planning | **Opus** | 3-5x slower | Maximum intelligence | Complex systems, strategic planning |

**Critical Rule:** Parallel agents especially benefit from `haiku` for speed and cost efficiency.

---

## Agent Selection Decision Tree

```
User Request
├─ "custom agents" or "specialized agents"?
│  └─ → Use Agents skill → CreateCustomAgent workflow → AgentFactory
├─ "agents" or "parallel agents"?
│  └─ → Use generic Intern agents (no custom personalities)
├─ "use [NamedAgent]" (e.g., "use Remy")?
│  └─ → Use Task tool with appropriate subagent_type
├─ "research" or "investigate"?
│  └─ → Choose research agent by domain:
│     ├─ "current events, latest" → PerplexityResearcher
│     ├─ "academic, scholarly" → ClaudeResearcher
│     ├─ "multiple perspectives" → GeminiResearcher
│     ├─ "verify, fact-check" → GrokResearcher
│     └─ "code, technical" → CodexResearcher
├─ Implementation or coding?
│  └─ → Use Engineer agent via Development skill
├─ Architecture or system design?
│  └─ → Use Architect agent (Opus model)
├─ Security testing?
│  └─ → Use Pentester agent
└─ Testing/QA?
   └─ → Use QATester agent
```

---

## Complete Task Tool Subagent Types Reference

### When to Use Each Type

**For Parallel Work:**
- `Intern` - Generic parallel grunt work (research, analysis, investigation)
- Use `model: "haiku"` for 10-20x speed improvement on simple tasks

**For Implementation:**
- `Engineer` - Writing code (TypeScript, Python, etc.)
- `Architect` - System design and infrastructure (use Opus model)
- `Designer` - UX/UI specifications and visual design

**For Investigation:**
- `PerplexityResearcher` - Current information, web search, real-time data
- `ClaudeResearcher` - Academic depth, scholarly research
- `GeminiResearcher` - Multi-perspective synthesis
- `GrokResearcher` - Fact-checking, verification, contrarian analysis
- `CodexResearcher` - Technical patterns, code archaeology

**For Exploration:**
- `Explore` - Finding files, understanding codebase structure

**For Quality:**
- `QATester` - Testing workflows, regression validation
- `Pentester` - Security assessment, vulnerability discovery

**For Planning:**
- `Plan` - Task breakdown, implementation planning

---

## Model Defaults by Agent Type

| Agent Type | Default Model | Override When |
|------------|---------------|----------------|
| Architect | Opus | (rarely override) |
| Engineer | Sonnet | (rarely override) |
| Designer | Sonnet | (rarely override) |
| Intern | Inherits parent | Always specify `model` parameter |
| PerplexityResearcher | Sonnet | Use `haiku` for parallel verification |
| ClaudeResearcher | Sonnet | (rarely override) |
| GeminiResearcher | Sonnet | (rarely override) |
| GrokResearcher | Sonnet | (rarely override) |
| CodexResearcher | Sonnet | (rarely override) |
| QATester | Sonnet | Use `haiku` for visual verification only |
| Pentester | Sonnet | (rarely override) |
| Explore | Haiku | (already optimal) |
| Plan | Sonnet | (rarely override) |

---

## Execution Examples

### Example 1: Parallel Research
```typescript
// Launch 5 research agents in parallel
Task({ 
  prompt: "Research company A financial health",
  subagent_type: "PerplexityResearcher",
  model: "sonnet",
  run_in_background: true 
})

Task({ 
  prompt: "Research company A academic publications",
  subagent_type: "ClaudeResearcher",
  model: "sonnet",
  run_in_background: true 
})

Task({ 
  prompt: "Research company A market position",
  subagent_type: "GeminiResearcher",
  model: "sonnet",
  run_in_background: true 
})

Task({ 
  prompt: "Verify company A claims and credentials",
  subagent_type: "GrokResearcher",
  model: "sonnet",
  run_in_background: true 
})

// Spotcheck after parallel work
Task({ 
  prompt: "Verify consistency across all research findings",
  subagent_type: "Intern",
  model: "haiku"
})
```

### Example 2: Architecture with Implementation
```typescript
// Design the architecture (Opus for deep thinking)
Task({ 
  prompt: "Design distributed caching strategy for this system",
  subagent_type: "Architect",
  model: "opus"
})

// Then implement (Sonnet for standard coding)
Task({ 
  prompt: "Implement the caching strategy in TypeScript",
  subagent_type: "Engineer",
  model: "sonnet"
})

// Verify with QA
Task({ 
  prompt: "Test cache invalidation scenarios",
  subagent_type: "QATester",
  model: "haiku"
})
```

### Example 3: Parallel Intern Verification
```typescript
// 3 parallel verification tasks
Task({ 
  prompt: "Check if feature X works on Chrome",
  subagent_type: "Intern",
  model: "haiku",
  run_in_background: true 
})

Task({ 
  prompt: "Check if feature X works on Firefox",
  subagent_type: "Intern",
  model: "haiku",
  run_in_background: true 
})

Task({ 
  prompt: "Check if feature X works on Safari",
  subagent_type: "Intern",
  model: "haiku",
  run_in_background: true 
})
```

---

## Critical Distinctions

### ❌ NEVER DO THIS:
```typescript
// WRONG - Task subagent_types are NOT custom agents
Task({ subagent_type: "Architect", prompt: "..." })
Task({ subagent_type: "Engineer", prompt: "..." })
```

When user says "custom agents", use the Agents skill:
```typescript
// RIGHT - Use Agents skill for custom composition
Skill("Agents")  // → CreateCustomAgent workflow
```

### ✅ DO THIS INSTEAD:
- User says "custom agents" → `Skill("Agents")` → CreateCustomAgent workflow
- User says "agents" (no custom) → Generic Intern agents
- Internal workflows → Task tool subagent_types

---

## Performance Metrics

### Speed Comparison (Single Execution)
| Model | Relative Speed | Use Case |
|-------|----------------|----------|
| Haiku | 1x (baseline - ~5-10 sec) | Simple verification |
| Sonnet | ~1.5-2x slower | Balanced implementation |
| Opus | ~4-8x slower | Deep reasoning |

### Parallel Execution Benefits
- 5 Haiku agents in parallel = **faster AND cheaper** than 1 Sonnet agent sequentially
- 10 parallel Haiku agents = ~50 seconds total vs 5+ minutes for sequential Sonnet
- **Rule:** Always parallelize when possible, especially with Haiku

---

## Model Selection Quick Reference

```
"That's a simple check" → haiku
"Standard coding task" → sonnet
"Complex architecture" → opus
"Parallel grunt work" → haiku
"Research task" → sonnet
"Verify/fact-check" → haiku or sonnet
```

---

## Integration Points

**Where agent types are defined:**
- Task tool subagent_types: `~/.opencode/skill/CORE/SYSTEM/PAIAGENTSYSTEM.md`
- Named agents: `~/.opencode/skill/Agents/AgentPersonalities.md`
- Custom agent traits: `~/.opencode/skill/Agents/Data/Traits.yaml`
- AgentFactory: `~/.opencode/skill/Agents/Tools/AgentFactory.ts`

**Skills that use agents:**
- Development - Engineer, Architect, Designer agents
- Research - All researcher agents
- OSINT - PerplexityResearcher, ClaudeResearcher, GeminiResearcher, GrokResearcher
- Agents - CreateCustomAgent, SpawnParallelAgents workflows
- Browser - QATester agent for web verification
- PrivateInvestigator - ClaudeResearcher, GeminiResearcher, GrokResearcher, CodexResearcher

---

## Troubleshooting

### Agent Not Responding
1. Check model parameter is set: `model: "haiku"|"sonnet"|"opus"`
2. Verify subagent_type spelling matches exactly (case-sensitive)
3. Confirm agent is appropriate for task domain

### Execution Too Slow
1. Check if `model` parameter is "opus" - consider downgrading to "sonnet"
2. Check if multiple agents could parallelize - use `run_in_background: true`
3. Verify Haiku is used for simple verification tasks

### Need Custom Personalities
1. User said "custom agents"? → Use Agents skill → CreateCustomAgent
2. Need specific voice? → AgentFactory maps trait combos to voices
3. Want consistent identity? → Use named agents (Serena, Marcus, etc.)

---

## Summary Table: All 16 Task Tool Subagent Types

| # | Type | Category | Model | Parallelizable | Key Use |
|---|------|----------|-------|----------------|---------| 
| 1 | Architect | Execution | Opus | No | System design |
| 2 | Engineer | Execution | Sonnet | Yes* | Code implementation |
| 3 | Designer | Execution | Sonnet | Yes | UX/UI design |
| 4 | Explore | Execution | Haiku | Yes | Codebase exploration |
| 5 | Plan | Execution | Sonnet | No | Task planning |
| 6 | PerplexityResearcher | Research | Sonnet | Yes | Web/current research |
| 7 | ClaudeResearcher | Research | Sonnet | Yes | Academic research |
| 8 | GeminiResearcher | Research | Sonnet | Yes | Multi-perspective analysis |
| 9 | GrokResearcher | Research | Sonnet | Yes | Fact-checking/verification |
| 10 | CodexResearcher | Research | Sonnet | Yes | Technical patterns |
| 11 | QATester | Testing | Sonnet | Yes | QA/testing workflows |
| 12 | Pentester | Security | Sonnet | No | Security testing |
| 13 | Intern | General | Variable | Yes | Parallel grunt work |
| 14 | Explore (General) | Exploration | Haiku | Yes | Generic exploration |
| 15 | *PerplexityResearch* | Research | Sonnet | Yes | Legacy variant |
| 16 | *CodexResearch* | Research | Sonnet | Yes | Legacy variant |

*Note: Engineer implementations should be sequential unless independent features.*

---

Generated: 2026-01-19 | Last Verified Against: CORE SKILL, PAIAGENTSYSTEM.md, THEALGORITHM Execute Phase
