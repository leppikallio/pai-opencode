# Option C Implementation Approach (How we will actually execute)

## The core rule (why Option C is different)
Deep Research becomes a **first-class, programmatic subsystem** in OpenCode:
- orchestration is a state machine (not a giant prompt),
- artifacts are the source of truth (not chat transcript),
- gates are explicit and testable,
- every high-risk step has an automated reviewer checkpoint.

## Where work lives (repos)
We will touch **only** the PAI/OpenCode integration repo (and then install to runtime).

**We will not modify OpenCode core** (`/Users/zuul/Projects/opencode`).

Implementation repo:
- `/Users/zuul/Projects/pai-opencode-graphviz`

Reference implementation (legacy, read-only):
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured`

## Execution model (parallelization + reviewers)

### Work units
Every backlog item must have:
1) **deliverable** (file/code/tests),
2) **acceptance criteria**,
3) **evidence** (what proves it’s done),
4) **owner** (builder) and **reviewer**.

Testing requirement (Phase 01+):
- Every new functional entity (tool/command/orchestrator stage) must have an entity contract test that runs in isolation.
- Prefer fixtures/dry-run so tests do not require executing full research.
- Canonical strategy doc: `deep-research-option-c-testing-strategy-v1.md`.

### Builder/Reviewer pairing
- Builder produces the deliverable and runs self-validation.
- Reviewer validates against acceptance criteria and marks:
  - **PASS** (done) or
  - **CHANGES_REQUIRED** (explicit edits).

### Hard limits (prevents thrash)
- Review iterations: max 2 per deliverable before escalation.
- Backlog WIP: max 3 in_progress per workstream at a time.
- Fan-out caps: defined per mode (quick/standard/deep) and enforced by config.

## Quality gates (automation-first)
We will not “feel” our way through correctness.

Gates are defined in `spec-gate-thresholds-v1.md` and enforced by:
- offline harness (fixtures),
- integration runs (small canary queries),
- reviewer rubrics.

## Pause/Resume discipline

### Canonical tracker
`deep-research-option-c-progress-tracker.md` is the pause/resume source of truth.

### Recovery
If the session dies or compacts, we resume by reading:
1) tracker
2) recovery pack
3) current phase backlog

This is codified in `deep-research-option-c-recovery-pack.md`.

## Definition of “Concrete Plan” in this program
You should be able to answer “what happens next?” without conversation context.

That means:
- Phase 00 produces versioned schemas and rubrics.
- Every later phase has an executable backlog with owners/reviewers.
- Progress tracker lists active tasks and the next three actions.

## How we implement “first-class” without touching OpenCode core

OpenCode gives us supported extension surfaces:
- **Custom tools** (`.opencode/tools/` or global tools) — see OpenCode docs.
- **Commands** (`.opencode/commands/`) to expose UX entrypoints.
- **MCP servers** (already used by research-shell).
- **Plugins** (PAI already uses a unified plugin).

Option C will use these surfaces to create a **tool-driven stage machine**:

1) **Custom tools** implement deterministic steps:
   - run init + manifest create/update
   - gate computations (A–F)
   - citation extraction/normalization/validation
   - summary pack assembly and size enforcement
   - synthesis input preparation

2) A single **command** (`/deep-research` or `/research-adaptive`) orchestrates by:
   - calling the tools in the correct order,
   - spawning existing researcher agents (Task tool) between tool stages,
   - halting on hard-gate failures.

This achieves “first-class” behavior without upstreaming to OpenCode core.

## Planned extension surfaces (concrete paths)
- Commands (global install): `~/.config/opencode/commands/`
- Tools (global install): `~/.config/opencode/tools/`
- MCP (already present): `~/.config/opencode/mcp/`

In the implementation repo, we will add the corresponding source directories so Install can deploy them.
