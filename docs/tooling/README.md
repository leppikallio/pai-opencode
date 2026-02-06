# Tooling Scripts

This directory documents **PAI-OpenCode CLI tooling scripts** (mostly under `.opencode/skills/PAI/Tools/`).

## How to run these tools

Most tools are designed to run against the **installed runtime** under `~/.config/opencode`.

```bash
PAI_DIR="$HOME/.config/opencode" \
  bun run "$HOME/.config/opencode/skills/PAI/Tools/<ToolName>.ts" \
  --help
```

Tip: `PAI_DIR=...` lets you target a different tree (e.g., a local dev checkout).

## Documented tools

### Memory + learning

- [ExtractSessionLearnings](./ExtractSessionLearnings.md) — manual WORK → LEARNING extraction (prefers explicit **LEARN phase** notes)
- [VerifyMemoryWiring](./VerifyMemoryWiring.md) — read-only check that RAW/WORK artifacts exist for a session
- [TraceRawSession](./TraceRawSession.md) — read-only timeline trace of `MEMORY/RAW/*.jsonl`
- [ReplayRawSession](./ReplayRawSession.md) — offline normalization/replay analysis of `MEMORY/RAW/*.jsonl`
- [LearningPatternSynthesis](./LearningPatternSynthesis.md) — aggregate `LEARNING/SIGNALS/ratings.jsonl` into pattern reports

### Prompt + format helpers

- [PromptClassifier](./PromptClassifier.md) — pass-1 prompt classification (depth/capabilities/thinking-tools)

### Skills discovery

- [SkillSearch](./SkillSearch.md) — search `skill-index.json` to find the right skill

### Inference backend

- [Inference](./Inference.md) — unified inference tool (fast/standard/smart) used by other scripts

## Other scripts (not fully documented yet)

There are additional scripts under `.opencode/skills/PAI/Tools/` (banner rendering, media helpers, registries, indexing). If you want, tell me which ones you actually use and I’ll document the rest in the same format.
