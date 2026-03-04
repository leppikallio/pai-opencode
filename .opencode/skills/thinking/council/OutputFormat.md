# Output Format

Standard format for council debate transcripts.

## Execution Header (Required)

Every council output MUST declare whether it was run with real subagents.

```markdown
**Execution:** REAL (subagents) | SIMULATED (no subagents)
**Task Evidence:**
- Architect: <task_id>
- Designer: <task_id>
- Engineer: <task_id>
- Researcher: <task_id>
```

If SIMULATED, omit task IDs and explicitly say why (e.g., tasks unavailable) and ask for confirmation before proceeding.

## Full Debate Transcript

```markdown
## Council Debate: [Topic]

**Execution:** REAL (subagents)
**Task Evidence:** [task_id per member per round]

### Round 1: Initial Positions

**Architect (Serena):**
[Position from architectural perspective]

**Designer (Aditi):**
[Position from design perspective]

**Engineer (Marcus):**
[Position from implementation perspective]

**Researcher (Ava):**
[Position with data/precedent]

### Round 2: Responses & Challenges

**Architect (Serena):**
[Responds to specific points from Round 1]

**Designer (Aditi):**
[Responds to specific points from Round 1]

[...]

### Round 3: Synthesis

**Architect (Serena):**
[Final position, areas of agreement/disagreement]

[...]

### Council Synthesis

**Areas of Convergence:**
- [Points where multiple agents agreed]

**Remaining Disagreements:**
- [Points still contested]

**Recommended Path:**
[Synthesized recommendation]
```

## Quick Council Format

```markdown
## Quick Council: [Topic]

**Execution:** REAL (subagents)
**Task Evidence:** [task_id per member]

### Perspectives

**Architect (Serena):**
[Brief take - 30-50 words]

**Designer (Aditi):**
[Brief take]

[...]

### Quick Summary

**Consensus:** [Do they agree? On what?]
**Concerns:** [Red flags raised?]
**Recommendation:** [Proceed / Reconsider / Need full debate]
```

## Output Requirements

- **Length:** 50-150 words per agent per round (debate), 30-50 words (quick)
- **Tone:** Professional but direct; genuine challenges
- **Must Include:** Specific references to other agents' points in Round 2+
- **Must Avoid:** Generic opinions, restating initial position without engagement
- **Must Declare:** REAL vs SIMULATED execution mode
