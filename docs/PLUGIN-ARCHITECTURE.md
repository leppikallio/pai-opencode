# Plugin Architecture

**PAI-OpenCode v0.7.0 Plugin Adapter**

This document describes the unified plugin architecture for PAI-OpenCode, including the adapter pattern that translates PAI hooks to OpenCode plugins.

---

## Overview

PAI-OpenCode uses a **unified plugin adapter** that combines all PAI hook functionality into a single OpenCode plugin. This approach simplifies maintenance and ensures consistent behavior across all hook types.

**Key Principles:**
- Single unified plugin (`pai-unified.ts`) handles all hook types
- TUI-safe logging (file-only, never console.log)
- Defensive error handling with fail-open semantics
- Security blocking via thrown errors in `tool.execute.before`

---

## File Structure

### Directory Layout (v0.7.0)

```
.opencode/
└── plugin/
    ├── pai-unified.ts              # Main unified plugin (entry point)
    ├── handlers/
    │   ├── context-loader.ts       # CORE skill injection
    │   └── security-validator.ts   # Security blocking
    ├── adapters/
    │   └── types.ts                # Shared TypeScript interfaces
    ├── lib/
    │   └── file-logger.ts          # TUI-safe file logging
    ├── _deprecated/                # Old plugins (replaced by unified)
    │   ├── pai-post-tool-use.ts
    │   └── pai-session-lifecycle.ts
    └── tsconfig.json               # TypeScript configuration
```

---

## PAI Hook → OpenCode Plugin Mapping

| PAI Hook | OpenCode Hook | Purpose |
|----------|---------------|---------|
| `SessionStart` | `experimental.chat.system.transform` | Context injection |
| `PreToolUse` (exit 2) | `tool.execute.before` + throw Error | Security blocking |
| `PreToolUse` | `tool.execute.before` | Args modification |
| `PostToolUse` | `tool.execute.after` | Learning capture |
| `Stop` | `event` (session.idle) | Session lifecycle |

---

## Key Technical Discovery (CRITICAL)

**In `tool.execute.before`, args are in `output.args`, NOT `input.args`!**

```typescript
// CORRECT
"tool.execute.before": async (input, output) => {
  const command = output.args.command; // ✅ Args in OUTPUT
}

// WRONG
"tool.execute.before": async (input, output) => {
  const command = input.args.command; // ❌ input.args is undefined!
}
```

This is documented in OpenCode's plugin type definitions:
```typescript
"tool.execute.before"?: (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>
```

---

## Unified Plugin Pattern

### Main Entry Point (pai-unified.ts)

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { loadContext } from "./handlers/context-loader";
import { validateSecurity } from "./handlers/security-validator";
import { fileLog, fileLogError, clearLog } from "./lib/file-logger";

export const PaiUnified: Plugin = async (ctx) => {
  clearLog();
  fileLog("=== PAI-OpenCode Plugin Loaded ===");

  const hooks: Hooks = {
    // Context injection (SessionStart equivalent)
    "experimental.chat.system.transform": async (input, output) => {
      const result = await loadContext();
      if (result.success) {
        output.system.push(result.context);
      }
    },

    // Security blocking (PreToolUse exit(2) equivalent)
    "tool.execute.before": async (input, output) => {
      const result = await validateSecurity({
        tool: input.tool,
        args: output.args ?? {},  // ← Args in OUTPUT!
      });

      if (result.action === "block") {
        throw new Error(`[PAI Security] ${result.message}`);
      }
    },

    // Learning capture (PostToolUse equivalent)
    "tool.execute.after": async (input, output) => {
      fileLog(`Tool after: ${input.tool}`);
      // Future: Learning capture
    },

    // Session lifecycle (Stop equivalent)
    event: async (input) => {
      const eventType = (input.event as any)?.type || "";
      if (eventType.includes("session.idle")) {
        fileLog("Session ending");
        // Future: Session cleanup
      }
    },
  };

  return hooks;
};

export default PaiUnified;
```

---

## TUI-Safe Logging (CRITICAL)

**NEVER use `console.log` in plugins!** It corrupts the OpenCode TUI.

### File Logger Pattern

```typescript
// lib/file-logger.ts
import { appendFileSync, writeFileSync } from "fs";

const LOG_FILE = "/tmp/pai-opencode-debug.log";

export function fileLog(message: string, level = "info") {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}]`;
  appendFileSync(LOG_FILE, `${prefix} ${message}\n`);
}

export function fileLogError(message: string, error: unknown) {
  fileLog(`${message}: ${error}`, "error");
  if (error instanceof Error && error.stack) {
    appendFileSync(LOG_FILE, error.stack + "\n");
  }
}

export function clearLog() {
  writeFileSync(LOG_FILE, "");
}
```

### Viewing Logs

```bash
# Follow logs in real-time
tail -f /tmp/pai-opencode-debug.log

# View recent entries
cat /tmp/pai-opencode-debug.log | tail -50
```

---

## Security Blocking Pattern

### How to Block Dangerous Commands

```typescript
// handlers/security-validator.ts
export async function validateSecurity(input): Promise<SecurityResult> {
  const command = extractCommand(input);

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        action: "block",
        reason: `Dangerous pattern: ${pattern}`,
        message: "Command blocked for security reasons.",
      };
    }
  }

  return { action: "allow", reason: "All checks passed" };
}
```

### Dangerous Patterns (types.ts)

```typescript
export const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!tmp)/,   // rm -rf / (except /tmp)
  /rm\s+-rf\s+~\//,          // rm -rf ~/
  /rm\s+-rf\s+\*/,           // rm -rf *
  /rm\s+-rf\s+\.\./,         // rm -rf ../
  /mkfs\./,                   // Format disk
  /dd\s+if=.*of=\/dev\//,    // Disk write
  // ... more patterns
];
```

---

## Context Injection Pattern

### Loading CORE Skill at Session Start

```typescript
// handlers/context-loader.ts
export async function loadContext(): Promise<ContextResult> {
  const skillDir = join(process.cwd(), ".opencode/skills/CORE");

  // Load SKILL.md
  const skillPath = join(skillDir, "SKILL.md");
  if (await exists(skillPath)) {
    const content = await Bun.file(skillPath).text();
    parts.push(content);
  }

  // Load SYSTEM/*.md
  const systemDir = join(skillDir, "SYSTEM");
  // ... load system files

  return {
    context: parts.join("\n\n---\n\n"),
    success: true,
  };
}
```

---

## Testing Plugins

### Verify Plugin Loads

```bash
# Start OpenCode and check logs
opencode

# In another terminal
cat /tmp/pai-opencode-debug.log | grep "Plugin Loaded"
```

### Test Security Blocking

```bash
# In OpenCode, try a dangerous command
# The AI should see:
# Error: [PAI Security] This command has been blocked...
```

### Expected Log Output

```
[INFO ] === PAI-OpenCode Plugin Loaded ===
[INFO ] Working directory: /path/to/project
[DEBUG] Tool before: bash
[DEBUG] output.args: {"command":"ls -la"}
[INFO ] Security check for tool: bash
[INFO ] Extracted command: ls -la
[DEBUG] Security check passed
```

---

## Error Handling

### Fail-Open for Non-Security Hooks

```typescript
"tool.execute.after": async (input, output) => {
  try {
    // Plugin logic
  } catch (error) {
    fileLogError("Handler failed", error);
    // Don't throw - session continues
  }
}
```

### Fail-Closed for Security Hooks

```typescript
"tool.execute.before": async (input, output) => {
  // NO try/catch for security validation
  // Let errors propagate to block execution
  const result = await validateSecurity({ ... });
  if (result.action === "block") {
    throw new Error("Blocked!");
  }
}
```

---

## Roadmap

### v0.5 (Plugin Infrastructure)
- ✅ Plugin scaffolding
- ✅ Event registration patterns
- ✅ Logging-only implementation

### v0.6 (PAI 2.3 Alignment)
- ✅ Directory structure alignment
- ✅ MEMORY/ folder creation

### v0.7 (Plugin Adapter) - CURRENT
- ✅ Unified plugin architecture
- ✅ Security blocking working
- ✅ Context injection working
- ✅ TUI-safe file logging
- ✅ All 4 tests passing

### v0.8 (Converter Tool)
- ⏳ PAI → OpenCode translation
- ⏳ Skill format conversion
- ⏳ Agent definition translation

---

## References

- **Test Results:** `.opencode/plugins/TEST-RESULTS-v0.7.md`
- **Type Definitions:** `.opencode/plugins/adapters/types.ts`
- **OpenCode Docs:** https://opencode.ai/docs/plugins/

---

**Last Updated:** 2026-01-18
**Version:** 0.7.0
**Status:** COMPLETE - All 4 tests passing
