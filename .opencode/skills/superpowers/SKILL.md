---
name: superpowers
description: Superpowers third-party process skills integration. USE WHEN you want Superpowers workflows available inside PAI/OpenCode.
---

# Superpowers (PAI Adapter)

This PAI installation includes the **obra/superpowers** skill library (vendored into this repo; no changes to the upstream repo are required).

## What you get

- The Superpowers skills are installed as **first-class OpenCode skills** (same names as upstream).
- A small **bootstrap** is auto-injected by the PAI plugin so these skills are discoverable without manual setup.

## Important: PAI format still wins

- **PAI Algorithm response format is mandatory.** Do not output anything that violates it.
- Use Superpowers skills as *process runbooks* that complement PAI (design-first, systematic debugging, TDD).

## Tool mapping (Superpowers → PAI/OpenCode)

- `TodoWrite` → `functions.todowrite`
- `Task` (subagents) → `functions.task`
- `Skill` tool → `functions.skill` (load a skill)
- File ops → `functions.read` / `functions.grep` / `functions.glob` / `functions.apply_patch`
- Shell → `functions.bash`

## Included Superpowers skills (imported)

- brainstorming
- systematic-debugging
- test-driven-development
- writing-plans
- executing-plans
- subagent-driven-development
- dispatching-parallel-agents
- requesting-code-review
- receiving-code-review
- verification-before-completion
- using-git-worktrees
- finishing-a-development-branch
- writing-skills
- using-superpowers

## Usage

Load a specific skill when it applies (or ask me to load it):

- `functions.skill({ name: "brainstorming" })`
- `functions.skill({ name: "systematic-debugging" })`
