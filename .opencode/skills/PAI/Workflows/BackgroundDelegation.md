# Background Delegation Workflow

Launch parallel `functions.task` calls while you continue working.

## Triggers

- "background agents", "spin up background agents"
- "in the background", "while I work"
- "background research", "background:"
- "parallel background agents"

## How It Works

1. Parse the task(s) to delegate
2. Launch each agent with `run_in_background: true`
3. Continue working while calls execute
4. Check status/results with `background_output` using `task_id`

## Launching Background Agents

OpenCode supports explicit async launch through the Task tool extension `run_in_background: true`.
Use specialist-first routing, then `general` fallback, and reserve `Intern` for broad parallel grunt work.

```typescript
functions.task({
  description: "Background intake triage",
  prompt: "Classify new requests by implementation, design, QA, and unknown.",
  subagent_type: "general",
  run_in_background: true,
})
```

**Model Selection for Delegated Agents:**
- The Task tool input does not include a `model` field.
- Model selection is controlled by the agent configuration itself.

## Checking Status

Use `background_output` with the returned `task_id`.

## Retrieving Results

- `background_output({ task_id: "bg_..." })` returns current state and completed output.
- Results are also persisted in runtime background-task state for completion notifications.

## Example Flows

### Newsletter Research

```
User: "I'm writing the newsletter. Background agents research
       the latest OpenAI, xAI, and Google updates."

→ Launches 3 background agents in parallel
→ Reports agent IDs and what each is researching
→ User continues writing
→ User checks progress with `background_output` and consumes results when ready
```

### OSINT Investigation

```
User: "Background agents investigate John Smith, Jane Doe,
       and Acme Corp for due diligence."

→ Launches 3 OSINT-specialist agents when available, otherwise `general`; reserves `Intern` for broad grunt-only substeps
→ User continues other work
→ User checks `background_output` for each task_id
→ Results are consumed when each background task finishes
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
2. **Pick the right subagent** - specialist first, then `general`; reserve `Intern` for broad grunt work
3. **Don't over-spawn** - 3-5 agents is usually optimal
4. **Track status explicitly** - use `background_output` and keep task IDs
5. **Cancel when needed** - use `background_cancel` for stale or superseded work

## Contrast with Foreground Delegation

| Aspect | Foreground (default) | Background |
|--------|---------------------|------------|
| Blocking | Yes - waits for each | No - returns immediately with `task_id` |
| When to use | Need results now | Can work on other things |
| Syntax | Normal `functions.task` call | `functions.task({... run_in_background: true })` |
| Retrieval | Inline task result | `background_output(task_id)` |

## Integration

- Works with all runtime subagent types (`general`, Intern, explore, Engineer, etc.).
- For codebase exploration specifically, use `subagent_type: "explore"`.
- Combine with research skill for background research workflows
- Use with osint skill for parallel investigations
- Pairs well with newsletter/content workflows
