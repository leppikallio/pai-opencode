# Quick Workflow

Fast single-round perspective check. Use for sanity checks and quick feedback.

## Prerequisites

- Topic or question to evaluate
- Optional: Custom council members

## Execution

### Step 1: Announce Quick Council

```markdown
## Quick Council: [Topic]

**Council Members:** [List agents]
**Mode:** Single round (fast perspectives)
**Execution:** REAL (subagents) | SIMULATED (no subagents)
**Task Evidence:** [task_id per member, REAL only]
```

### Step 2: Parallel Perspective Gathering

Launch all council members in parallel using `functions.task(...)` (one task per member), then wait for each output via `functions.background_output(...)`.

If you do not spawn tasks, you MUST label the run **SIMULATED** and ask for confirmation before proceeding.

#### Step 2A: Spawn Tasks (Required)

Create one task per council member. Record each returned `task_id`.

**Each agent prompt:**
```
You are [Agent Name], [brief role description].

QUICK COUNCIL CHECK

Topic: [The topic]

Give your immediate take from your specialized perspective:
- Key concern, insight, or recommendation
- 30-50 words max
- Be direct and specific

This is a quick sanity check, not a full debate.
```

Tool-call shape (example):

```ts
functions.task({
  description: "Quick council: Architect perspective",
  subagent_type: "Architect",
  prompt: "<prompt above, specialized for Architect>",
  run_in_background: true
})
```

#### Step 2B: Collect Outputs (Required)

Wait for each task to finish and capture the final text:

```ts
functions.background_output({ task_id, block: true })
```

### Step 3: Output Perspectives

```markdown
## Quick Council: [Topic]

**Council Members:** [List agents]
**Mode:** Single round (fast perspectives)
**Execution:** REAL (subagents)
**Task Evidence:** [task_id per member]

### Perspectives

**🏛️ Architect (Serena):**
[Brief take]

**🎨 Designer (Aditi):**
[Brief take]

**⚙️ Engineer (Marcus):**
[Brief take]

**🔍 Researcher (Ava):**
[Brief take]

### Quick Summary

**Consensus:** [Do they generally agree? On what?]
**Concerns:** [Any red flags raised?]
**Recommendation:** [Proceed / Reconsider / Need full debate]
```

## When to Escalate

If the quick check reveals significant disagreement or complex trade-offs, recommend:

```
⚠️ This topic has enough complexity for a full council debate.
Run: "Council: [topic]" for 3-round structured discussion.
```

## Timing

- Total: 10-20 seconds

## Done

Quick perspectives gathered. Use for fast validation; escalate to DEBATE for complex decisions.
