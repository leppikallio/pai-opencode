# File-Based MCP Architecture

This document describes the "file-based MCP" approach used in this PAI distribution.

## Goal

Prefer **code-first modules** in `~/.config/opencode/` over token-heavy MCP tool calls when:

- The integration can be expressed as a deterministic library/API
- The result set is large and should be filtered in code
- The same integration will be used repeatedly

## Tool eagerness vs code-first (important nuance)

This doc is about avoiding *unnecessary* tool calls and moving stable integrations into code.

It does **not** mean “avoid MCP/web tools”. Use MCP/web tools eagerly when they reduce hallucinations, for example:

- time-sensitive questions (“latest”, “today”, “current”)
- tasks requiring citations or source grounding
- one-off data fetches where building code would be slower than using an existing MCP tool

## Pattern

1. Put code under `<~/.config/opencode/skills/<SkillName>/>` (e.g. `index.ts`, `Tools/*.ts`).
2. Use skills/workflows to orchestrate the code.
3. Return only filtered results to the model.

## Non-Goals

- This is not a requirement for every integration.
- Some workflows still call external tools or web fetches directly.
