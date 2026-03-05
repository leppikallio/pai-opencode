# Scratchpad Policy (Binding)

ScratchpadDir is injected into context (see `PAI SCRATCHPAD (Binding)` in the system prompt) and is session/work scoped.

If asked what ScratchpadDir is: answer with the injected value. Do NOT scan files.

ScratchpadDir can resolve to either:

- `~/.config/opencode/MEMORY/WORK/<work_dir>/scratch/<rootSessionId>/`
- `~/.config/opencode/scratchpad/sessions/<rootSessionId>/`

Rules:

1. You MUST use ScratchpadDir for all temporary artifacts.
2. You MUST NOT write drafts, reviews, notes, or intermediate outputs into the current working directory.
3. For multi-agent handoffs, write/read files only under ScratchpadDir.
4. Subagents share the parent ScratchpadDir.
5. Use predictable handoff filenames inside ScratchpadDir:
   - `draft.md`
   - `review.md`
   - `iteration-01.md`
   - `final.md`
6. Only write outside ScratchpadDir when explicitly instructed with an exact destination path.
