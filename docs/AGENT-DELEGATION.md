# Agent Delegation Guide

**Version:** 0.4.1
**Status:** Complete
**Last Updated:** 2026-01-01

## Overview

PAI-OpenCode implements agent delegation using OpenCode's native agent system with a hybrid Task wrapper for backward compatibility. All 7 core PAI agents are available through both `@agent-name` syntax and the OpenCode UI picker.

## Available Agents

| Agent | Model | Purpose | Color |
|-------|-------|---------|-------|
| **intern** | haiku | High-agency parallel research, analysis, verification | Blue |
| **engineer** | sonnet | Code implementation, debugging, testing | Green |
| **architect** | sonnet | System design, PRDs, technical specifications | Purple |
| **researcher** | sonnet | Web research using specialized CLI tools | Cyan |
| **designer** | sonnet | UX/UI design, visual systems, accessibility | Pink |
| **pentester** | sonnet | Security testing, vulnerability assessment | Red |
| **writer** | sonnet | Content creation, documentation, technical writing | Yellow |

## Using Agents

### UI Picker (v0.4.1+)

All agents are now visible in OpenCode's `/agents` UI picker:

1. Type `/agents` in OpenCode
2. Select from the list of available agents
3. Agent files are located in `.opencode/agents/`

### @ Mention Syntax

Use `@agent-name` to invoke agents directly in conversation:

```
@engineer implement the authentication system from the PRD
@architect create specifications for the new feature
@intern research these 5 companies in parallel
```

### Task Wrapper (Backward Compatibility)

For PAI-compatible code, use the Task wrapper:

```typescript
import { Task } from './tools/task-wrapper';

// Single agent
await Task({
  subagent_type: "engineer",
  prompt: "Implement authentication system",
  model: "sonnet"
});

// Parallel agents
const tasks = [
  Task({ subagent_type: "intern", prompt: "Research company A", model: "haiku" }),
  Task({ subagent_type: "intern", prompt: "Research company B", model: "haiku" }),
  Task({ subagent_type: "intern", prompt: "Research company C", model: "haiku" })
];

await Promise.all(tasks);
```

## Agent Details

### Intern

**Best for:** Parallel execution, quick research, verification, file analysis

**Key capabilities:**
- 10-20x faster with haiku model
- Perfect for launching 5-10 instances simultaneously
- Research and information gathering
- Spotcheck patterns and validation

**Typical use:**
```
@intern check all agent configs were updated correctly
@intern read and summarize these 5 documentation files
```

### Engineer

**Best for:** Code implementation, debugging, testing, security

**Key capabilities:**
- Production-ready code with best practices
- TDD approach with comprehensive tests
- Performance optimization
- Security implementation (OWASP guidelines)

**Typical use:**
```
@engineer implement this feature from the PRD
@engineer debug this production issue and fix it
```

### Architect

**Best for:** System design, PRDs, technical specifications

**Key capabilities:**
- Comprehensive PRD creation
- System architecture design
- Feature breakdown with acceptance criteria
- API design and integration planning

**Typical use:**
```
@architect create a PRD for the new payment system
@architect design the architecture for microservices migration
```

### Researcher

**Best for:** Deep web research, competitive analysis, source verification

**Key capabilities:**
- Multi-source research using perplexity, gemini, openai CLI tools
- Fact-checking and source verification
- Market and competitive analysis
- Research report synthesis

**Typical use:**
```
@researcher find the latest best practices for AI agent systems
@researcher analyze competitors in the AI coding assistant market
```

### Designer

**Best for:** UX/UI design, visual systems, accessibility

**Key capabilities:**
- User flow and wireframe design
- Component libraries and design systems
- WCAG accessibility compliance
- Responsive design

**Typical use:**
```
@designer create the UX flow for user onboarding
@designer review this interface for accessibility issues
```

### Pentester

**Best for:** Security testing, vulnerability assessment, threat modeling

**Key capabilities:**
- OWASP Top 10 vulnerability testing
- Security code review
- Threat modeling and attack scenarios
- Compliance audits (GDPR, HIPAA, SOC2)

**Typical use:**
```
@pentester security audit this authentication system
@pentester test this API for vulnerabilities
```

### Writer

**Best for:** Content creation, documentation, blog posts

**Key capabilities:**
- Technical blog writing
- User documentation and API docs
- Release notes and announcements
- Content editing and clarity review

**Typical use:**
```
@writer create a blog post about our new feature
@writer write comprehensive user documentation for this API
```

## Agent Invocation Patterns

### Sequential Delegation

One agent completes before the next starts:

```
1. @architect creates PRD
2. @engineer implements from PRD
3. @pentester security audit
4. @writer creates documentation
```

### Parallel Delegation

Multiple agents work simultaneously:

```
Launch 5 @intern agents to research different companies
Each completes independently
Synthesize results when all finish
```

### Nested Delegation

Agents can delegate to other agents:

```
@architect designs system
  ↓ delegates to
@engineer implements
  ↓ delegates to
@pentester validates security
```

## Model Selection

| Model | Speed | Use Case |
|-------|-------|----------|
| **haiku** | 10-20x faster | Quick tasks, parallel execution, verification |
| **sonnet** | Balanced | Standard implementation, research, design |
| **opus** | Slowest but most capable | Complex reasoning, strategic planning |

**Recommendation:** Use haiku for @intern tasks, sonnet for most specialists, opus only when needed.

## Technical Implementation

### Agent File Location

All agent files are in `.opencode/agents/`:

```
.opencode/agents/
├── intern.md
├── engineer.md
├── architect.md
├── researcher.md
├── designer.md
├── pentester.md
└── writer.md
```

### Agent File Format

Each agent file contains:

```markdown
---
name: agent-name
description: Agent purpose and capabilities
model: haiku|sonnet|opus
color: color-name
voiceId: ElevenLabs-voice-ID
permissions:
  allow:
    - "Tool(*)"
---

# Agent Name - Role Description

[Agent instructions and identity]
```

### Task Wrapper Architecture

The Task wrapper (`Tools/task-wrapper.ts`) provides:

- Backward compatibility with PAI Task tool API
- OpenCode native agent delegation
- <10ms overhead
- Model selection preservation
- 19 passing unit tests

## Migration Notes

### v0.4.0 → v0.4.1

**What Changed:**
- Added physical agent files to `.opencode/agents/`
- Agents now visible in UI picker
- No behavior change (agents already worked via Task wrapper)

**Why:**
- v0.4.0 implemented agent delegation but didn't create agent files
- Agents worked via `@agent-name` but were invisible in UI
- v0.4.1 adds UI discoverability

**No action required** - existing code continues to work.

## Troubleshooting

### Agent Not Found

**Symptom:** "Agent X not found" error

**Solution:** Verify agent file exists in `.opencode/agents/X.md`

### Agent Not in UI Picker

**Symptom:** Agent works with `@mention` but not visible in UI

**Solution:**
1. Check agent file has proper YAML frontmatter
2. Restart OpenCode to reload agent definitions

### Task Wrapper Not Working

**Symptom:** Task wrapper throws errors

**Solution:**
1. Verify `Tools/task-wrapper.ts` exists
2. Check import path is correct
3. Run tests: `bun test Tools/task-wrapper.test.ts`

## Related Documentation

- [CHANGELOG.md](../CHANGELOG.md) - Version history including v0.4.0 and v0.4.1
- [ROADMAP.md](../ROADMAP.md) - Future agent system enhancements
- [Tools/task-wrapper.ts](../Tools/task-wrapper.ts) - Task wrapper implementation
- [Tools/task-wrapper.test.ts](../Tools/task-wrapper.test.ts) - Unit tests

## References

- **PAI 2.0 Agents:** `vendor/PAI/Packs/kai-agents-skill/`
- **OpenCode Agent Docs:** [OpenCode Documentation](https://opencode.ai/docs/agents)
- **Research:** `research/SYNTHESIS.md` - Full platform comparison
