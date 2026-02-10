# Security Validator Plugin

**OpenCode plugin implementation details for PAI security enforcement**

---

## Canonical Location

`~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/` is the source of truth.

Compatibility:
- `~/.config/opencode/PAISECURITYSYSTEM/` is a symlink to this directory.

---

## Where It Runs

- Entry point: `~/.config/opencode/plugins/pai-unified.ts`
- Validator: `~/.config/opencode/plugins/handlers/security-validator.ts`

---

## Enforcement Hook

- **Hook:** `tool.execute.before`
- **Behavior:** throw Error to block, return to allow
- **Confirm:** use `permission.ask` when OpenCode prompts

---

## Pattern Loading

Order of precedence:

1. `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml` (user override)
2. `PAISECURITYSYSTEM/patterns.example.yaml` (system fallback)
3. Fail‑open if neither exists

Patterns are compiled once at plugin load (no per‑call YAML reads).

---

## Pattern Sections (YAML)

- `bash.blocked` → deny execution
- `bash.confirm` → require confirmation
- `bash.alert` → alert/log while allowing
- `paths.zeroAccess` / `paths.readOnly` / `paths.confirmWrite` / `paths.noDelete` → path-level policy controls

---

## Logging

Security decisions are appended to:

- `MEMORY/SECURITY/YYYY-MM/security.jsonl`

Each entry includes:
- timestamp
- session id
- tool name
- action (allow/confirm/block)
- category (bash_command/path_access/other)
- rule id + reason

---

## Quick Update Workflow

1. Edit `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. Deploy: `bun Tools/Install.ts --target "~/.config/opencode"`
3. Restart OpenCode
