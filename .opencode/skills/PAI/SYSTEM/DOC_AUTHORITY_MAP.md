# PAI Documentation Authority Map

**Purpose:** Define one clear source-of-truth per domain and prevent contradictory contracts.

---

## Authority Levels

- **Authoritative**: normative contract; wins on conflicts.
- **Secondary**: supporting detail; must not contradict authoritative docs.
- **Legacy/Compatibility**: historical bridge docs; non-authoritative.

---

## Domain Authority Table

| Domain | Authoritative | Secondary | Legacy / Compatibility |
|---|---|---|---|
| Response process contract | `skills/PAI/SKILL.md` (Algorithm + adapter guardrails) | `skills/PAI/SYSTEM/DOCUMENTATIONINDEX.md` | `skills/PAI/SYSTEM/RESPONSEFORMAT.md`, `skills/PAI/USER/RESPONSEFORMAT.md` |
| Plugin/hook lifecycle | `skills/PAI/SYSTEM/THEPLUGINSYSTEM.md` | `skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md` | `skills/PAI/SYSTEM/THEHOOKSYSTEM.md` |
| Skill routing + structure | `skills/PAI/SYSTEM/SkillSystem.md` and `skills/PAI/SYSTEM/SkillSystem/*.md` | `skills/PAI/SYSTEM/DOCUMENTATIONINDEX.md` | none |
| Delegation and agents | `skills/PAI/SYSTEM/PAIAGENTSYSTEM.md` | `skills/PAI/SYSTEM/THEDELEGATIONSYSTEM.md` | historical examples that reference unsupported Task parameters |
| Security validation schema | `skills/PAI/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml` | `skills/PAI/SYSTEM/PAISECURITYSYSTEM/*.md` | docs mentioning deprecated `DANGEROUS_PATTERNS/WARNING_PATTERNS` labels |

---

## Conflict Resolution Rule

When two docs conflict:

1. Follow the **Authoritative** doc.
2. Update/demote conflicting secondary or legacy text.
3. Add a migration note where needed instead of preserving silent contradictions.

---

## Maintenance Rule

Any new PAI documentation that introduces normative behavior MUST first specify:

- domain owner (row in this table),
- authority level,
- whether it supersedes or extends existing docs.

---

## Graphviz Sidecar Authority Map Notes

- Canonical authority contract source: `skills/PAI/SYSTEM/DOC_AUTHORITY_MAP.md` (this file).
- Graph sidecar artifact: `skills/PAI/Graphviz/authority-map.dot`.
- Graph sidecar notes + rewrite tracker references: `skills/PAI/Graphviz/authority-map-notes.md`.
- Session-local rewrite tracker (runtime memory):
  - `MEMORY/WORK/<session>/scratch/pai-coherence-mitigation-plan.md`
  - Trackers: `P6.9-*`, `P7.*` (including restart/runtime gates).
