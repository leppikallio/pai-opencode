> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: Minimal example contracts for SKILL.md plus where extended examples belong.

<!-- SKILLSYSTEM:EXAMPLES:v1 -->

# SkillSystem — Examples

Examples teach the model the **input → routing → behavior → output** pattern for a skill.

This section defines:

1) The minimal examples format expected in `SKILL.md`.
2) How to keep `SKILL.md` within the **≤ 80-line budget** by moving extended examples into `Examples.md` (a root context doc).

## Minimal examples in `SKILL.md` (format contract)

### Requirements

- Include **1–2** examples (prefer 1 if the skill is already near the line budget).
- Use realistic user phrasing.
- Show the routing decision (workflow name or direct handling).
- End with the deliverable the user gets.

### Template

```md
## Examples

**Example 1: <short label>**
```
User: "<request>"
→ Invokes <WorkflowName> workflow
→ <1–2 short behavior steps>
→ Returns <artifact/output>
```
```

### Anti-patterns (keep out of `SKILL.md`)

- Long narrative explanations (move to a root doc).
- 5–10 examples (too many; breaks the line budget and dilutes signal).
- Examples that omit the outcome (“what I get back”).

## Extended examples live in `Examples.md` (root context doc)

When a skill needs more coverage (edge cases, variants, multi-step flows), put them in the skill root:

- `/Users/zuul/.config/opencode/skills/{SkillName}/Examples.md`

Rule: `SKILL.md` stays compact; `Examples.md` can be longer.

### Pointing from `SKILL.md` to `Examples.md`

In `SKILL.md`, add a single pointer line:

```md
Full examples: `/Users/zuul/.config/opencode/skills/{SkillName}/Examples.md`
```

If you need to retrieve the file and you don’t know the exact path:

1) `glob` for `**/Examples.md`
2) `Read` the resolved absolute runtime path

## Line-budget guidance (≤ 80 lines)

Because newly generated `SKILL.md` files must be **≤ 80 lines (counting all lines, including blanks)**:

- Prefer **1** example unless the skill is extremely small.
- Keep each example to **~4 lines inside the code block**.
- Move everything else into root context docs (`Examples.md`, `ApiReference.md`, `StyleGuide.md`, etc.).
