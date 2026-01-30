# Scratchpad Policy (Binding)

Scratchpad root:

- `~/.config/opencode/scratchpad/` (or `$PAI_DIR/scratchpad/`)

Rules:

1. You MUST use the scratchpad for all temporary artifacts.
2. You MUST NOT write drafts, reviews, notes, or intermediate outputs into the current working directory.
3. For multi-agent handoffs, write/read files only under the scratchpad.
4. Use predictable handoff filenames:
   - `draft.md`
   - `review.md`
   - `iteration-01.md`
   - `final.md`
5. Only write outside scratchpad when explicitly instructed with an exact destination path.
