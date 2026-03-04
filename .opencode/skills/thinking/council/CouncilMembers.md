# Council Members

Reference for council member roles, perspectives, and voice assignments.

## Default Council Members

| Role | Perspective | Task subagent_type | Voice |
|------|-------------|-------------------|-------|
| **Architect** | System design, patterns, long-term | `Architect` | Serena Blackwood |
| **Designer** | UX, user needs, accessibility | `Designer` | Aditi Sharma |
| **Engineer** | Implementation reality, tech debt | `Engineer` | Marcus Webb |
| **Researcher** | Data, precedent, external examples | `PerplexityResearcher` | Ava Chen |

## Optional Members

Add these as needed based on the topic:

| Agent | Perspective | When to Add |
|-------|-------------|-------------|
| **Security** | Risk, attack surface, compliance | Auth, data, APIs |
| **Intern** | Fresh eyes, naive questions | Complex UX, onboarding |
| **Writer** | Communication, documentation | Public-facing, docs |

## Agent Type Mapping

| Council Role | Task subagent_type | Personality |
|--------------|-------------------|-------------|
| Architect | Architect | Serena Blackwood |
| Designer | Designer | Aditi Sharma |
| Engineer | Engineer | Marcus Webb |
| Researcher | PerplexityResearcher | Ava Chen |
| Security | Pentester | Rook Blackburn |
| Intern | Intern | Dev Patel |
| Writer | (use Intern with writer prompt) | Emma Hartley |

## Required Operational Rule

For a **REAL** council run, you MUST spawn one task per selected member using `functions.task(...)` and wait for results with `functions.background_output(...)`.

If you do not spawn tasks, label the run **SIMULATED** and ask for confirmation before proceeding.

## Custom Council Composition

- "Council with security" - Add pentester agent
- "Council with intern" - Add intern for fresh perspective
- "Just architect and engineer" - Only specified members
