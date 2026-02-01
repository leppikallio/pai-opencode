# PAISECURITYSYSTEM

**Your Personal Security Configuration**

This directory contains your personal security patterns and rules that override or extend the default PAISECURITYSYSTEM.

---

## Purpose

Define security rules specific to your environment:

- Custom paths to protect
- Personal API key patterns to detect
- Project-specific sensitive data patterns
- Your own validation rules

---

## Files to Create

### patterns.yaml

Your personal security patterns (override defaults):

```yaml
# Example patterns.yaml
DANGEROUS_PATTERNS:
  - pattern: "npm publish"
    description: "Accidental package publish"

WARNING_PATTERNS:
  - pattern: "git push --force"
    description: "Force push can lose commits"

ALLOWED_PATTERNS:
  - pattern: "rg\\s+.*"
    description: "Search commands are safe"

SECURITY_RULES:
  block_dangerous: true
  require_confirmation_for_warnings: true
  max_command_length: 1000
```

---

## How It Works

1. PAI checks `~/.config/opencode/USER/PAISECURITYSYSTEM/` first
2. If patterns.yaml exists, it's used for security validation
3. If not, falls back to default PAISECURITYSYSTEM patterns
4. Your patterns override defaults (USER always wins)

Paths:
- System defaults: `~/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml`
- Your overrides: `~/.config/opencode/USER/PAISECURITYSYSTEM/patterns.yaml`
