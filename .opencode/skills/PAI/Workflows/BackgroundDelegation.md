# Background Delegation Workflow

Launch parallel `functions.task` calls while you continue working.

## Triggers

- "background agents", "spin up background agents"
- "in the background", "while I work"
- "background research", "background:"
- "parallel background agents"

## How It Works

1. Parse the task(s) to delegate
2. Launch each agent as a normal `functions.task` call
3. Continue working while calls execute
4. Collect results when each `functions.task` call completes

## Launching Background Agents

OpenCode does not expose a background execution flag in the Task tool.
To emulate background work, run multiple `functions.task` calls and keep working while they execute.

```typescript
functions.task({
  description: "Research OpenAI news",
  prompt: "Research the latest OpenAI developments...",
  subagent_type: "researcher"  // use an available runtime subagent type
})
```

**Model Selection for Delegated Agents:**
- The Task tool input does not include a `model` field.
- Model selection is controlled by the agent configuration itself.

## Checking Status

OpenCode does not provide a separate Task output retrieval tool.
Task outputs are returned in-band when the `functions.task` call completes.

## Retrieving Results

Task outputs are returned as the Task tool result.
Additionally, the runtime plugin captures Task outputs to `~/.config/opencode/MEMORY/RESEARCH/`.

## Example Flows

### Newsletter Research

```
User: "I'm writing the newsletter. Background agents research
       the latest OpenAI, xAI, and Google updates."

→ Launches 3 background agents in parallel
→ Reports agent IDs and what each is researching
→ User continues writing
→ User retrieves in-band results as each `functions.task` call completes
```

### OSINT Investigation

```
User: "Background agents investigate John Smith, Jane Doe,
       and Acme Corp for due diligence."

→ Launches 3 Intern agents with OSINT prompts
→ User continues other work
→ User continues other work until task results return
→ Results are consumed in-band on completion
```

### Code Exploration

```
User: "Background agents explore the codebase for
       auth patterns, API endpoints, and test coverage."

→ Launches 3 `explore` agents
→ Reports what each is analyzing
→ User continues coding
```

## Best Practices

1. **Use for parallel work** - When you have 3+ independent tasks
2. **Pick the right subagent** - choose by task type and risk level
3. **Don't over-spawn** - 3-5 agents is usually optimal
4. **No separate status API** - rely on in-band Task completion results
5. **Retrieve when needed** - consume results as each Task returns

## Contrast with Foreground Delegation

| Aspect | Foreground (default) | Background |
|--------|---------------------|------------|
| Blocking | Yes - waits for each | No dedicated background mode |
| When to use | Need results now | Can work on other things |
| Syntax | Normal `functions.task` call | (no background flag) |
| Retrieval | Automatic | In-band task result |

## Integration

- Works with all agent types: Intern, researcher, explore, Engineer, etc.
- For codebase exploration specifically, use `subagent_type: "explore"` (not researcher variants).
- Combine with research skill for background research workflows
- Use with osint skill for parallel investigations
- Pairs well with newsletter/content workflows
