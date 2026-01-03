# Event Mapping: Claude Code → OpenCode

**PAI-OpenCode v0.5 Plugin Infrastructure**

This document maps Claude Code hooks to OpenCode events, documents event payloads, and highlights critical differences discovered through research.

---

## Overview

Claude Code uses a **hook-based system** with specific named hooks (e.g., `SessionStart`, `PostToolUse`). OpenCode uses an **event-based system** with dot-notation events (e.g., `session.created`, `tool.execute.after`).

This document provides the verified mapping between the two systems based on DeepWiki research conducted on 2026-01-02.

---

## Event Mapping Table

| Claude Code Hook | OpenCode Event | Payload Type | Use Case | Notes |
|------------------|----------------|--------------|----------|-------|
| `SessionStart` | `session.created` | `SessionCreatedPayload` | Initialize session, load context | Fires on new session creation |
| `SessionEnd` | `session.idle` | `SessionIdlePayload` | Generate summary, update index | **No separate `session.end` exists** |
| `Stop` | `session.idle` | `SessionIdlePayload` | Voice feedback, cleanup | **Same event as SessionEnd** |
| `PostToolUse` | `tool.execute.after` | `ToolExecuteAfterPayload` | Capture tool outputs, history | Fires after tool completes |
| `SubagentStop` | `tool.execute.after` | `ToolExecuteAfterPayload` | Agent output routing | **Filter by `tool === "Task"`** |

---

## Critical Differences

### Non-Existent Events (MUST AVOID)

These events **DO NOT exist** in OpenCode:

| Non-Existent Event | Status | Correct Alternative |
|-------------------|--------|---------------------|
| `task.complete` | ❌ DOES NOT EXIST | Use `tool.execute.after` with filter `event.tool === "Task"` |
| `session.end` | ❌ DOES NOT EXIST | Use `session.idle` instead |

**Source:** Verified via DeepWiki research (G-003), official OpenCode documentation, and community plugin analysis.

### Event Disambiguation

#### session.idle (Dual Purpose)

The `session.idle` event serves BOTH `Stop` and `SessionEnd` use cases from Claude Code:

```typescript
"session.idle": async ({ sessionID, duration }) => {
  // This event fires for BOTH:
  // 1. User clicking Stop button
  // 2. Session naturally ending due to inactivity

  // Differentiation strategy (to be implemented in v0.6):
  // - Check duration: short duration = Stop, longer = SessionEnd
  // - Track plugin state: last activity timestamp
  // - Analyze context: presence of COMPLETED line suggests Stop
}
```

#### tool.execute.after (SubagentStop Detection)

The `tool.execute.after` event captures ALL tool executions. To identify agent completions:

```typescript
"tool.execute.after": async (input, output) => {
  const { tool } = input;

  // Detect Task tool (agent delegation)
  if (tool === "Task") {
    console.log('[PAI] Agent task completed (SubagentStop)');

    // v0.6 will add:
    // - Parse COMPLETED line from output
    // - Extract agent type (engineer, researcher, etc.)
    // - Route to appropriate history handler
  }
}
```

---

## Event Payload Structures

All payload interfaces below are **VERIFIED** via DeepWiki research (G-001, G-002, G-003, G-006).

### tool.execute.before (G-001)

```typescript
interface ToolExecuteBeforePayload {
  input: {
    tool: string;      // Tool name (e.g., "Bash", "Edit", "Task")
    sessionID: string; // Current session identifier
    callID: string;    // Unique call identifier
  };
  output: {
    args: any;         // Tool arguments for inspection
  };
}
```

**Use Cases:**
- Security validation
- Tool argument inspection
- Blocking dangerous operations

**Example:**
```typescript
"tool.execute.before": async ({ input, output }) => {
  const { tool, sessionID } = input;
  const { args } = output;

  // Block execution by throwing
  if (isDangerous(args)) {
    throw new Error('Blocked by security validation');
  }
}
```

---

### tool.execute.after (G-006)

```typescript
interface ToolExecuteAfterPayload {
  input: {
    tool: string;      // Tool name (e.g., "Bash", "Edit", "Task")
    sessionID: string; // Current session identifier
    callID: string;    // Unique call identifier
  };
  output: {
    title: string;     // Tool execution title
    output: string;    // Tool output content
    metadata: object;  // Additional metadata
  };
}
```

**Use Cases:**
- History capture
- Tool output logging
- Agent completion detection (SubagentStop)

**Example:**
```typescript
"tool.execute.after": async (input, output) => {
  const { tool, sessionID, callID } = input;
  const { title, output: toolOutput, metadata } = output;

  console.log(`[PAI] ${tool} executed in session ${sessionID}`);

  // Detect agent completion
  if (tool === "Task") {
    console.log('[PAI] Agent task completed');
    console.log('[PAI] Output:', toolOutput.substring(0, 100) + '...');
  }
}
```

---

### session.created (G-002)

```typescript
interface SessionCreatedPayload {
  sessionID: string;   // Session identifier
  projectID: string;   // Project identifier
  model?: string;      // Model used for session (optional)
  parentID?: string;   // Parent session if subagent (optional)
}
```

**Use Cases:**
- Session initialization
- Directory creation
- Context loading (CORE skill)
- Subagent detection

**Example:**
```typescript
"session.created": async ({ sessionID, projectID, model, parentID }) => {
  console.log(`[PAI] New session: ${sessionID}`);
  console.log(`[PAI] Project: ${projectID}`);

  if (model) {
    console.log(`[PAI] Using model: ${model}`);
  }

  if (parentID) {
    console.log(`[PAI] Subagent session (parent: ${parentID})`);
  }

  // v0.6 will add:
  // - Create session directory: ${PAI_DIR}/history/sessions/YYYY-MM/
  // - Initialize INDEX.json entry
  // - Load CORE skill context
}
```

---

### session.idle (G-003)

```typescript
interface SessionIdlePayload {
  sessionID: string;   // Session identifier
  duration?: number;   // Duration of idle time in ms (optional)
}
```

**Use Cases:**
- Session cleanup (SessionEnd)
- Voice feedback (Stop)
- Summary generation
- INDEX.json update

**Example:**
```typescript
"session.idle": async ({ sessionID, duration }) => {
  console.log(`[PAI] Session idle: ${sessionID}`);

  if (duration) {
    console.log(`[PAI] Idle duration: ${duration}ms`);

    // Heuristic for Stop vs SessionEnd
    if (duration < 1000) {
      console.log('[PAI] Likely Stop button (short idle)');
    } else {
      console.log('[PAI] Likely SessionEnd (natural timeout)');
    }
  }

  // v0.6 will add:
  // - Generate session summary
  // - Update INDEX.json with keywords/tags
  // - Extract learnings if applicable
}
```

---

## Complete Event Catalog

OpenCode supports **33 events total** (verified via DeepWiki G-003). Below are the key events relevant to PAI:

| Event Category | Event Name | Status | v0.5 Usage |
|----------------|------------|--------|------------|
| **Session** | `session.created` | ✅ IMPLEMENTED | Initialize session |
| **Session** | `session.idle` | ✅ IMPLEMENTED | Cleanup, summary |
| **Tool** | `tool.execute.before` | ⏳ DEFERRED (v0.6) | Security validation |
| **Tool** | `tool.execute.after` | ✅ IMPLEMENTED | History capture |
| **User** | `user.prompt` | ⏳ DEFERRED (v0.6) | Prompt logging |
| **Context** | `context.update` | ⏳ DEFERRED (v0.6) | Context tracking |
| **Experimental** | `experimental.chat.system.transform` | ⏳ RESEARCH | Dynamic prompts |

**Full catalog available in research:** `~/.claude/history/projects/jeremy-2.0-opencode/research/2026-01-02_deepwiki-findings.md`

---

## Error Handling (G-007)

**CRITICAL FINDING:** Plugins are **NOT sandboxed or isolated**. Error propagation behaves differently than Claude Code hooks.

### Blocking Mechanism (tool.execute.before)

```typescript
"tool.execute.before": async ({ tool, args }) => {
  // NO try/catch - let errors propagate

  if (isDangerousOperation(args)) {
    // BLOCKING: Synchronous throw stops execution
    throw new Error('Operation blocked by security validation');
  }

  // Non-blocking: return normally
}
```

**Key Points:**
- Use `throw new Error("reason")` - NOT exit code 2
- Throwing blocks tool execution
- Error message shown to user
- Session does NOT crash

### Non-Blocking Pattern (History Plugins)

```typescript
"tool.execute.after": async (input, output) => {
  try {
    // Plugin logic
    await captureToolExecution(input, output);
  } catch (error) {
    // Log error, don't propagate (non-critical)
    console.error('[PAI] History capture failed:', error);
    // Session continues normally
  }
}
```

**Key Points:**
- ALWAYS wrap in try/catch
- NEVER throw errors from history plugins
- Log to console for debugging
- Session must continue even if capture fails

---

## Context Injection (G-002)

Four methods discovered for loading context at session start:

### Method 1: config.instructions (Recommended for v0.5)

```json
{
  "config": {
    "instructions": [
      ".opencode/skills/CORE/SKILL.md",
      ".opencode/skills/CORE/CONSTITUTION.md"
    ]
  }
}
```

**Pros:** Simple, static, reliable
**Cons:** No dynamic routing

### Method 2: session.created Hook (Recommended for v0.6)

```typescript
"session.created": async ({ sessionID, projectID }) => {
  const coreContext = await loadSkill('CORE');
  // Inject into session via internal API
}
```

**Pros:** Dynamic, project-aware
**Cons:** More complex implementation

### Method 3: experimental.chat.system.transform

```typescript
"experimental.chat.system.transform": async ({ system }) => {
  const coreContext = readFileSync('.opencode/skills/CORE/SKILL.md');
  return `${system}\n\n${coreContext}`;
}
```

**Pros:** Runtime system prompt modification
**Cons:** Experimental, may change

### Method 4: LOCAL_RULE_FILES (Legacy)

```typescript
const LOCAL_RULE_FILES = [
  '.opencode/skills/CORE/SKILL.md'
];
```

**Pros:** Simple legacy approach
**Cons:** Deprecated pattern

**Recommendation:** Use Method 1 for v0.5, transition to Method 2 in v0.6 for dynamic routing.

---

## Research Validation

All event payloads, behaviors, and patterns documented here were verified through:

1. **DeepWiki Analysis** (2026-01-02)
   - Queried official OpenCode wiki
   - Resolved 12 research gaps (4 CRITICAL, 8 HIGH)
   - Documented 33 events with exact interfaces

2. **Community Plugin Review**
   - https://github.com/ericc-ch/opencode-plugins
   - Verified event usage patterns
   - Confirmed non-existent events

3. **Official Documentation**
   - https://opencode.ai/docs/plugins/
   - https://opencode.ai/openapi.json
   - Verified event schemas

**Research artifacts:**
- `~/.claude/history/projects/jeremy-2.0-opencode/research/2026-01-02_deepwiki-findings.md` (47KB)
- `~/.claude/history/projects/jeremy-2.0-opencode/research/2026-01-02_opencode-plugin-events-verification.md`
- `~/.claude/History/learnings/2026-01/2026-01-02_deepwiki-validation-complete.md`

---

## Migration Guide (Claude Code → OpenCode)

### Hook Translation

| Step | Claude Code | OpenCode |
|------|-------------|----------|
| 1 | Create `.claude/hooks/session-start.ts` | Create `.opencode/plugin/pai-session-lifecycle/index.ts` |
| 2 | Export hook function | Export async function returning event handlers |
| 3 | `export default ({ sessionId }) => { }` | `"session.created": async ({ sessionID }) => { }` |
| 4 | Use `sessionId` (camelCase) | Use `sessionID` (PascalCase) |
| 5 | Throw errors to block | Throw errors in `tool.execute.before` only |

### Key Differences

1. **Naming Convention:**
   - Claude Code: `sessionId`, `projectId` (camelCase)
   - OpenCode: `sessionID`, `projectID` (PascalCase with ID suffix)

2. **Error Handling:**
   - Claude Code: Exit code 2 blocks execution
   - OpenCode: `throw Error()` blocks in `tool.execute.before`

3. **Event Structure:**
   - Claude Code: Single function per hook file
   - OpenCode: Object with multiple event handlers per plugin

4. **Loading:**
   - Claude Code: Hooks auto-discovered in `.claude/hooks/`
   - OpenCode: Plugins auto-discovered in `.opencode/plugin/`

---

## References

- **Research:** `~/.claude/history/projects/jeremy-2.0-opencode/research/`
- **Specification:** `specs/spec.md`
- **Plugin Architecture:** `docs/PLUGIN-ARCHITECTURE.md`
- **Official Docs:** https://opencode.ai/docs/plugins/
- **Community Plugins:** https://github.com/ericc-ch/opencode-plugins

---

**Last Updated:** 2026-01-02
**Version:** 0.5.0
**Status:** COMPLETE
**Research Validation:** DeepWiki Analysis Complete
