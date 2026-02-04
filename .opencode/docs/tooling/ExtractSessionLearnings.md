# ExtractSessionLearnings

Manual, loop-safe extraction of “wisdom” from a work session into `MEMORY/LEARNING/`.

This exists because OpenCode lifecycle hooks can be risky (event ordering, missed stop events, infinite-loop class failures). Instead of relying on automatic “session end” extraction, this tool lets you **run learning capture on-demand**.

## What it does

- Reads a session’s work directory under `MEMORY/WORK/<YYYY-MM>/<sessionId>/`
- Extracts learnings from:
  - **LEARN phase notes** in `THREAD.md` (preferred, low-noise)
  - An **ISC completion summary** from `ISC.json`
- Optionally persists the extracted learnings as Markdown files under `MEMORY/LEARNING/<CATEGORY>/<YYYY-MM>/`

## Usage

> Tip: set `PAI_DIR` to target runtime vs source tree.

### Preview extracted learnings (no writes)

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts" \
  ses_...
```

### Extract from latest session

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts" \
  --latest
```

### Persist learnings into MEMORY/LEARNING

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts" \
  --latest --persist
```

### Noisier extraction (also scans for “Learning:” markers)

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/ExtractSessionLearnings.ts" \
  --latest --include-markers --persist
```

## Output

When `--persist` is used, this tool writes files like:

```
MEMORY/LEARNING/
  RESPONSE/2026-02/20260204_175627_learn-phase-notes.md
  ALGORITHM/2026-02/20260204_175627_isc-completion-summary.md
```

## Categories

The tool classifies learnings into:

- `ALGORITHM` (process improvements, ISC/phase learnings)
- `SYSTEM` (infrastructure, plugins, config)
- `CODE` (code patterns, bugfixes)
- `RESPONSE` (format, style, voice)
- `GENERAL` (everything else)

## Best practices (low risk)

1) Prefer putting real “wisdom” into the **LEARN phase** of the response; this is what extraction is optimized for.
2) Run `--persist` at the end of a meaningful session (or once per day).
3) Keep risky hooks/feature flags off; treat automatic extraction as best-effort.

## Related tools

- `VerifyMemoryWiring.ts` — check RAW/WORK artifacts exist for a session
- `TraceRawSession.ts` — inspect RAW event ordering without enabling new hooks
- `LearningPatternSynthesis.ts` — aggregate ratings into patterns
