# spec-install-layout-v1 (P01-01)

## Purpose
Define the **exact file/folder layout** in the implementation repo so that Option C is deployable **globally** to:
- `~/.config/opencode/commands/`
- `~/.config/opencode/tools/`

## Non-negotiables
- **No changes to OpenCode core** (`/Users/zuul/Projects/opencode`).
- **No direct edits** under `~/.config/opencode/` for implementation work.
- Deployment happens by installing from the implementation repo.

## Evidence (what this is based on)
- OpenCode commands doc states global commands live in `~/.config/opencode/commands/`:
  - `/Users/zuul/Projects/opencode/packages/web/src/content/docs/commands.mdx` ("Global: `~/.config/opencode/commands/`")
- OpenCode custom tools doc states global tools live in `~/.config/opencode/tools/`:
  - `/Users/zuul/Projects/opencode/packages/web/src/content/docs/custom-tools.mdx`
- PAI installer copies this repo’s `.opencode/` into `~/.config/opencode/`:
  - `/Users/zuul/Projects/pai-opencode-graphviz/Tools/Install.ts` (Source tree `<repo>/.opencode/`, Runtime tree `~/.config/opencode/`)

## Repository layout (source of truth)
Implementation repo: `/Users/zuul/Projects/pai-opencode-graphviz`

Add (if not already present):
```text
<repo>/.opencode/
  commands/
    deep-research.md
    deep-research-status.md
  tools/
    deep_research.ts
```

Notes:
- Tool filenames define tool names (see OpenCode custom tools docs).
- Multiple exports per file become tools named `<filename>_<exportname>`.
  - Example: `.opencode/tools/deep_research.ts` exporting `run_init` becomes `deep_research_run_init`.
- Phase 01 keeps Option C tooling in a single entry file to preserve stable tool names.

## Runtime layout (installed)
After running installer, we expect:
```text
~/.config/opencode/
  commands/
    deep-research.md
    deep-research-status.md
  tools/
    deep_research.ts
```

## Install workflow
1. Make changes in repo `.opencode/{commands,tools,...}`.
2. Deploy into runtime using the repo installer:
   - `bun Tools/Install.ts --target "/Users/zuul/.config/opencode"`

## Acceptance criteria
- A new global command appears under `~/.config/opencode/commands/` after install.
- A new global tool appears under `~/.config/opencode/tools/` after install.
- No OpenCode core edits required.

## Evidence
This document defines:
- exact source + runtime paths,
- deployment workflow,
- acceptance criteria.
