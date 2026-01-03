# Plugin Architecture

**PAI-OpenCode v0.5 Plugin Infrastructure**

This document describes the plugin architecture for PAI-OpenCode, including file structure, event registration patterns, and implementation guidelines.

---

## Overview

PAI-OpenCode uses the OpenCode plugin system to capture events and extend functionality. Plugins are TypeScript modules that export event handlers following a standardized pattern.

**Key Principles:**
- Plugins are self-contained TypeScript modules
- Each plugin lives in `.opencode/plugin/<name>/`
- Plugins use Bun runtime (not Node.js)
- Plugins follow defensive error handling patterns
- Plugins are non-blocking and async by default

---

## File Structure

### Directory Layout

```
.opencode/
└── plugin/
    ├── pai-post-tool-use/
    │   ├── index.ts          # Main plugin entry point
    │   └── package.json      # Plugin metadata
    └── pai-session-lifecycle/
        ├── index.ts          # Main plugin entry point
        └── package.json      # Plugin metadata
```

### package.json Template

Each plugin MUST include a `package.json` with the following fields:

```json
{
  "name": "@pai/<plugin-name>",
  "version": "0.5.0",
  "description": "Brief description of plugin purpose",
  "type": "module",
  "main": "index.ts",
  "author": "PAI Contributors",
  "license": "MIT"
}
```

**Key Fields:**
- `type: "module"` - Enables ES module syntax
- `main: "index.ts"` - Entry point for OpenCode to load
- `name: "@pai/<name>"` - Scoped package naming convention

---

## Event Registration Pattern

### Basic Structure

All plugins follow this pattern:

```typescript
/**
 * Plugin entry point
 * @param ctx - Plugin context provided by OpenCode
 */
export default async (ctx: unknown) => {
  console.log('[PAI] <Plugin Name> loaded');

  return {
    "event.name": async (payload) => {
      try {
        // Plugin logic here
        console.log(`[PAI] event.name:`, payload);

        // Process event data
        // ...

      } catch (error) {
        // Non-critical: log and continue
        console.error('[PAI] Handler failed:', error);
        // Session continues normally
      }
    }
  };
};
```

### Key Components

1. **Export default async function** - OpenCode expects this signature
2. **Console log on load** - Confirms plugin activated successfully
3. **Return object with event handlers** - Event names as keys, async functions as values
4. **Defensive try/catch** - CRITICAL for history plugins (see Error Handling below)

---

## Error Handling Patterns

### Non-Blocking Pattern (History Plugins)

**USE FOR:** PostToolUse, SessionLifecycle, and any history capture plugins

```typescript
export default async (ctx: unknown) => {
  console.log('[PAI] History Plugin loaded');

  return {
    "tool.execute.after": async (input, output) => {
      try {
        // Plugin logic
        await captureToolExecution(input, output);
      } catch (error) {
        // Log error, don't propagate (non-critical)
        console.error('[PAI] History capture failed:', error);
        // Session continues normally - NEVER throw!
      }
    }
  };
};
```

**Critical Rules:**
- ALWAYS wrap handler in try/catch
- NEVER throw errors from history plugins
- Log errors to console for debugging
- Session must continue even if history capture fails

### Blocking Pattern (Security/Validation Plugins)

**USE FOR:** PreToolUse security validation (v0.6+)

```typescript
export default async (ctx: unknown) => {
  console.log('[PAI] Security Validator loaded');

  return {
    "tool.execute.before": async ({ tool, args }) => {
      // NO try/catch - let errors propagate to block execution
      if (isDangerousOperation(args)) {
        // BLOCKING: Synchronous throw stops execution
        throw new Error('Operation blocked by security validation');
      }
      // Non-blocking: return normally
    }
  };
};
```

**Critical Rules:**
- DO NOT wrap in try/catch for security plugins
- Throwing errors BLOCKS tool execution
- Use ONLY when blocking is intentional
- Return normally to allow execution

---

## Plugin Examples

### Post-Tool-Use Plugin (Event Capture)

```typescript
/**
 * PAI Post-Tool-Use Plugin
 *
 * Captures all tool execution events for later processing.
 */

interface ToolExecuteAfterInput {
  tool: string;      // Tool name (e.g., "Bash", "Edit", "Task")
  sessionID: string; // Current session
  callID: string;    // Unique call identifier
}

interface ToolExecuteAfterOutput {
  title: string;     // Tool execution title
  output: string;    // Tool output content
  metadata: object;  // Additional metadata
}

export default async (ctx: unknown) => {
  console.log('[PAI] Post-Tool-Use plugin loaded');

  return {
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ) => {
      try {
        const timestamp = new Date().toISOString();
        const { tool, sessionID, callID } = input;
        const { title, output: toolOutput } = output;

        console.log(`[PAI] tool.execute.after: ${tool} at ${timestamp}`);
        console.log(`[PAI] sessionID: ${sessionID}, callID: ${callID}`);

        // Identify Task tool for SubagentStop use case
        if (tool === "Task") {
          console.log(`[PAI] Agent task completed`);
          const outputPreview = toolOutput?.substring(0, 100) || '(empty)';
          console.log(`[PAI] Output preview: ${outputPreview}...`);
        }

        // v0.6 will add: JSONL storage logic
      } catch (error) {
        console.error('[PAI] Post-tool-use handler failed:', error);
      }
    }
  };
};
```

### Session Lifecycle Plugin (Multi-Event)

```typescript
/**
 * PAI Session Lifecycle Plugin
 *
 * Captures session start and idle events.
 */

interface SessionCreatedPayload {
  sessionID: string;   // Session identifier
  projectID: string;   // Project identifier
  model?: string;      // Model used for session (optional)
  parentID?: string;   // Parent session if subagent (optional)
}

interface SessionIdlePayload {
  sessionID: string;   // Session identifier
  duration?: number;   // Duration of idle time in ms (optional)
}

export default async (ctx: unknown) => {
  console.log('[PAI] Session Lifecycle plugin loaded');

  return {
    "session.created": async (payload: SessionCreatedPayload) => {
      try {
        const timestamp = new Date().toISOString();
        const { sessionID, projectID, model, parentID } = payload;

        console.log(`[PAI] session.created: ${sessionID} at ${timestamp}`);
        console.log(`[PAI] projectID: ${projectID}`);
        if (model) console.log(`[PAI] model: ${model}`);
        if (parentID) console.log(`[PAI] parentID: ${parentID} (subagent)`);

        // v0.6 will add: directory initialization
      } catch (error) {
        console.error('[PAI] Session created handler failed:', error);
      }
    },

    "session.idle": async (payload: SessionIdlePayload) => {
      try {
        const timestamp = new Date().toISOString();
        const { sessionID, duration } = payload;

        console.log(`[PAI] session.idle: ${sessionID} at ${timestamp}`);
        if (duration) console.log(`[PAI] idle duration: ${duration}ms`);

        // v0.6 will add: session summary generation
      } catch (error) {
        console.error('[PAI] Session idle handler failed:', error);
      }
    }
  };
};
```

---

## Testing Plugins

### Manual Testing with Bun

```bash
# Create test script
cat > /tmp/test-plugins.ts << 'EOF'
const plugin = await import('/path/to/.opencode/plugin/my-plugin/index.ts');

console.log('Testing plugin loading...');

const ctx = {};
const handlers = await plugin.default(ctx);

console.log('✓ Plugin loaded successfully');
console.log('✓ Handlers:', Object.keys(handlers));
EOF

# Run test
bun /tmp/test-plugins.ts
```

### Expected Output

```
Testing plugin loading...
[PAI] My Plugin loaded
✓ Plugin loaded successfully
✓ Handlers: [ "event.name", "another.event" ]
```

---

## Performance Guidelines

### NFR-1: Performance Requirements

- Plugin loading SHALL complete in <500ms
- Event handlers SHALL complete in <50ms (v0.5 logging only)
- Plugins SHALL NOT block UI thread

### Optimization Tips

1. **Lazy Loading**: Load heavy dependencies only when needed
2. **Async Operations**: Use `await` for I/O operations
3. **Minimal Logging**: Only log essential information in production
4. **Early Returns**: Exit handlers quickly when conditions aren't met

Example:

```typescript
"tool.execute.after": async (input, output) => {
  try {
    // Early return for tools we don't care about
    if (input.tool !== "Task") return;

    // Only process Task tool events
    console.log(`[PAI] Agent task completed`);
    // ... rest of logic
  } catch (error) {
    console.error('[PAI] Handler failed:', error);
  }
}
```

---

## Roadmap

### v0.5 (Current)
- ✅ Plugin scaffolding
- ✅ Event registration patterns
- ✅ Logging-only implementation
- ✅ Error handling patterns

### v0.6 (History System)
- ⏳ JSONL file writing
- ⏳ Directory initialization
- ⏳ Context loading
- ⏳ Session summary generation
- ⏳ Agent output routing

---

## References

- **Specification:** `specs/spec.md`
- **Event Mapping:** `docs/EVENT-MAPPING.md`
- **OpenCode Docs:** https://opencode.ai/docs/plugins/
- **Research:** `~/.claude/history/projects/jeremy-2.0-opencode/research/`

---

**Last Updated:** 2026-01-02
**Version:** 0.5.0
**Status:** COMPLETE
