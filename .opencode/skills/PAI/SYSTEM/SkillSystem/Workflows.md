> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: Workflow routing contract and workflow runbook structure for skills.

<!-- SKILLSYSTEM:WORKFLOWS:v1 -->

# SkillSystem — Workflows

Workflows are **execution runbooks**: step-by-step procedures for doing work (create, update, deploy, sync, migrate, etc.).

They live under:

- Runtime: `/Users/zuul/.config/opencode/skills/<SkillName>/Workflows/`

## What a workflow is (and is not)

### Workflows ARE

- Operational procedures you can “run” (follow step-by-step).
- Deterministic instructions (inputs → steps → verification → outputs).
- The place where **user intent is interpreted** into concrete actions (including tool flags).

### Workflows are NOT

- Reference/background docs.
- Specifications/schemas (unless the schema is required to execute the work).
- Long-form explanations.

Reference docs belong in the **skill root** and should be loaded explicitly via `Read` (or discovered via `glob` then `Read`).

## Naming + placement rules

- Workflow filenames MUST be **TitleCase** and match the workflow name exactly (e.g., `<Workflows/SyncRepo.md>`).
- Workflow names SHOULD be verbs (Create, UpdateInfo, SyncRepo, Publish, ValidateSkill, etc.).
- Workflows MUST live directly under `Workflows/` (no nested workflow subdirectories).

## Workflow routing table contract (SKILL.md)

Every skill that uses workflows MUST include a `## Workflow Routing` table in `SKILL.md`.

### Required columns

| Column | Type | Contract |
|---|---|---|
| `Workflow` | TitleCase identifier | MUST match the workflow file name (sans extension). |
| `Trigger` | intent description | Short, human-readable cues; avoid brittle string matching. |
| `File` | path | Backticked path to the workflow file. |

### Required formatting

- `Workflow` MUST be TitleCase (PascalCase). Prefer bold for scanability.
- `File` MUST be a backticked path. Recommended: relative path from skill root (e.g., `<Workflows/Create.md>`).
- Each workflow listed MUST exist as a file at that path.

### Minimal example

```md
## Workflow Routing

| Workflow | Trigger | File |
|---|---|---|
| **Create** | new, draft, write | `<Workflows/Create.md>` |
| **UpdateInfo** | update, change, edit | `<Workflows/UpdateInfo.md>` |
| **SyncRepo** | sync, pull, mirror | `<Workflows/SyncRepo.md>` |
```

### Routing guidance

- Prefer **intent matching**, not exact phrase matching.
- Keep triggers short. They are cues, not a comprehensive keyword dump.
- If multiple workflows could apply, pick the **most specific** one; if still ambiguous, ask a clarifying question.

## Workflow document structure (runbook contract)

Every workflow file SHOULD follow this structure so it is executable and verifiable.

### Recommended sections

```md
# WorkflowName

## Purpose

## Inputs

## Steps

## Verify

## Output
```

### Section contracts

#### Inputs

- List required inputs explicitly (files, URLs, IDs, environment assumptions).
- Prefer absolute runtime paths when pointing to system docs.
- If the exact file path is unknown, discover it with `glob` and then `Read` the resolved path.

#### Verify

- For correctness-critical or state-changing work: concrete checks that can fail/pass quickly.
- Prefer evidence-producing verification (tool output, exit codes, screenshots where applicable).
- If a workflow claims a tool ran, it MUST include the command/tool call that produces the evidence.

For pure writing/creative workflows:

- `## Verify` is optional (no external verification required).
- If included, it should be a short self-check rubric (constraints met, tone, length, etc.).

## Intent-to-flag mapping (workflow-to-tool integration)

Workflows SHOULD map user intent to tool flags rather than hardcoding a single invocation.

If you need additional guidance on CLI-first patterns, `Read`:

- `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/CLIFIRSTARCHITECTURE.md`

## Workflow vs reference doc (decision rule)

Use a **workflow** when:

- The content is a procedure.
- It changes state or produces artifacts.
- Verification steps matter.

Use a **reference doc** (in skill root) when:

- The content is background, schema, naming rules, conventions, or constraints.
- It is primarily read-only context.

Discovery/load contract for reference docs:

- Prefer explicit `Read` with absolute runtime paths.
- If you need discovery: `glob` for `*.md` under the skill root, then `Read` the exact file.
