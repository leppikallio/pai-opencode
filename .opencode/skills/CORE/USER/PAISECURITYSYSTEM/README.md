# PAISECURITYSYSTEM (User Overrides)

This directory contains your personal security rules for the OpenCode runtime.

## How It Works

1. The security validator checks `~/.config/opencode/skills/CORE/USER/PAISECURITYSYSTEM/patterns.yaml`
2. If present, it is used as the active ruleset
3. Otherwise, it falls back to the system defaults

System defaults:
- `~/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml`

## patterns.yaml (v2.4 schema)

Use this schema (aligned with upstream v2.4):

```yaml
---
version: "1.0"
philosophy:
  mode: safe_functional
  principle: "Block catastrophic operations, confirm risky ones, allow everything else"

bash:
  blocked:
    - pattern: "rm -rf /"
      reason: "Filesystem destruction"

  confirm:
    - pattern: "git push --force"
      reason: "Force push can lose commits"

  alert:
    - pattern: "curl.*\\|.*bash"
      reason: "Piping curl to bash"

paths:
  zeroAccess:
    - "~/.ssh/id_*"

  readOnly:
    - "/etc/**"

  confirmWrite:
    - "**/.env"
    - "**/.env.*"

  noDelete:
    - ".git/**"

projects: {}
```

Notes:
- `bash.*.pattern` values are treated as regex; invalid regex falls back to literal match.
- `paths.*` values are glob-like patterns (`*` and `**` supported).
