# Hook to Plugin Translation Guide

**Claude Code Hooks → OpenCode Plugins**

This guide helps PAI users migrate custom hooks from Claude Code to OpenCode plugins. It preserves the comprehensive documentation from the original THEHOOKSYSTEM.md (~1300 lines) and translates patterns to OpenCode equivalents.

---

## Table of Contents

1. [Overview](#overview)
2. [Hook Types Translation](#hook-types-translation)
3. [Common Patterns](#common-patterns)
4. [Plugin Development Best Practices](#plugin-development-best-practices)
5. [Troubleshooting](#troubleshooting)
6. [Advanced Topics](#advanced-topics)
7. [Shared Libraries](#shared-libraries)

---

## Overview

### Claude Code Hook System (Original)

```
Location: ~/.claude/hooks/
Configuration: ~/.claude/settings.json
Execution: External scripts via stdin/stdout
Blocking: Exit code 2
```

### OpenCode Plugin System (Target)

```
Location: ~/.opencode/plugins/
Configuration: opencode.json
Execution: TypeScript async functions
Blocking: throw Error()
```

### Key Differences Summary

| Aspect | Claude Code Hooks | OpenCode Plugins |
|--------|-------------------|------------------|
| **Location** | `hooks/` directory | `plugins/` directory |
| **Config** | `settings.json` hooks | `opencode.json` plugins |
| **Format** | External scripts | TypeScript modules |
| **Input** | stdin JSON | Function parameters |
| **Output** | stdout/stderr | Return value or throw |
| **Blocking** | `exit(2)` | `throw Error()` |
| **Naming** | `sessionId` (camelCase) | `sessionID` (PascalCase) |
| **Tool names** | PascalCase (`Bash`) | lowercase (`bash`) |

---

## Hook Types Translation

### 1. SessionStart → experimental.chat.system.transform

**Claude Code:**
```typescript
// hooks/session-start.ts
interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  // Load context
  const coreSkill = await Bun.file('skills/CORE/SKILL.md').text();

  // Output as system reminder
  console.log(`<system-reminder>${coreSkill}</system-reminder>`);
  process.exit(0);
}
```

**OpenCode:**
```typescript
// plugins/context-loader.ts
"experimental.chat.system.transform": async (input, output) => {
  const skillPath = join(process.cwd(), ".opencode/skills/CORE/SKILL.md");

  if (await exists(skillPath)) {
    const content = await Bun.file(skillPath).text();
    output.system.push(content);
  }
}
```

**Key Changes:**
- No stdin parsing needed
- Use `output.system.push()` instead of stdout
- Async function, not external script

---

### 2. PreToolUse → tool.execute.before

**Claude Code:**
```typescript
// hooks/security-validator.ts
interface HookInput {
  tool_name: string;
  tool_input: { command?: string };
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  if (isDangerous(input.tool_input.command)) {
    console.error("Blocked: dangerous command");
    process.exit(2);  // Exit code 2 = BLOCK
  }

  process.exit(0);  // Allow
}
```

**OpenCode:**
```typescript
// plugins/security-validator.ts
"tool.execute.before": async (input, output) => {
  // CRITICAL: Args are in output.args, NOT input.args!
  const command = output.args?.command;

  if (isDangerous(command)) {
    throw new Error("[PAI Security] Blocked: dangerous command");
  }

  // No return = allow
}
```

**Key Changes:**
- Args in `output.args`, NOT `input.args` (CRITICAL!)
- Use `throw Error()` instead of `exit(2)`
- Tool names are lowercase (`bash` not `Bash`)

---

### 3. PostToolUse → tool.execute.after

**Claude Code:**
```typescript
// hooks/capture-tool.ts
interface HookInput {
  tool_name: string;
  tool_output: any;
  error?: string;
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  // Log to history
  await captureToHistory(input.tool_name, input.tool_output);

  process.exit(0);
}
```

**OpenCode:**
```typescript
// plugins/history-capture.ts
"tool.execute.after": async (input, output) => {
  const { tool, sessionID, callID } = input;
  const { title, output: toolOutput, metadata } = output;

  // Log to history
  await captureToHistory(tool, toolOutput);

  // Detect subagent completion
  if (tool === "Task") {
    // This is SubagentStop equivalent
    await captureAgentOutput(toolOutput);
  }
}
```

**Key Changes:**
- Access via function parameters
- SubagentStop detection via `tool === "Task"` filter

---

### 4. Stop → event (session.idle)

**Claude Code:**
```typescript
// hooks/stop-orchestrator.ts
interface HookInput {
  session_id: string;
  transcript_path: string;
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  // Voice notification
  await sendVoiceNotification(extractCompletion(input));

  // Capture work
  await captureWork(input);

  // Update tab
  await updateTabState('completed');

  process.exit(0);
}
```

**OpenCode:**
```typescript
// plugins/session-lifecycle.ts
event: async (input) => {
  const eventType = input.event?.type || "";

  if (eventType.includes("session.idle") || eventType.includes("session.ended")) {
    // Voice notification
    await sendVoiceNotification();

    // Capture work
    await captureWork();

    // Cleanup
    await sessionCleanup();
  }
}
```

**Key Changes:**
- Check event type string, not dedicated hook
- No transcript_path in input (access differently)

---

### 5. UserPromptSubmit → chat.message

**Claude Code:**
```typescript
// hooks/prompt-capture.ts
interface HookInput {
  prompt: string;
  session_id: string;
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  // Update tab title
  await updateTabTitle(summarize(input.prompt));

  // Capture ratings
  if (isRating(input.prompt)) {
    await captureRating(input.prompt);
  }

  process.exit(0);
}
```

**OpenCode:**
```typescript
// plugins/prompt-handler.ts
"chat.message": async (input, output) => {
  const role = input.message?.role || "unknown";
  const content = input.message?.content || "";

  // Only process user messages
  if (role !== "user") return;

  // Update tab title
  await updateTabTitle(summarize(content));

  // Capture ratings
  if (isRating(content)) {
    await captureRating(content);
  }
}
```

**Key Changes:**
- Filter for `role === "user"`
- Content in `input.message.content`

---

### 6. SubagentStop → tool.execute.after + filter

**Claude Code:**
```typescript
// hooks/agent-capture.ts
interface HookInput {
  session_id: string;
  transcript_path: string;
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());

  // Wait for Task tool result
  await waitForTaskResult(input.transcript_path);

  // Extract agent type and output
  const agentType = extractAgentType(output);
  await routeToHistory(agentType, output);

  process.exit(0);
}
```

**OpenCode:**
```typescript
// plugins/agent-handler.ts
"tool.execute.after": async (input, output) => {
  // Filter for Task tool only
  if (input.tool !== "Task") return;

  // Extract agent type from output
  const agentMatch = output.output?.match(/\[AGENT:(\w+)\]/);
  const agentType = agentMatch?.[1] || "general";

  await routeToHistory(agentType, output.output);
}
```

**Key Changes:**
- No dedicated hook, filter in `tool.execute.after`
- No transcript parsing needed, output in function params

---

## Common Patterns

### Pattern 1: Voice Notifications

**Claude Code:**
```typescript
import { getIdentity } from './lib/identity';

const identity = getIdentity();  // From settings.json
const completionMessage = extractCompletionMessage(lastMessage);

const payload = {
  title: identity.name,
  message: completionMessage,
  voice_enabled: true,
  voice_id: identity.voiceId
};

await fetch('http://localhost:8888/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

**OpenCode (Same Pattern):**
```typescript
// Voice server API is identical
// Only change: how you get identity config

import { readConfig } from './lib/config';

const config = readConfig();  // From opencode.json or skill files
const payload = {
  title: config.daidentity?.name || "PAI",
  message: completionMessage,
  voice_enabled: true,
  voice_id: config.daidentity?.voiceId
};

await fetch('http://localhost:8888/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

---

### Pattern 2: History Capture (UOCS)

**File Naming Convention (unchanged):**
```
YYYY-MM-DD-HHMMSS_TYPE_description.md
```

**Types:**
- `WORK` - General task completions
- `LEARNING` - Problem-solving learnings
- `SESSION` - Session summaries
- `RESEARCH` - Research findings (from agents)
- `FEATURE` - Feature implementations (from agents)
- `DECISION` - Architectural decisions (from agents)

**Claude Code:**
```typescript
const structured = extractStructuredSections(lastMessage);
const isLearning = isLearningCapture(text, structured.summary);

const currentWork = readCurrentWork();  // STATE/current-work.json
if (currentWork) {
  updateWorkItem(currentWork.work_dir, structured);
}

if (isLearning) {
  const category = getLearningCategory(text);  // 'SYSTEM' or 'ALGORITHM'
  const targetDir = join(baseDir, 'MEMORY', 'LEARNING', category, getYearMonth());
  writeFileSync(join(targetDir, filename), content);
}
```

**OpenCode (Same Pattern):**
```typescript
// Same logic, same file structure
// Only change: how you read the current state

const structured = extractStructuredSections(toolOutput);
const isLearning = isLearningCapture(toolOutput, structured.summary);

const currentWork = await readCurrentWork();  // MEMORY/STATE/current-work.json
if (currentWork) {
  await updateWorkItem(currentWork.work_dir, structured);
}

if (isLearning) {
  const category = getLearningCategory(toolOutput);
  const targetDir = join(paiDir, 'MEMORY', 'Learning', category, getYearMonth());
  await Bun.write(join(targetDir, filename), content);
}
```

---

### Pattern 3: Agent Type Detection

**Claude Code:**
```typescript
let agentName = getAgentForSession(sessionId);

// Detect from Task tool
if (hookData.tool_name === 'Task' && hookData.tool_input?.subagent_type) {
  agentName = hookData.tool_input.subagent_type;
  setAgentForSession(sessionId, agentName);
}

// Detect from env variable
else if (process.env.CLAUDE_CODE_AGENT) {
  agentName = process.env.CLAUDE_CODE_AGENT;
}

// Detect from path
else if (hookData.cwd?.includes('/agents/')) {
  const match = hookData.cwd.match(/\/agents\/([^\/]+)/);
  if (match) agentName = match[1];
}
```

**OpenCode:**
```typescript
"tool.execute.after": async (input, output) => {
  if (input.tool !== "Task") return;

  // Agent type from completion message
  const agentMatch = output.output?.match(/\[AGENT:(\w+)\]/);
  const agentType = agentMatch?.[1] || "general-purpose";

  // Route to appropriate history
  const historyMap = {
    'engineer': 'execution/features/',
    'researcher': 'research/',
    'pentester': 'research/',
    'intern': 'research/',
  };

  const targetDir = historyMap[agentType] || 'research/';
  await captureToHistory(targetDir, output.output);
}
```

---

### Pattern 4: Tab Title + Color State

**States:**
| State | Color | Suffix | Trigger |
|-------|-------|--------|---------|
| Working | Orange `#B35A00` | `…` | User prompt submitted |
| Inference | Orange `#B35A00` | `🧠…` | AI thinking |
| Completed | Green `#022800` | (none) | Task done |
| Awaiting | Teal `#0D6969` | `?` | AskUserQuestion detected |
| Error | Orange `#B35A00` | `!` | Error pattern detected |

**Claude Code (Kitty Terminal):**
```typescript
// Set tab title immediately
execSync(`printf '\\033]0;${titleWithEmoji}\\007' >&2`);

// Background process for Haiku summary
Bun.spawn(['bun', `${paiDir}/hooks/UpdateTabTitle.ts`, prompt], {
  stdout: 'ignore',
  stderr: 'ignore',
});
```

**OpenCode:**
Tab state is typically handled through terminal emulator integration. The same Kitty escape sequences work, but they should be in a utility function:

```typescript
// lib/tab-state.ts
export function setTabState(state: 'working' | 'completed' | 'awaiting' | 'error', title: string) {
  const colors = {
    working: '#B35A00',
    completed: '#022800',
    awaiting: '#0D6969',
    error: '#B35A00',
  };

  const suffixes = {
    working: '…',
    completed: '',
    awaiting: '?',
    error: '!',
  };

  const fullTitle = title + suffixes[state];

  // Kitty terminal escape sequence
  if (process.env.TERM === 'xterm-kitty') {
    process.stderr.write(`\x1b]0;${fullTitle}\x07`);
  }
}
```

---

### Pattern 5: Async Non-Blocking Execution

**Claude Code:**
```typescript
// Set immediate state (fast)
execSync(`printf '\\033]0;${title}\\007' >&2`);

// Launch background process for slow work
Bun.spawn(['bun', `${paiDir}/hooks/SlowTask.ts`], {
  stdout: 'ignore',
  stderr: 'ignore',
});

process.exit(0);  // Exit immediately
```

**OpenCode:**
```typescript
// Plugins are async, so just don't await slow operations
"chat.message": async (input, output) => {
  // Fast operation - do immediately
  setTabState('working', 'Processing');

  // Slow operation - don't await
  slowAsyncOperation().catch(err => {
    fileLogError("Background task failed", err);
  });

  // Plugin returns immediately
}
```

---

### Pattern 6: Graceful Failure

**Claude Code:**
```typescript
async function main() {
  try {
    // Hook logic
  } catch (error) {
    console.error('Hook error:', error);
  }
  process.exit(0);  // ALWAYS exit 0
}
```

**OpenCode:**
```typescript
"tool.execute.after": async (input, output) => {
  try {
    // Plugin logic
  } catch (error) {
    fileLogError("Plugin error", error);
    // Don't throw - session continues
  }
}

// EXCEPTION: Security hooks should let errors propagate
"tool.execute.before": async (input, output) => {
  // NO try/catch for security validation
  const result = await validateSecurity({ ... });
  if (result.action === "block") {
    throw new Error("Blocked!");  // This SHOULD propagate
  }
}
```

---

## Plugin Development Best Practices

### 1. Fast Execution
- Plugins should complete in < 500ms
- Use background tasks for slow work
- Don't await external services unless critical

### 2. TUI-Safe Logging
**CRITICAL: Never use `console.log` in OpenCode plugins!**

```typescript
// ❌ WRONG - corrupts TUI
console.log("Debug info");

// ✅ CORRECT - file logging
import { fileLog, fileLogError } from './lib/file-logger';
fileLog("Debug info");
fileLogError("Something failed", error);
```

Log file: `~/.opencode/plugins/debug.log`

### 3. Error Handling Strategy

| Hook Type | Strategy | Why |
|-----------|----------|-----|
| Security (`tool.execute.before`) | Let errors propagate | Must block dangerous commands |
| History (`tool.execute.after`) | Catch and log | Session must continue |
| Context (`experimental.chat.system.transform`) | Catch and log | Missing context != fatal |

### 4. File I/O
```typescript
// Check existence before reading
if (await exists(path)) {
  const content = await Bun.file(path).text();
}

// Create directories recursively
await mkdir(targetDir, { recursive: true });

// Use PST timestamps for consistency
const timestamp = getPSTTimestamp();
```

### 5. Environment Access
```typescript
// Claude Code: env vars from settings.json
process.env.PAI_DIR

// OpenCode: typically from process.cwd() or config
const paiDir = join(process.cwd(), '.opencode');
```

---

## Troubleshooting

### Plugin Not Loading

**Check:**
1. Is plugin path correct in `opencode.json`?
2. Can Bun parse it? `bun run .opencode/plugins/my-plugin.ts`
3. TypeScript errors? Check `~/.opencode/plugins/debug.log`
4. Did you restart OpenCode?

**Debug:**
```bash
# Test plugin directly
bun run .opencode/plugins/pai-unified.ts

# Check logs
tail -f ~/.opencode/plugins/debug.log
```

---

### Security Blocking Everything

**Check:**
1. Review `debug.log` for which pattern matched
2. Is command actually safe?
3. Pattern too broad?

**Common False Positives:**
- `rm` without `-rf` being blocked
- Safe paths being matched

**Fix:** Adjust patterns in `plugins/adapters/types.ts`

---

### TUI Corruption

**Cause:** Using `console.log` in plugin code

**Fix:** Replace ALL `console.log` with `fileLog`:
```typescript
import { fileLog } from './lib/file-logger';
fileLog("Message");
```

---

### Context Not Injecting

**Check:**
1. Does `skills/CORE/SKILL.md` exist?
2. Check debug.log for loading errors
3. Verify context-loader.ts can find CORE directory

**Debug:**
```bash
# Check if file exists
ls -la .opencode/skills/CORE/SKILL.md

# Check logs
grep "context" ~/.opencode/plugins/debug.log
```

---

### Stop Event Not Firing

**Claude Code Issue (documented):**
Stop events in Claude Code were unreliable. This is NOT an issue in OpenCode.

**OpenCode Equivalent:**
Use `event` handler with session.idle/session.ended filters:

```typescript
event: async (input) => {
  const eventType = input.event?.type || "";
  if (eventType.includes("session.idle")) {
    // Handle stop
  }
}
```

---

### Agent Detection Failing

**Check:**
1. Is `[AGENT:type]` tag in completion message?
2. Filter checking correct tool name? (`Task` not `task`)
3. Regex pattern correct?

**Fix:**
```typescript
// Ensure agents include tag
// In agent prompt:
"End with: 🎯 COMPLETED: [AGENT:engineer] Brief summary"

// In plugin:
const agentMatch = output.output?.match(/\[AGENT:(\w+)\]/i);
```

---

## Advanced Topics

### Multi-Hook Execution Order

**Claude Code:** Sequential in settings.json order
**OpenCode:** Plugin hooks execute independently

If you need ordered execution, combine into single handler:
```typescript
"tool.execute.after": async (input, output) => {
  // Step 1: Capture
  await captureToHistory(input, output);

  // Step 2: Process
  await processOutput(output);

  // Step 3: Notify
  await sendNotification();
}
```

---

### Hook Data Payloads

**Claude Code stdin payloads:**
```typescript
// SessionStart
{ session_id, transcript_path, cwd }

// UserPromptSubmit
{ session_id, transcript_path, prompt }

// PreToolUse
{ session_id, transcript_path, tool_name, tool_input }

// PostToolUse
{ session_id, transcript_path, tool_name, tool_input, tool_output, error? }

// Stop
{ session_id, transcript_path }
```

**OpenCode function parameters:**

```typescript
// experimental.chat.system.transform
input: { sessionID: string }
output: { system: string[] }

// tool.execute.before
input: { tool: string, sessionID: string, callID: string }
output: { args: any }

// tool.execute.after
input: { tool: string, sessionID: string, callID: string }
output: { title: string, output: string, metadata: object }

// chat.message
input: { message: { role: string, content: string } }

// event
input: { event: { type: string } }
```

---

### Matcher Patterns

**Claude Code:**
```json
{
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [...] },
    { "matcher": "*", "hooks": [...] }
  ]
}
```

**OpenCode:**
No built-in matcher - filter in handler:
```typescript
"tool.execute.before": async (input, output) => {
  // Filter for specific tools
  if (input.tool !== "bash") return;

  // Security validation
}
```

---

## Shared Libraries

### Time Utilities

```typescript
// lib/time.ts
export function getPSTTimestamp(): string;     // "2026-01-22 14:30:00 PST"
export function getPSTDate(): string;          // "2026-01-22"
export function getYearMonth(): string;        // "2026-01"
export function getFilenameTimestamp(): string; // "2026-01-22-143000"
```

### File Logger

```typescript
// lib/file-logger.ts
export function fileLog(message: string, level?: string): void;
export function fileLogError(message: string, error: unknown): void;
export function clearLog(): void;
```

### Identity Config

```typescript
// lib/identity.ts (Claude Code)
export function getIdentity(): DAIdentity;
export function getPrincipal(): Principal;
export function getDAName(): string;
export function getVoiceId(): string;

// OpenCode equivalent: Read from opencode.json or SKILL files
```

### Learning Utils

```typescript
// lib/learning-utils.ts
export function getLearningCategory(content: string): 'SYSTEM' | 'ALGORITHM';
export function isLearningCapture(text: string, summary?: string): boolean;
```

---

## Quick Reference Card

```
HOOK → PLUGIN TRANSLATION:
SessionStart      → experimental.chat.system.transform
PreToolUse        → tool.execute.before
PostToolUse       → tool.execute.after
Stop              → event (session.idle)
UserPromptSubmit  → chat.message
SubagentStop      → tool.execute.after + filter (tool === "Task")

KEY CHANGES:
- exit(2) → throw Error()
- stdin JSON → function parameters
- console.log → fileLog (TUI safe!)
- sessionId → sessionID
- "Bash" → "bash" (lowercase)
- output.args NOT input.args in tool.execute.before (CRITICAL!)

FILES:
Claude Code: ~/.claude/hooks/*, ~/.claude/settings.json
OpenCode:    ~/.opencode/plugins/*, opencode.json

LOGGING:
tail -f ~/.opencode/plugins/debug.log

TESTING:
bun run .opencode/plugins/pai-unified.ts
```

---

## Migration Checklist

When migrating a custom hook:

- [ ] Identify Claude Code hook type
- [ ] Find OpenCode equivalent (see table above)
- [ ] Rewrite stdin parsing to function parameters
- [ ] Change `exit(2)` to `throw Error()` (if blocking)
- [ ] Replace `console.log` with `fileLog`
- [ ] Change `sessionId` to `sessionID`
- [ ] Change tool names to lowercase
- [ ] Remember: args in `output.args` for tool.execute.before!
- [ ] Add to `opencode.json` plugins array
- [ ] Restart OpenCode
- [ ] Test and verify via debug.log

---

## References

- **Plugin Architecture:** `docs/PLUGIN-ARCHITECTURE.md`
- **Event Mapping:** `docs/EVENT-MAPPING.md`
- **Plugin System:** `.opencode/skills/CORE/SYSTEM/THEPLUGINSYSTEM.md`
- **Type Definitions:** `.opencode/plugins/adapters/types.ts`
- **Original Hooks Docs:** `.opencode/skills/CORE/SYSTEM/_archive/THEHOOKSYSTEM-claudecode.md`

---

**Last Updated:** 2026-01-22
**Version:** 0.9.8
**Status:** COMPLETE - Migration Guide from THEHOOKSYSTEM.md content
