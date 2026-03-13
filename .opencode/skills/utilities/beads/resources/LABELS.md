# Labels in Beads

Labels provide flexible issue categorization beyond structured fields (`status`, `priority`, `type`).

## Quick Start

```bash
# Add labels when creating issues
bd create "Fix auth bug" -t bug -p 1 -l auth,backend,urgent

# Add/remove labels
bd label add bd-42 needs-review
bd label remove bd-42 urgent

# List labels
bd label list bd-42
bd label list-all

# Filter by labels
bd list --label backend,auth          # AND (must have all)
bd list --label-any frontend,backend  # OR (must have any)
```

## Label Patterns

- `component`: `backend`, `frontend`, `api`, `database`, `cli`
- `domain`: `auth`, `payments`, `search`, `analytics`
- `effort`: `small`, `medium`, `large`
- `quality`: `needs-review`, `needs-tests`, `needs-docs`
- `release`: `v1.0`, `v2.0`, `release-blocker`, `backport-candidate`

## Filtering Semantics

`--label` requires all listed labels:

```bash
bd list --label backend,urgent
bd list --status open --type bug --label needs-review,needs-tests
```

`--label-any` matches at least one listed label:

```bash
bd list --label-any frontend,backend
bd list --label-any security,auth
```

Combine both for precise queries:

```bash
bd list --label backend --label-any urgent,release-blocker
```

## Best Practices

1. Keep labels lowercase and hyphenated (`good-first-issue`).
2. Reuse a small shared taxonomy to avoid drift.
3. Prefer labels for categorization, not sentence-like notes.
4. Use labels with dependencies to organize large epics.

## See Also

- [CLI_REFERENCE.md](CLI_REFERENCE.md) - Full command reference
- [AGENTS.md](AGENTS.md) - Agent-oriented workflows
- [README.md](../README.md) - Beads skill overview
