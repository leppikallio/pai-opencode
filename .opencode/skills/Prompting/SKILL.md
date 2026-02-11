---
name: prompting
description: Prompt engineering standards and templating workflows optimized for OpenCode with GPT-5.2/5.3.
---

## Customization

Before executing, check for user customizations at:
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/prompting/`

If present, load and apply local preferences/resources. Local customizations override defaults.

---

# Prompting Skill

## Purpose

This skill is the shared prompt-engineering standard library for PAI:

- **Standards** — model-agnostic principles + OpenCode runtime rules
- **Templates** — Handlebars primitives for reusable prompt composition
- **Tools** — template rendering and validation utilities
- **Patterns** — practical, eval-friendly prompt contracts

Default target environment: **OpenCode + GPT-5.2/5.3**.

---

## Use this skill when

- You are designing or refactoring prompts used repeatedly
- You need structured prompt templates generated from YAML/JSON data
- You are building prompt contracts for agents, tools, evals, or workflows
- You need to tighten output format compliance and reduce ambiguity

## Do not use this skill when

- You only need a one-off natural-language prompt tweak
- The task is purely content writing with no reusable prompt structure

---

## Operating Model

### 1) Keep rules layered

- **Universal principles** (clarity, constraints, verification)
- **Runtime rules** (OpenCode tool behavior, evidence-first claims)
- **Provider profile** (GPT-5.x defaults, optional provider appendix)

### 2) Keep prompts contract-driven

Every production prompt should define:

- goal and non-goals
- required inputs
- output schema/format
- tool policy (when to call, when to ask)
- stop conditions / escalation behavior

### 3) Keep instructions compact and testable

Use short, high-signal sections and evaluate with representative test cases.

---

## Runtime Voice Behavior

Voice notifications are optional and governed by CORE/runtime policy.

If used in a prompting workflow:

- Use at most one `voice_notify` call per assistant message
- Do not print tool-call annotations in visible output
- Keep spoken summary in final `🗣️ Marvin:` line concise

---

## Core Components

### Standards

- `Standards.md` — canonical prompting standards for this skill

### Templates

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
└── Tools/
    ├── RenderTemplate.ts
    └── ValidateTemplate.ts
```

### Tools

#### Render template

```bash
bun run --install=fallback --cwd "$HOME/.config/opencode/skills/prompting/Templates/Tools" RenderTemplate.ts \
  --template Primitives/Roster.hbs \
  --data Data/Agents.yaml \
  --preview
```

#### Validate template

```bash
bun run --install=fallback --cwd "$HOME/.config/opencode/skills/prompting/Templates/Tools" ValidateTemplate.ts \
  --template Primitives/Briefing.hbs \
  --data Data/ValidationGates.yaml
```

#### Programmatic use

```ts
import { renderTemplate } from "./Templates/Tools/RenderTemplate";

const rendered = renderTemplate({
  templatePath: "Primitives/Roster.hbs",
  dataPath: "Data/Agents.yaml",
  preview: false,
});
```

> `renderTemplate` currently accepts file paths, not inline data objects.

---

## GPT-5.2/5.3 Optimization Defaults

When drafting prompts for GPT-5.x in OpenCode, prefer:

1. clear sectioned instructions (goal, constraints, output)
2. explicit verbosity/output-shape limits
3. schema-first outputs when machine-consumed
4. strict tool-use policy (no guessed params)
5. ambiguity policy (ask concise clarification or state assumptions)

For detailed guidance and copyable contracts, use `Standards.md`.

---

## Integration Notes

### agents skill

- Uses prompting templates for structured agent briefings and context handoff

### evals skill

- Uses prompting templates for judge/rubric/test-case composition

### PAI CORE and Algorithm

- CORE governs execution format, verification, and escalation behavior
- prompting skill supplies reusable prompt structure and wording patterns

---

## Best Practices

- Keep template logic minimal; keep business logic in TypeScript
- Validate templates before rendering in automation paths
- Keep examples executable and path-consistent
- Prefer source-relative paths in repo docs; runtime paths in usage examples
- Avoid unverifiable performance claims in normative docs

---

## References

Primary:

- OpenAI GPT-5.2 Prompting Guide  
  `https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-2_prompting_guide/`
- OpenAI Prompt Engineering Guide  
  `https://platform.openai.com/docs/guides/prompt-engineering`
- OpenAI Function Calling Guide  
  `https://platform.openai.com/docs/guides/function-calling`
- OpenAI Structured Outputs Guide  
  `https://platform.openai.com/docs/guides/structured-outputs`

Secondary comparative references (optional):

- Anthropic prompt/variable guidance
- Fabric prompt-pattern library
- prompt engineering survey papers (Prompt Report, Prompt Canvas)

---

**Philosophy:** Use reusable structure, explicit contracts, and verified outputs so prompt quality scales with the system.
