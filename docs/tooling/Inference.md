# Inference

Unified inference tool with three run levels.

## Presets

`Inference.ts` presets control timeout + system guidance. They do **not** set `reasoningEffort`, `textVerbosity`, or `steps`; OpenCode/provider defaults apply unless another layer overrides them.

| Level | System guidance | Model | Default timeout |
|---|---|---|---|
| `fast` | Maximally concise and direct | `openai/gpt-5.2` default (override optional) | 15s |
| `standard` | Clear and appropriately detailed | `openai/gpt-5.2` default (override optional) | 30s |
| `smart` | Think carefully and optimize quality | `openai/gpt-5.2` default (override optional) | 90s |

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

- Carrier: OpenCode server only (the OpenCode server performs provider auth using your `opencode auth login` session)
- No direct provider fallback path (this tool does not use `OPENAI_API_KEY`)

## Call-Site Policy

- Set `level` intentionally at each internal caller (`fast`, `standard`, or `smart`)
- Rely on preset defaults unless there is a deliberate reason to override `model`
