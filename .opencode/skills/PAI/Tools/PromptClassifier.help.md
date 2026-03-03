# PromptClassifier

Fast pass-1 prompt classification (optional).

## Usage

```bash
bun ~/.config/opencode/skills/PAI/Tools/PromptClassifier.ts "<user prompt>"
```

## Output

Prints JSON to stdout:

- `depth`: `MINIMAL` | `ITERATION` | `FULL`
- `reasoning_profile`: `light` | `standard` | `deep`
- `verbosity`: `minimal` | `standard` | `detailed`
- `capabilities`: suggested agent/capability labels
- `thinking_tools`: suggested thinking tools

## Inference Backend

It uses the shared `Inference.ts` backend with this intentional preset:

- `level`: `fast`
- `timeout`: `2000ms` (intentional quick-pass budget)
- `model`: `openai/gpt-5.2` (explicit override)
- `reasoningEffort` / `textVerbosity` / `steps`: not set by this classifier; OpenCode/provider defaults apply unless another layer overrides them

Auth behavior:
- Carrier: OpenCode server only (the OpenCode server performs provider auth using your `opencode auth login` session)
- No direct `OPENAI_API_KEY` path in this classifier
- If carrier inference fails or returns invalid output, it falls back to deterministic heuristics.
