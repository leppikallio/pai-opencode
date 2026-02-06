> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: Common failure modes that cause drift, broken routing, or unverifiable claims.

<!-- SKILLSYSTEM:ANTIPATTERNS:v1 -->

# SkillSystem — Anti-Patterns

These are high-frequency failure modes. Treat them as “stop the line” defects.

## 1) Index points but no Read gate

Symptom: `SkillSystem.md` (or another index/router) links to section docs but does not require reading them when answering.

Why it’s bad: encourages stale-memory answers; section docs drift and responses become unverifiable.

Fix: add explicit “If asked about X → MUST `Read` Y this turn” rules, and require canary/heading citation.

## 2) Pretending SkillSearch ran

Symptom: response says “SkillSearch loaded …” or implies discovery happened, but no tool was executed.

Why it’s bad: violates capability-truth; hides missing evidence; makes debugging impossible.

Fix: use `Read` with explicit absolute runtime paths. If the path is unknown, `glob` then `Read`. Never claim a tool ran without tool evidence.

## 3) Quoting rules without reading the section doc

Symptom: responses paraphrase or quote SkillSystem rules without having read the relevant section doc in the current turn.

Why it’s bad: the whole point of the split docs is to avoid drift; memory-only answers regress quality.

Fix: enforce Read-gates and canary/heading citation in validation.

## 4) Broken runtime links

Symptom: markdown links point at repo paths, relative paths, or non-existent runtime locations.

Why it’s bad: section docs become non-navigable in the runtime environment.

Fix: internal links MUST be absolute runtime paths under `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/...`.

## 5) Repo/runtime path confusion

Symptom: instructions tell you to edit `/Users/zuul/.config/opencode/...` when the real authoring source is the base repo, or vice versa.

Why it’s bad: edits land in the wrong place; changes get lost on reinstall; contributors can’t reproduce.

Fix:

- Authoring paths: `/Users/zuul/Projects/pai-opencode/.opencode/...`
- Runtime paths: `/Users/zuul/.config/opencode/...` (post-install destination, linking base)

## 6) SKILL.md becomes an essay (budget drift)

Symptom: newly generated `SKILL.md` exceeds the default ≤ 80 line budget due to long explanations, big examples, or repeated policy text.

Why it’s bad: hurts routing clarity and increases context load; makes CreateSkill output non-deterministic.

Fix: keep `SKILL.md` as a router + minimal examples; move detail into root context docs.

## 7) Reference docs dumped into Workflows/

Symptom: `Workflows/*.md` contains specs, background, or long reference guides.

Why it’s bad: workflows should be executable runbooks; mixing reference content makes execution ambiguous.

Fix: move reference content into TitleCase root docs and keep workflows procedural.

## 8) “Magic” tools or directories

Symptom: docs imply tools/folders/automation that do not exist (validators, scripts, indexes).

Why it’s bad: breaks trust and produces non-actionable runbooks.

Fix: either add the tool (in the repo) or remove the claim. Always favor capability-truth.
