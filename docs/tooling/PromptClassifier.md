# PromptClassifier

Fast pass-1 prompt classification (optional).

**Source:** `.opencode/skills/PAI/Tools/PromptClassifier.ts`

## Usage

```bash
bun run "$HOME/.config/opencode/skills/PAI/Tools/PromptClassifier.ts" "<user prompt>"
```

## Output

Prints JSON to stdout, including:

- `depth`: `MINIMAL` | `ITERATION` | `FULL`
- `reasoning_profile`: `light` | `standard` | `deep`
- `verbosity`: `minimal` | `standard` | `detailed`
- `capabilities`: suggested agent/capability labels
- `thinking_tools`: suggested thinking tools

## Backend

Uses `openai/gpt-5.2` through the shared [Inference](./Inference.md) backend.
