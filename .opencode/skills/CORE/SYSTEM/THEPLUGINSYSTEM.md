# Plugin System

**Event-Driven Automation Infrastructure for OpenCode**

**Location:** `~/.opencode/plugins/`
**Configuration:** `~/.opencode/opencode.json`
**Status:** Active - All plugins running in production

---

## Overview

The PAI plugin system is an event-driven automation infrastructure built on OpenCode's native plugin API. Plugins are TypeScript modules that run automatically in response to specific events during OpenCode sessions.

**Core Capabilities:**
- **Session Management** - Auto-load context, capture summaries, manage state
- **Security Validation** - Block dangerous commands before execution
- **Tool Lifecycle** - Pre/post processing for tool executions
- **Voice Notifications** - Text-to-speech announcements for task completions
- **History Capture** - Automatic work/learning documentation to `~/.opencode/MEMORY/`

**Key Principle:** Plugins run asynchronously and fail gracefully. They enhance the user experience but never block OpenCode's core functionality.

---

## Claude Code → OpenCode Hook Mapping

PAI-OpenCode translates Claude Code hook concepts to OpenCode plugin hooks:

| PAI Hook (Claude Code) | OpenCode Plugin Hook | Mechanism |
|------------------------|---------------------|-------------|
| SessionStart | `experimental.chat.system.transform` | `output.system.push()` |
| PreToolUse | `tool.execute.before` | `throw Error()` to block |
| PreToolUse (blocking) | `permission.ask` | `output.status = "deny"` |
| PostToolUse | `tool.execute.after` | Read-only observation |
| UserPromptSubmit | `chat.message` | Filter `role === "user"` |
| Stop | `event` | Filter `session.ended` |
| SubagentStop | `tool.execute.after` | Filter `tool === "Task"` |

**Reference Implementation:** `plugins/pai-unified.ts`
**Type Definitions:** `plugins/adapters/types.ts` (includes `PAI_TO_OPENCODE_HOOKS` mapping)

---

## Available Plugin Hooks

OpenCode supports the following plugin hooks:

### 1. **experimental.chat.system.transform** (SessionStart equivalent)

**When:** At the start of each chat/session
**Purpose:** Inject system context into the conversation

**Example:**
```typescript
"experimental.chat.system.transform": async (input, output) => {
  const result = await loadContext();
  if (result.success && result.context) {
    output.system.push(result.context);
  }
}
```

**Current Implementation:**
- `context-loader.ts` - Reads `skills/CORE/SKILL.md` and injects PAI context
- Loads SYSTEM/*.md files for architecture documentation
- Loads USER/TELOS/*.md for personal context

---

### 2. **tool.execute.before** (PreToolUse equivalent)

**When:** Before any tool execution
**Purpose:** Security validation, can BLOCK by throwing an error

**Example:**
```typescript
"tool.execute.before": async (input, output) => {
  const result = await validateSecurity({
    tool: input.tool,
    args: output.args ?? {},
  });

  if (result.action === "block") {
    throw new Error(`[PAI Security] ${result.message}`);
  }
}
```

**Current Implementation:**
- `security-validator.ts` - Validates Bash commands against security patterns
- Blocks destructive commands (rm -rf /, reverse shells, etc.)
- See `plugins/adapters/types.ts` for `DANGEROUS_PATTERNS`

---

### 3. **permission.ask** (PreToolUse blocking equivalent)

**When:** When OpenCode asks for permission on a tool
**Purpose:** Override permission decisions

**Example:**
```typescript
"permission.ask": async (input, output) => {
  const result = await validateSecurity({ tool, args });

  switch (result.action) {
    case "block":
      output.status = "deny";
      break;
    case "confirm":
      output.status = "ask";
      break;
    case "allow":
      // Don't modify - let it proceed
      break;
  }
}
```

**Note:** `permission.ask` is not reliably called for all tools, so security validation is also done in `tool.execute.before`.

---

### 4. **tool.execute.after** (PostToolUse equivalent)

**When:** After tool execution completes
**Purpose:** Observe results, capture learnings

**Example:**
```typescript
"tool.execute.after": async (input, output) => {
  // Check for Task tool (subagent) completion
  if (input.tool === "Task") {
    // Capture subagent learnings (future)
  }
}
```

**Current Implementation:**
- Logs tool completions for debugging
- Future: Learning capture, signal processing, work session tracking

---

### 5. **chat.message** (UserPromptSubmit equivalent)

**When:** When a chat message is sent
**Purpose:** Process user input, format enforcement, rating capture

**Example:**
```typescript
"chat.message": async (input, output) => {
  const role = input.message?.role || "unknown";
  const content = input.message?.content || "";

  // Only process user messages
  if (role !== "user") return;

  // Format enforcement, rating capture, etc.
}
```

**Current Implementation:**
- Filters for user messages only
- Future: Auto-work creation, rating capture, skill trigger detection

---

### 6. **event** (Stop/SessionEnd equivalent)

**When:** Session lifecycle events
**Purpose:** Handle session start/end, cleanup

**Example:**
```typescript
event: async (input) => {
  const eventType = input.event?.type || "";

  if (eventType.includes("session.created")) {
    // Session initialization
  }

  if (eventType.includes("session.ended") || eventType.includes("session.idle")) {
    // Session cleanup, save state
  }
}
```

**Current Implementation:**
- Logs session lifecycle events
- Future: Session cleanup, work session state persistence

---

## Plugin Architecture

```
plugins/
├── pai-unified.ts          # Main plugin (combines all functionality)
├── handlers/
│   ├── context-loader.ts   # SessionStart → CORE context injection
│   └── security-validator.ts  # PreToolUse → Security validation
├── adapters/
│   └── types.ts            # Shared types + PAI_TO_OPENCODE_HOOKS mapping
└── lib/
    ├── file-logger.ts      # Logging (avoids TUI corruption)
    └── model-config.js     # Model configuration
```

**Key Design Decisions:**

1. **Single Plugin File** - `pai-unified.ts` exports all hooks from one plugin
2. **Handler Separation** - Complex logic in `handlers/` for maintainability
3. **File Logging** - Never use `console.log` (corrupts OpenCode TUI), use `file-logger.ts`
4. **Fail-Open Security** - On error, don't block (avoid hanging OpenCode)

---

## Configuration

### Plugin Registration

Plugins are registered in `opencode.json` (project root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    ".opencode/plugins/pai-unified.ts"
  ]
}
```

### Identity Configuration

PAI-specific identity configuration is handled via:
- `USER/DAIDENTITY.md` → AI personality and voice settings
- `USER/TELOS/` → User context, goals, and preferences
- `opencode.json` → `username` field

---

## Logging

**CRITICAL:** Never use `console.log` in plugins - it corrupts the OpenCode TUI.

Use the file logger instead:

```typescript
import { fileLog, fileLogError, clearLog } from "./lib/file-logger";

fileLog("Plugin loaded");
fileLog("Warning message", "warn");
fileLogError("Something failed", error);
```

Log file location: `~/.opencode/plugins/debug.log`

---

## Security Patterns

Security validation uses pattern matching against dangerous commands:

**Blocked Patterns (DANGEROUS_PATTERNS):**
- `rm -rf /` - Root-level deletion
- `rm -rf ~/` - Home directory deletion
- `mkfs.` - Filesystem formatting
- `bash -i >&` - Reverse shells
- `curl | bash` - Remote code execution
- `cat .ssh/id_` - Credential theft

**Warning Patterns (WARNING_PATTERNS):**
- `git push --force` - Force push
- `git reset --hard` - Hard reset
- `npm install -g` - Global installs
- `docker rm` - Container removal

See `plugins/adapters/types.ts` for full pattern definitions.

---

## Troubleshooting

### Plugin Not Loading

**Check:**
1. Is plugin path correct in `opencode.json`?
2. Can Bun parse the TypeScript? `bun run .opencode/plugins/pai-unified.ts`
3. Are there TypeScript errors? Check `~/.opencode/plugins/debug.log`

### Context Not Injecting

**Check:**
1. Does `skills/CORE/SKILL.md` exist?
2. Check `~/.opencode/plugins/debug.log` for loading errors
3. Verify `context-loader.ts` can find the CORE skill directory

### Security Blocking Everything

**Check:**
1. Review `debug.log` for which pattern matched
2. Verify command is actually safe
3. Check for false positives in pattern matching

### TUI Corruption

**Cause:** Using `console.log` in plugin code

**Fix:** Replace all `console.log` with `fileLog` from `lib/file-logger.ts`

---

## Migration from Claude Code Hooks

If migrating from PAI's Claude Code implementation:

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `hooks/` directory | `plugins/` directory | Different location |
| `settings.json` hooks | `opencode.json` plugins | Different config |
| Exit code 2 to block | `throw Error()` | Different mechanism |
| Reads stdin for input | Function parameters | Different API |
| Multiple hook files | Single unified plugin | Recommended pattern |

**Key Differences:**
1. OpenCode plugins use async functions, not external scripts
2. Blocking uses `throw Error()` instead of `exit(2)`
3. Input comes from function parameters, not stdin
4. All hooks can be combined in one plugin file

---

## Related Documentation

- **Memory System:** `SYSTEM/MEMORYSYSTEM.md`
- **Agent System:** `SYSTEM/PAIAGENTSYSTEM.md`
- **Architecture:** `SYSTEM/PAISYSTEMARCHITECTURE.md`
- **Security Patterns:** `plugins/adapters/types.ts`

---

**Last Updated:** 2026-01-22
**Status:** Production - All plugins active and tested
**Maintainer:** PAI System
