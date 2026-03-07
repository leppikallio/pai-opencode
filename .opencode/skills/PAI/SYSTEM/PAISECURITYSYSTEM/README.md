# PAI Security System

A foundational security framework for Personal AI Infrastructure.

## Current Implementation Status (Tasks 4–8)

- Canonical security engine is modularized under `.opencode/plugins/security/`.
- Hook/plugin/MCP integrations are thin adapters over the shared engine.
- `research-shell` uses shared security adapter logic via `.opencode/mcp/research-shell/security-adapter.ts`.
- `.opencode/pai-unified.ts` is deprecated and not a target dependency for new security behavior.

---

## Two-Layer Design

This directory (`~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/`) is the **canonical base system**—default patterns, documentation, and the security hook. It provides sensible defaults that work out of the box.

Compatibility note:
- `~/.config/opencode/PAISECURITYSYSTEM/` is a symlink to this directory for legacy references.

Your personal security policies live in `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/`. This is where you:
- Define your own blocked/confirm/alert patterns
- Add project-specific rules
- Customize path protections
- Keep policies that should never be shared publicly

**The hook checks USER first, then falls back to this base system.** This means:
- New PAI users get working security immediately
- You can override any default with your own rules
- Your personal policies stay private (USER tier is never synced to public PAI)

---

## Status: Foundation Release

This security system provides essential protection against catastrophic operations while maintaining development velocity. It represents a **starting point**, not a final destination.

**What it does today:**
- Blocks irreversible filesystem and repository operations
- Prompts for confirmation on dangerous but legitimate commands
- Logs all security events for audit trails
- Protects sensitive paths (credentials, keys, configs)

**What it doesn't do (yet):**
- Behavioral anomaly detection
- Session-based threat modeling
- Adaptive pattern learning
- Cross-session attack correlation
- Network egress monitoring

---

## Architecture

```
~/.config/opencode/skills/PAI/SYSTEM/PAISECURITYSYSTEM/   # System defaults
├── README.md                            # This file
├── ARCHITECTURE.md                      # Security layer design
├── HOOKS.md                             # Hook implementation docs
├── PROMPTINJECTION.md                   # Prompt injection defense
├── COMMANDINJECTION.md                  # Command injection defense
└── patterns.example.yaml                # Default security patterns

~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/       # Your customizations
├── patterns.yaml                        # Your security rules
├── QUICKREF.md                          # Quick lookup
└── ...                                  # Your additions
```

The validator loads `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml` first, falling back to `~/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml` if not found.

Legacy fallback path for USER overrides is also supported:
- `~/.config/opencode/USER/PAISECURITYSYSTEM/patterns.yaml`

---

## Quick Start

1. Security works out of the box with `patterns.example.yaml`
2. To customize, copy to `~/.config/opencode/skills/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
3. Add your own blocked/confirm/alert patterns
4. Events log to `MEMORY/SECURITY/YYYY-MM/security.jsonl`

---

## Future Development

This system will evolve. Expect updates in:
- Pattern coverage (more dangerous command detection)
- Path protection (smarter glob matching)
- Logging (richer event context)
- Integration (MCP server validation, API call monitoring)

Contributions and feedback welcome.

---

## Documentation

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE.md` | Security layers, trust hierarchy, philosophy |
| `HOOKS.md` | SecurityValidator implementation details |
| `PLUGINS.md` | OpenCode plugin integration details |
| `RUNBOOK.md` | Operator workflow for policy changes and deployment |
| `INCIDENTS.md` | Incident triage, classification, and rule tuning workflow |
| `PROMPTINJECTION.md` | Defense against prompt injection attacks |
| `COMMANDINJECTION.md` | Defense against command injection |
| `patterns.example.yaml` | Default pattern template |

Operational note:
- `RUNBOOK.md` uses exact `/Users/zuul/...` paths for this branch; adapt them to `~/Projects/pai-opencode` and `~/.config/opencode` on other machines.
- Deploying with `bun Tools/Install.ts --target "~/.config/opencode"` updates the live runtime and should be treated as a high-impact operation.
