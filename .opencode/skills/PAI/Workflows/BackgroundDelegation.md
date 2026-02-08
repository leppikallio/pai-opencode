# Background Delegation Workflow

Launch parallel Task calls while you continue working.

## Triggers

- "background agents", "spin up background agents"
- "in the background", "while I work"
- "background research", "background:"
- "parallel background agents"

## How It Works

1. Parse the task(s) to delegate
2. Launch each agent as a normal Task call
3. Continue working while tasks run
4. Collect results when each Task completes

## Launching Background Agents

OpenCode does not expose a background execution flag in the Task tool.
To emulate background work, run multiple Task calls and keep working while they execute.

```typescript
Task({
  description: "Research OpenAI news",
  prompt: "Research the latest OpenAI developments...",
  subagent_type: "PerplexityResearcher"  // must exist as an agent name
})
```

**Model Selection for Delegated Agents:**
- The Task tool input does not include a `model` field.
- Model selection is controlled by the agent configuration itself.

## Checking Status

OpenCode does not provide a separate Task output retrieval tool.
Task outputs are returned in-band when the Task call completes.

## Retrieving Results

Task outputs are returned as the Task tool result.
Additionally, the runtime plugin captures Task outputs to `~/.config/opencode/MEMORY/RESEARCH/`.

## Example Flows

### Newsletter Research

```
User: "I'm writing the newsletter. Background agents research
       the OpenAI drama, Anthropic's new model, and Google's update."

→ Launches 3 background agents in parallel
→ Reports agent IDs and what each is researching
→ User continues writing
→ User checks "Background status" periodically
→ User retrieves results when ready
```

### OSINT Investigation

```
User: "Background agents investigate John Smith, Jane Doe,
       and Acme Corp for due diligence."

→ Launches 3 Intern agents with OSINT prompts
→ User continues other work
→ Status check shows 2/3 complete
→ Results retrieved when ready
```

### Code Exploration

```
User: "Background agents explore the codebase for
       auth patterns, API endpoints, and test coverage."

→ Launches 3 Explore agents
→ Reports what each is analyzing
→ User continues coding
```

## Best Practices

1. **Use for parallel work** - When you have 3+ independent tasks
2. **Pick the right model** - Haiku for speed, Sonnet for quality
3. **Don't over-spawn** - 3-5 agents is usually optimal
4. **Check periodically** - Poll status every few minutes if curious
5. **Retrieve when needed** - Don't wait for completion unless you need results

## Contrast with Foreground Delegation

| Aspect | Foreground (default) | Background |
|--------|---------------------|------------|
| Blocking | Yes - waits for each | No dedicated background mode |
| When to use | Need results now | Can work on other things |
| Syntax | Normal Task call | (no background flag) |
| Retrieval | Automatic | In-band Task result |

## Integration

- Works with all agent types: Intern, Researchers, Explore, etc.
- Combine with research skill for background research workflows
- Use with osint skill for parallel investigations
- Pairs well with newsletter/content workflows

