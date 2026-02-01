# Plugin System

**Event-Driven Automation Infrastructure for OpenCode**

**Location:** `~/.config/opencode/plugins/`
**Configuration:** `~/.config/opencode/opencode.json`
**Status:** Active - All plugins running in production

---

## Overview

The PAI plugin system is an event-driven automation infrastructure built on OpenCode's native plugin API. Plugins are TypeScript modules that run automatically in response to specific events during OpenCode sessions.

**Core Capabilities:**
- **Session Management** - Auto-load context, capture summaries, manage state
- **Security Validation** - Block dangerous commands before execution
- **Tool Lifecycle** - Pre/post processing for tool executions
- **Voice Notifications** - Text-to-speech announcements for task completions
- **History Capture** - Automatic work/learning documentation to `~/.config/opencode/MEMORY/`

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
| UserPromptSubmit | `event` (message.*) | Parse `message.updated` / `message.part.updated` |
| Stop | `event` | Filter `session.deleted` / `session.status` idle |
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
- `context-loader.ts` - Reads `~/.config/opencode/skills/CORE/SKILL.md` and injects PAI context
- Loads `~/.config/opencode/skills/CORE/SYSTEM/*.md` for system documentation
- Loads `~/.config/opencode/skills/CORE/USER/TELOS/*.md` for personal context

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
- See `PAISECURITYSYSTEM/patterns.example.yaml` for defaults

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
- Captures subagent outputs (Task tool)
- Passes tool lifecycle to history capture

---

### 5. **event (message.*)** (UserPromptSubmit equivalent)

**When:** OpenCode emits `message.updated` / `message.part.updated`
**Purpose:** Process user input, assemble assistant output, trigger ISC capture

**Example:**
```typescript
event: async (input) => {
  if (input.event.type === "message.updated") {
    const role = input.event.properties?.info?.role;
    const messageId = input.event.properties?.info?.id;
    // Use role + messageId to commit user/assistant messages
  }
}
```

**Current Implementation:**
- Uses event stream for message metadata + parts
- Assembles full text from `message.part.updated` (TextPart)

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

  if (eventType.includes("session.deleted") || eventType.includes("session.status")) {
    // Session cleanup, save state
  }
}
```

**Current Implementation:**
- Uses `session.status` (idle) for commit boundaries
- Uses `session.deleted` for hard finalization

---

## Plugin Architecture

```
plugins/
├── pai-unified.ts          # Main plugin (combines all functionality)
├── handlers/
│   ├── context-loader.ts   # SessionStart → CORE context injection
│   ├── security-validator.ts  # PreToolUse → Security validation
│   ├── history-capture.ts   # message.* + session.* → WORK/RAW/ISC
│   ├── isc-parser.ts        # Parse ISC from assistant response
│   └── work-tracker.ts      # Work session lifecycle + ISC snapshots
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

### Plugin Registration (Auto-Discovery)

OpenCode **automatically discovers** plugins from the `plugins/` directory - **no config entry needed!**

```
~/.config/opencode/
  plugins/
    pai-unified.ts    # ✅ Auto-discovered and loaded
    my-plugin.ts      # ✅ Also auto-discovered
```

OpenCode scans `{plugin,plugins}/*.{ts,js}` and loads all matching files automatically.

**Important:** Do NOT add relative paths to `opencode.json` - this causes `BunInstallFailedError`.

If you must explicitly register a plugin (e.g., from npm or absolute path), use:

```json
{
  "plugin": [
    "some-npm-package",
    "file:///absolute/path/to/plugin.ts"
  ]
}
```

**Note:** The config key is `plugin` (singular), not `plugins` (plural).

### Identity Configuration

PAI-specific identity configuration is handled via:
- `~/.config/opencode/skills/CORE/USER/DAIDENTITY.md` → AI personality and voice settings
- `~/.config/opencode/skills/CORE/USER/TELOS/` → User context, goals, and preferences
- `~/.config/opencode/opencode.json` → `username` field

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

Plugin log location: `~/.config/opencode/plugins/debug.log`
Security audit log: `~/.config/opencode/MEMORY/SECURITY/YYYY-MM/security.jsonl`

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

See `~/.config/opencode/PAISECURITYSYSTEM/patterns.example.yaml` for full pattern definitions.

---

## Troubleshooting

### Plugin Not Loading

**Check:**
1. Is the plugin file in `~/.config/opencode/plugins/`? (Auto-discovery location)
2. Can Bun parse the TypeScript? `bun run ~/.config/opencode/plugins/pai-unified.ts`
3. Are there TypeScript errors? Check `~/.config/opencode/plugins/debug.log`
4. If using `opencode.json`: Use `plugin` (singular), not `plugins` (plural)
5. If using explicit paths: Use `file://` URL format, not relative paths

### Context Not Injecting

**Check:**
1. Does `~/.config/opencode/skills/CORE/SKILL.md` exist?
2. Check `~/.config/opencode/plugins/debug.log` for loading errors
3. Verify `context-loader.ts` can find the CORE skill directory

### Security Blocking Everything

**Check:**
1. Review `MEMORY/SECURITY/YYYY-MM/security.jsonl` for matched rule id
2. Verify command is actually safe
3. Check for false positives in pattern matching
4. Check `plugins/debug.log` for validator errors

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

- **Memory System:** `~/.config/opencode/skills/CORE/SYSTEM/MEMORYSYSTEM.md`
- **Agent System:** `~/.config/opencode/skills/CORE/SYSTEM/PAIAGENTSYSTEM.md`
- **Architecture:** `~/.config/opencode/skills/CORE/SYSTEM/PAISYSTEMARCHITECTURE.md`
- **Security Patterns:** `~/.config/opencode/skills/CORE/SYSTEM/PAISECURITYSYSTEM/patterns.example.yaml`

---

**Last Updated:** 2026-01-31
**Status:** Production - All plugins active and tested
**Maintainer:** PAI System
