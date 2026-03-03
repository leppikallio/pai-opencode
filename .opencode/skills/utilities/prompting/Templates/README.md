# Prompting Templates Guide

**Status:** Active (OpenCode + GPT-5.2/5.3 aligned)

---

## Overview

The templates system enables reusable prompt composition:

- **Templates** define structure
- **Data files** supply content
- **Tools** render and validate output

This keeps prompt logic maintainable and eval-friendly.

---

## Directory structure

```text
Templates/
├── Primitives/
│   ├── Roster.hbs
│   ├── Voice.hbs
│   ├── Structure.hbs
│   ├── Briefing.hbs
│   └── Gate.hbs
├── Evals/
│   ├── Judge.hbs
│   ├── Rubric.hbs
│   ├── TestCase.hbs
│   ├── Comparison.hbs
│   └── Report.hbs
├── Data/
│   ├── Agents.yaml
│   ├── VoicePresets.yaml
│   └── ValidationGates.yaml
├── Tools/
│   ├── RenderTemplate.ts
│   └── ValidateTemplate.ts
└── README.md
```

---

## Handlebars syntax

| Syntax | Purpose | Example |
|---|---|---|
| `{{variable}}` | interpolation | `Hello {{name}}` |
| `{{obj.field}}` | nested access | `{{agent.id}}` |
| `{{#each items}}...{{/each}}` | iterate | list rendering |
| `{{#if cond}}...{{/if}}` | conditional | optional blocks |
| `{{> partial}}` | include partial | reusable fragments |

---

## Rendering and validation

### Render

```bash
bun run --install=fallback --cwd "$HOME/.config/opencode/skills/prompting/Templates/Tools" RenderTemplate.ts \
  --template Primitives/Roster.hbs \
  --data Data/Agents.yaml \
  --preview
```

### Validate

```bash
bun run --install=fallback --cwd "$HOME/.config/opencode/skills/prompting/Templates/Tools" ValidateTemplate.ts \
  --template Primitives/Briefing.hbs \
  --data Data/ValidationGates.yaml
```

### Programmatic API

```ts
import { renderTemplate } from "./Templates/Tools/RenderTemplate";

const output = renderTemplate({
  templatePath: "Primitives/Roster.hbs",
  dataPath: "Data/Agents.yaml",
  preview: false,
});
```

> `renderTemplate` currently expects paths, not inline data objects.
> `ValidateTemplate` without `--strict` checks syntax and reports missing variables as warnings.

---

## Built-in helpers (accurate contracts)

### String helpers

| Helper | Example | Output |
|---|---|---|
| `uppercase` | `{{uppercase "hello"}}` | `HELLO` |
| `lowercase` | `{{lowercase "HELLO"}}` | `hello` |
| `titlecase` | `{{titlecase "hello world"}}` | `Hello World` |
| `truncate` | `{{truncate text 50}}` | first 50 chars + `...` |

### Formatting helpers

| Helper | Example | Output |
|---|---|---|
| `indent` | `{{indent text 2}}` | text indented by 2 spaces |
| `join` | `{{join items ", "}}` | `a, b, c` |
| `json` | `{{json obj true}}` | pretty JSON |
| `codeblock` | `{{codeblock code "ts"}}` | fenced code block |

### Logic helpers

| Helper | Example |
|---|---|
| `eq` | `{{#if (eq a b)}}...{{/if}}` |
| `gt` | `{{#if (gt a b)}}...{{/if}}` |
| `lt` | `{{#if (lt a b)}}...{{/if}}` |
| `includes` | `{{#if (includes arr item)}}...{{/if}}` |

### Number/time helpers

| Helper | Example | Output |
|---|---|---|
| `formatNumber` | `{{formatNumber 1234567}}` | `1,234,567` |
| `percent` | `{{percent 85 100 1}}` | `85.0` |
| `now` | `{{now "date"}}` | `YYYY-MM-DD` |
| `now` | `{{now "time"}}` | `HH:MM:SS` |
| `now` | `{{now}}` | ISO timestamp |

### Utility helpers

| Helper | Example | Output |
|---|---|---|
| `pluralize` | `{{pluralize count "item"}}` | `item/items` |
| `default` | `{{default value "fallback"}}` | value or fallback |
| `repeat` (block) | `{{#repeat 3}}={{/repeat}}` | `===` |

---

## Template selection quick map

| Need | Template | Data |
|---|---|---|
| Agent/skill roster block | `Primitives/Roster.hbs` | `Data/Agents.yaml` |
| Voice/persona settings | `Primitives/Voice.hbs` | `Data/VoicePresets.yaml` |
| Workflow scaffolding | `Primitives/Structure.hbs` | custom YAML/JSON |
| Task handoff / agent briefing | `Primitives/Briefing.hbs` | task context file |
| Validation checklist | `Primitives/Gate.hbs` | `Data/ValidationGates.yaml` |
| Judge prompt | `Evals/Judge.hbs` | eval config |
| Rubric | `Evals/Rubric.hbs` | eval config |
| Test case | `Evals/TestCase.hbs` | test config |
| A/B comparison | `Evals/Comparison.hbs` | comparison config |
| Eval report | `Evals/Report.hbs` | result data |

---

## Quality checklist

Before publishing or using generated prompts:

1. Template compiles and validates (`ValidateTemplate.ts`)
2. Required variables exist in data file
3. Output shape matches consuming workflow expectations
4. Paths/examples are case-consistent (`Evals/`, not mixed case)
5. No runtime-only destructive instructions in docs

6. Eval templates use stable criterion identifiers (`id`) for machine-parsed outputs
7. JSON output contracts specify concrete value types (not placeholder strings)

---

## Safe rollback and recovery

Do not edit runtime content directly for source fixes.

Use source-repo workflow:

1. Update files in base repo (`/Users/zuul/Projects/pai-opencode-graphviz/.opencode/...`)
2. Validate
3. Deploy with installer:

```bash
bun Tools/Install.ts --target "/Users/zuul/.config/opencode" --non-interactive --skills "PAI,prompting"
```

If rollback is needed, revert source commit/changes in repo, then reinstall.

---

## Notes on provider guidance

This template system is provider-agnostic. Provider-specific prompting tips belong in `../Standards.md` provider profile sections.

For GPT-5.2/5.3 defaults, use the OpenAI profile in `Standards.md`.
