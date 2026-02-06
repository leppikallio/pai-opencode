# Inference

Unified inference tool with three run levels:

- `fast` — light reasoning + short outputs
- `standard` — balanced
- `smart` — deeper reasoning + longer outputs

**Source:** `.opencode/skills/PAI/Tools/Inference.ts`

## Usage

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/Inference.ts" \
  --level standard \
  "<system prompt>" \
  "<user prompt>"
```

JSON mode:

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/Inference.ts" \
  --json --level fast \
  "<system prompt>" \
  "<user prompt>"
```

## Auth behavior

- Preferred: OpenCode server as carrier (reuses `opencode auth login` credentials)
- Fallback: direct OpenAI API via `OPENAI_API_KEY`
