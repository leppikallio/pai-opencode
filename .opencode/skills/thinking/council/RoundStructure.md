# Round Structure

How council debates progress through rounds.

## Three-Round Debate Structure

### Round 1 - Initial Positions

Each agent gives their take from their specialized perspective. No interaction yet - just establishing positions.

**Goal:** Surface diverse viewpoints before interaction.

Operationally:
- Spawn one `functions.task(...)` per council member.
- Wait for each via `functions.background_output(...)`.
- Do not start Round 2 until you have the Round 1 transcript.

### Round 2 - Responses & Challenges

Each agent reads Round 1 transcript and responds to specific points:
- "I disagree with Architect's point about X because..."
- "Building on Designer's concern about Y..."

**Goal:** Genuine intellectual friction through direct engagement.

Operationally:
- Include the full Round 1 transcript in each Round 2 task prompt.
- Do not start Round 3 until you have the full Round 2 transcript.

### Round 3 - Synthesis & Convergence

Each agent identifies:
- Where the council agrees
- Where they still disagree
- Their final recommendation given the full discussion

**Goal:** Surface convergence and remaining tensions honestly.

Operationally:
- Include Round 1 + Round 2 transcript in each Round 3 task prompt.
- After Round 3, write a short synthesis as the orchestrator.

Timeouts / Missing Agents:
- If a task fails or times out, label it clearly in the transcript and proceed only if the user accepts reduced coverage.

## The Value Is In Interaction

Not just collecting opinions - genuine challenges where:
- Architect challenges designer's assumption
- Engineer points out implementation cost
- Researcher cites precedent that changes framing
- Designer defends with user impact data

## Timing

| Phase | Duration | Parallelism |
|-------|----------|-------------|
| Round 1 | 10-20 sec | All agents parallel |
| Round 2 | 10-20 sec | All agents parallel |
| Round 3 | 10-20 sec | All agents parallel |
| Synthesis | 5 sec | Sequential |

**Total: 30-90 seconds for full debate**
