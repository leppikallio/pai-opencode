# SecurityValidator Plugin Documentation

**How the security validation plugin works in PAI-OpenCode**

---

## Overview

The security validator is implemented as part of `plugins/pai-unified.ts`, which provides security validation for Bash commands and file operations before execution. It prevents catastrophic operations while allowing normal development work.

---

## Trigger

- **Event:** `tool.execute.before`
- **Tools:** Bash, Edit, Write, Read

---

## Input

The plugin receives tool execution context:

```typescript
{
  tool: {
    name: "Bash",
    input: {
      command: "rm -rf /some/path"
    }
  },
  session: { id: "abc-123-uuid" }
}
```

For file operations:
```typescript
{
  tool: {
    name: "Write",
    input: {
      file_path: "/path/to/file.txt",
      content: "..."
    }
  }
}
```

---

## Output

The plugin communicates decisions by:

| Action | Result |
|--------|--------|
| Return normally | Allow operation |
| Throw Error | Hard block - operation prevented |

---

## Pattern Loading

The plugin loads patterns in this order:

1. **USER patterns** (primary): `USER/PAISECURITYSYSTEM/patterns.yaml`
2. **SYSTEM patterns** (fallback): `PAISECURITYSYSTEM/patterns.example.yaml`
3. **Fail-open**: If neither exists, allow all operations

This cascading approach ensures:
- Users can customize their own security rules
- New installations work with sensible defaults
- Missing configuration doesn't block work

---

## Pattern Matching

### Bash Commands

```yaml
bash:
  blocked:   # Hard block (throws Error)
    - pattern: "rm -rf /"
      reason: "Filesystem destruction"

  confirm:   # User prompt (not available in OpenCode)
    - pattern: "git push --force"
      reason: "Force push can lose commits"

  alert:     # Log only
    - pattern: "curl.*\\|.*sh"
      reason: "Piping curl to shell"
```

Patterns are evaluated as regular expressions (case-insensitive).

### Path Protection

```yaml
paths:
  zeroAccess:    # Complete denial
    - "~/.ssh/id_*"

  readOnly:      # Can read, not write
    - "/etc/**"

  confirmWrite:  # Writing needs confirmation
    - "**/.env"

  noDelete:      # Cannot delete
    - ".git/**"
```

Path patterns use glob syntax:
- `*` matches any characters except `/`
- `**` matches any characters including `/`
- `~` expands to home directory

---

## Execution Flow

```
1. Receive tool execution event
2. Load patterns (USER → SYSTEM → empty)
3. Determine tool type (Bash vs file operation)
4. For Bash: Check command against bash patterns
5. For files: Check path against path patterns
6. Log security event (all decisions)
7. Return (allow) or throw Error (block)
```

---

## Security Event Logging

Decisions are logged to: `MEMORY/SECURITY/`

```json
{
  "timestamp": "2026-01-14T12:00:00.000Z",
  "session_id": "abc-123",
  "event_type": "block",
  "tool": "Bash",
  "category": "bash_command",
  "target": "rm -rf /",
  "pattern_matched": "rm -rf /",
  "reason": "Filesystem destruction",
  "action_taken": "blocked"
}
```

---

## Configuration

The plugin is configured in `opencode.json`:

```json
{
  "plugins": [".opencode/plugins/pai-unified.ts"]
}
```

The unified plugin automatically handles security validation.

---

## Error Handling

The plugin is designed to fail-open for usability:

| Error | Behavior |
|-------|----------|
| Missing patterns.yaml | Allow all operations |
| YAML parse error | Log warning, allow operation |
| Invalid pattern regex | Try literal match |
| Logging failure | Silent (doesn't block) |

---

## Differences from Claude Code Hooks

| Claude Code (hooks) | OpenCode (plugins) |
|---------------------|-------------------|
| Exit code 2 blocks | Throw Error blocks |
| Separate hook files | Unified plugin |
| JSON stdout | Direct function return |
| `"decision": "ask"` | Not supported (no confirm) |

---

## Customization

To add custom patterns:

1. Create `USER/PAISECURITYSYSTEM/patterns.yaml` (copy from `PAISECURITYSYSTEM/patterns.example.yaml`)
2. Add patterns to appropriate sections
3. Patterns are loaded on next OpenCode start

Example custom pattern:
```yaml
bash:
  blocked:
    - pattern: "npm publish"
      reason: "Accidental package publish"
```
