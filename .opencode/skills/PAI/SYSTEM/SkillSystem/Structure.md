> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: Canonical on-disk structure and naming rules for skills.

<!-- SKILLSYSTEM:STRUCTURE:v1 -->

# SkillSystem — Structure

This section defines **how skills are laid out on disk** (directories, allowed nesting, and naming). The goal is predictable discovery, low entropy, and easy navigation.

---

## Canonical Skill Skeleton (default)

Every skill lives under:

- `/Users/zuul/.config/opencode/skills/<SkillName>/`

Minimal required structure:

```text
/Users/zuul/.config/opencode/skills/<SkillName>/
├── SKILL.md
├── Tools/
└── Workflows/
```

Rules:

- `SKILL.md` is **always** the entrypoint and is **always uppercase**.
- `Tools/` and `Workflows/` directories are **always present** (may be empty).
- Additional markdown “context” docs (guides, references, examples) live **in the skill root**, alongside `SKILL.md`.

---

## Naming: TitleCase (PascalCase) is the default

Default naming across the skill system is **TitleCase** (PascalCase):

- No hyphens: `My-Tool.md` ❌
- No underscores: `My_Tool.md` ❌
- No spaces: `My Tool.md` ❌
- No all-lowercase / all-caps (except `SKILL.md`): `toolname.ts` ❌

### TitleCase rules

- Single word: `Browser`, `Daemon`, `Research`
- Multi-word: `CreateSkill`, `UpdateDaemonInfo`, `CompanyDueDiligence`
- Acronyms: treat as words (prefer `ApiReference`, not `API_REFERENCE`)

### Mandatory exceptions

1) **Main skill file**

- `SKILL.md` is always uppercase by convention.

2) **PAI Components numeric-prefix exception (PAI-only)**

Numeric-prefixed filenames are allowed **ONLY** under:

- `/Users/zuul/.config/opencode/skills/PAI/Components/**`

This subtree already uses numeric-prefixed, kebab-case filenames (e.g. `00-frontmatter.md`).
Treat this as an explicit PAI documentation convention; do not spread it outside `Components/`.

Examples:

- ✅ `/Users/zuul/.config/opencode/skills/PAI/Components/00-frontmatter.md`
- ✅ `/Users/zuul/.config/opencode/skills/PAI/Components/10-pai-intro.md`
- ❌ `<non-PAI skill>/00-setup.md` (non-PAI; use `Setup.md`)
- ❌ `<PAI SYSTEM>/00-index.md` (not under `Components/`)

Why: PAI “Components” material is documentation-heavy system content where explicit ordering is valuable; allowing numeric prefixes elsewhere tends to create inconsistency and entropy.

### Help-file naming

Tool help files pair with the tool name:

- ✅ `<Tools/Generate.ts>`
- ✅ `<Tools/Generate.help.md>`
- ❌ `<Tools/generate.help.md>` (not TitleCase)

---

## Skill classes: system vs Personal

Skills are classified by directory naming:

### System skills (shareable)

- Directory name is **TitleCase**, e.g. `Browser`, `research`, `CreateSkill`.
- MUST NOT contain personal secrets or personal data.

### Personal skills (never shared)

- Directory name is `_ALLCAPS`, e.g. `_BLOGGING`, `_METRICS`.
- May contain personal configuration.

Why: the naming convention makes personal skills visually distinct and mechanically easy to exclude from shareable packs.

---

## Folder depth policy

### Default (non-PAI skills): keep it flat

For non-PAI skills (anything outside `/Users/zuul/.config/opencode/skills/PAI/`), the default rule is:

- **Allowed subdirectories:** `Workflows/` and `Tools/` only.
- Everything else (docs, guides, references, examples) goes in the **skill root**.
- Avoid additional subdirectories (`Docs/`, `Resources/`, `Context/`, `Guides/`, etc.).

✅ Allowed (flat):

```text
/Users/zuul/.config/opencode/skills/<SkillName>/
├── SKILL.md
├── Examples.md
├── ApiReference.md
├── Tools/
│   └── Analyze.ts
└── Workflows/
    ├── CompanyDueDiligence.md
    └── PersonSearch.md
```

❌ Forbidden (adds nesting / hides docs):

```text
/Users/zuul/.config/opencode/skills/<SkillName>/
├── SKILL.md
├── Docs/                 # ❌ do not create
│   └── Examples.md
└── Workflows/
    └── Company/
        └── DueDiligence.md  # ❌ use CompanyDueDiligence.md instead
```

Why: flat structures are faster to navigate, easier to `glob`, and reduce long-term organizational drift.

### PAI-wide exception: deeper nesting allowed under `skills/PAI/**`

Under:

- `/Users/zuul/.config/opencode/skills/PAI/**`

Deeper nesting is allowed **when it improves organization**.

#### Boundary rule (prevents entropy)

Even under PAI, deep trees must remain navigable:

- Prefer ≤ 2 levels of nesting unless the subtree is explicitly documentation-heavy system material.
- Any new deep subtree MUST have a **stable index/router** at the top of that subtree.

✅ Allowed (PAI deep subtree with router):

```text
/Users/zuul/.config/opencode/skills/PAI/SYSTEM/
├── SkillSystem.md                 # router/index (stable)
└── SkillSystem/
    ├── Structure.md
    ├── Frontmatter.md
    └── Validation.md
```

❌ Avoid (too deep, no clear router at subtree root):

```text
/Users/zuul/.config/opencode/skills/PAI/SYSTEM/
└── SkillSystem/
    └── Rules/
        └── Naming/
            └── TitleCase.md
```

---

## Forbidden subdirectories (default rule)

Do not introduce directory layers to “organize” markdown documentation.

Forbidden (unless an existing subtree already uses it and you are not restructuring):

- `Docs/`
- `Resources/`
- `Context/`
- `Guides/`
- `Templates/` (prefer root docs; keep `Workflows/` and `Tools/` as the only dirs)

Why: these directories usually become dumping grounds that hide critical context and make deterministic retrieval harder.

