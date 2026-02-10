# SYSTEM and USER Two-Tier Architecture

**The foundational pattern for PAI extensibility and personalization**

---

## Overview

PAI uses a consistent two-tier architecture across all configurable components:

```
SYSTEM tier  →  Base functionality, defaults, PAI updates
USER tier    →  Personal customizations, private policies, overrides
```

This pattern enables:
- **Immediate functionality** — PAI works out of the box with sensible defaults
- **Personal customization** — Users can override any default without modifying core files
- **Clean updates** — PAI updates don't overwrite personal configurations
- **Privacy separation** — USER content is never synced to the public PAI repository

---

## The Lookup Pattern

When PAI needs configuration, it follows a cascading lookup:

```
1. Check USER location first
   ↓ (if not found)
2. Fall back to SYSTEM defaults
   ↓ (if not found)
3. Use hardcoded defaults or fail-open
```

**This means USER always wins.** If you create a file in the USER tier, it completely overrides the SYSTEM tier equivalent.

---

## Where This Pattern Applies

### Security System

```
~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/  # SYSTEM tier (base, canonical)
├── README.md                          # Overview
├── ARCHITECTURE.md                    # Security layers
├── HOOKS.md                           # Hook documentation
├── PROMPTINJECTION.md                 # Prompt injection defense
├── COMMANDINJECTION.md                # Command injection defense
└── patterns.example.yaml              # Default security patterns

~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/    # USER tier (personal)
├── patterns.yaml                      # Your security rules
├── QUICKREF.md                        # Your quick reference
└── ...
```

The SecurityValidator checks `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml` first, falling back to `~/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml`.

Compatibility:
- `~/.config/opencode/PAISECURITYSYSTEM/` is a symlink to `~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/`.

### Response Format

```
~/.config/opencode/skills/PAI/SYSTEM/RESPONSEFORMAT.md  # SYSTEM tier (base format rules)
~/.config/opencode/skills/PAI/USER/RESPONSEFORMAT.md    # USER tier (personal overrides)
```

### Skills

```
skills/system/SKILL.md                # SYSTEM tier (public skill)
skills/<PRIVATE_SKILL>/SKILL.md        # USER tier (private, _PREFIX naming)
```

Private skills use the `_ALLCAPS` prefix and are never synced to public PAI.

### Identity

```
settings.json                         # Base identity (name, voice)
~/.config/opencode/skills/PAI/USER/DAIDENTITY.md          # Personal identity expansion
```

### Configuration Files

Many configuration files follow this pattern implicitly:

| SYSTEM Default | USER Override |
|----------------|---------------|
| `patterns.example.yaml` | `~/.config/opencode/skills/PAI/USER/.../patterns.yaml` |
| `~/.config/opencode/skills/PAI/SYSTEM/RESPONSEFORMAT.md` | `~/.config/opencode/skills/PAI/USER/RESPONSEFORMAT.md` |
| `settings.json` defaults | `settings.json` user values |

---

## Design Principles

### 1. SYSTEM Provides Working Defaults

The SYSTEM tier must always provide functional defaults. A fresh PAI installation should work immediately without requiring USER configuration.

```yaml
# SYSTEM tier: patterns.example.yaml (v2.4 schema)
# Provides reasonable defaults that protect against catastrophic operations
bash:
  blocked:
    - pattern: "rm -rf /"
      reason: "Filesystem destruction"
```

### 2. USER Overrides Completely

When a USER file exists, it replaces (not merges with) the SYSTEM equivalent. This keeps behavior predictable.

```yaml
# USER tier: patterns.yaml (v2.4 schema)
# Completely replaces patterns.example.yaml
bash:
  blocked:
    - pattern: "rm -rf /"
      reason: "Filesystem destruction"
  confirm:
    - pattern: "git push --force"
      reason: "Force push can lose commits"  # Personal addition
```

### 3. USER Content Stays Private

The `~/.config/opencode/skills/PAI/USER/` directory is excluded from public PAI sync. Anything in the USER tier:
- Never appears in public PAI repository
- Contains personal preferences, private rules, sensitive paths
- Is safe to include API keys, project names, personal workflows

### 4. SYSTEM Updates Don't Break USER

When PAI updates, only SYSTEM tier files change. Your USER configurations remain untouched. This means:
- Safe to update PAI without losing customizations
- New SYSTEM features available immediately
- USER overrides continue working

---

## Implementation Guide

### For New PAI Components

When creating a new configurable component:

1. **Create SYSTEM tier defaults**
   ```
   ComponentName/
   ├── config.example.yaml    # Default configuration
   ├── README.md              # Documentation
   └── ...
   ```

2. **Document USER tier location**
   ```
   ~/.config/opencode/skills/PAI/USER/ComponentName/
   ├── config.yaml            # User's configuration
   └── ...
   ```

3. **Implement cascading lookup**
   ```typescript
   function getConfigPath(): string | null {
     const userPath = paiPath('USER', 'ComponentName', 'config.yaml');
     if (existsSync(userPath)) return userPath;

     const systemPath = paiPath('ComponentName', 'config.example.yaml');
     if (existsSync(systemPath)) return systemPath;

     return null;  // Will use hardcoded defaults
   }
   ```

4. **Fail gracefully**
   - If no config found, use sensible hardcoded defaults
   - Log which tier was loaded for debugging
   - Never crash due to missing configuration

### For Existing Components

To add USER extensibility to an existing component:

1. Move current config to SYSTEM tier (rename to `.example` if needed)
2. Add lookup logic that checks USER first
3. Document the USER location in README
4. Test that SYSTEM defaults still work alone

---

## Examples in Practice

### Security Pattern Loading (Example)

```typescript
// File-driven security pattern loader (current implementation).
const USER_PATTERNS_PATH = paiPath('USER', 'PAISECURITYSYSTEM', 'patterns.yaml');
const SYSTEM_PATTERNS_PATH = paiPath('PAISECURITYSYSTEM', 'patterns.example.yaml');

function getPatternsPath(): string | null {
  // USER first
  if (existsSync(USER_PATTERNS_PATH)) {
    patternsSource = 'user';
    return USER_PATTERNS_PATH;
  }

  // SYSTEM fallback
  if (existsSync(SYSTEM_PATTERNS_PATH)) {
    patternsSource = 'system';
    return SYSTEM_PATTERNS_PATH;
  }

  // No patterns - fail open
  return null;
}
```

### Skill Naming Convention

```
skill-id        →  SYSTEM tier (public, shareable)
_ALLCAPS        →  USER tier (private, personal)

skills/browser/         # Public skill
skills/_BLOGGING/       # Private skill (underscore prefix)
```

---

## Common Questions

### Q: What if I want to extend SYSTEM defaults, not replace them?

The current pattern is replacement, not merge. If you want to keep SYSTEM defaults and add to them:
1. Copy SYSTEM defaults to USER location
2. Add your customizations
3. Manually sync when SYSTEM updates (or use a merge tool)

Future PAI versions may support declarative merging.

### Q: How do I know which tier is active?

Components should log which tier loaded:
```
Loaded USER security patterns
Loaded SYSTEM default patterns
No patterns found - using hardcoded defaults
```

Check logs or add debugging to see active configuration source.

### Q: Can I have partial USER overrides?

Currently, no. USER replaces SYSTEM entirely for that component. If you only want to change one setting, you must copy the entire SYSTEM config and modify it.

### Q: What about settings.json?

`settings.json` is a special case—it's a single file with both system and user values. It doesn't follow the two-file pattern but achieves similar results through its structure.

---

## Related Documentation

- `~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/` — Security system architecture and patterns
- `~/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md` — Skill naming conventions (public vs private)
- `~/.config/opencode/skills/PAI/SYSTEM/PAISYSTEMARCHITECTURE.md` — Overall PAI architecture
