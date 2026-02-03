# PromptClassifier

Fast pass-1 prompt classification (optional).

## Usage

```bash
bun ~/.config/opencode/skills/CORE/Tools/PromptClassifier.ts "<user prompt>"
```

## Output

Prints JSON to stdout:

- `depth`: `MINIMAL` | `ITERATION` | `FULL`
- `reasoning_profile`: `light` | `standard` | `deep`
- `verbosity`: `minimal` | `standard` | `detailed`
- `capabilities`: suggested agent/capability labels
- `thinking_tools`: suggested thinking tools

## OpenAI

It uses `openai/gpt-5.2` through the shared `Inference.ts` backend.

Auth behavior:
- Preferred: OpenCode carrier (reuses `opencode auth login` credentials)
- Fallback: direct OpenAI API if `OPENAI_API_KEY` is set
- If neither is available, it falls back to deterministic heuristics.
