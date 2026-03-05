# PAI Context Routing Map

> Load only what is needed; prefer native injection surfaces first.

| Topic | Runtime path to read |
| --- | --- |
| Algorithm (v3.7.0) | `~/.config/opencode/skills/PAI/Components/Algorithm/v3.7.0.md` |
| Algorithm version pointer (prefer when available) | `~/.config/opencode/skills/PAI/Components/Algorithm/LATEST` |
| PAI system architecture | `~/.config/opencode/skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md` |
| Memory system | `~/.config/opencode/skills/PAI/SYSTEM/MEMORYSYSTEM.md` |
| Plugin system (authoritative) | `~/.config/opencode/skills/PAI/SYSTEM/THEPLUGINSYSTEM.md` |
| Hook system (legacy) | `~/.config/opencode/skills/PAI/SYSTEM/THEHOOKSYSTEM.md` |
| Tools reference | `~/.config/opencode/skills/PAI/SYSTEM/TOOLS.md` |
| Skill system | `~/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md` |
| Agent system | `~/.config/opencode/skills/PAI/SYSTEM/PAIAGENTSYSTEM.md` |
| Delegation system | `~/.config/opencode/skills/PAI/SYSTEM/THEDELEGATIONSYSTEM.md` |
| USER projects registry | `~/.config/opencode/skills/PAI/USER/PROJECTS/PROJECTS.md` |

## Routing note

- Start with already-injected context (system/developer/runtime state), then read only the specific file needed for the active task.
- For algorithm routing, prefer `.../Algorithm/LATEST` when present; use pinned `v3.7.0.md` when version-specific behavior is required.
