# Phase 8 Changes: Research Shell MCP Server Rewrite

## Overview
Rewrote `/Users/zuul/Projects/shovel-cite-redesign/src/mcp/research-shell/index.ts` to use direct API calls instead of CLI wrappers.

## File Statistics
- **Before**: 453 lines (CLI wrapper approach)
- **After**: 431 lines (Direct API approach)
- **Reduction**: 22 lines (4.9% smaller, cleaner codebase)

## Key Changes

### 1. Import Changes
**REMOVED:**
```typescript
import { type ExecFileException, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
```

**ADDED:**
```typescript
import { perplexitySearch } from './clients/perplexity.js';
import { geminiSearch } from './clients/gemini.js';
import { grokSearch } from './clients/grok.js';
import { loadConfig } from './config.js';
```

### 2. Configuration Cleanup
**REMOVED:**
- `CLI_TIMEOUT_MS` (no longer needed for direct API calls)
- `PAI_DIR` (no CLI paths required)
- `CLI_PATHS` configuration object (entire section removed)

**KEPT:**
- `MAX_QUERY_LENGTH` (security validation)
- `SAFE_QUERY_PATTERN` (input validation)
- `AGENT_TYPE` (H7 security)
- `AGENT_ALLOWED_TOOLS` (H7 security)

### 3. Interface Updates
**SearchResult Interface:**
```typescript
// BEFORE
interface SearchResult {
  success: boolean;
  content?: string;
  error?: string;
}

// AFTER
interface SearchResult {
  success: boolean;
  content?: string;
  citations?: string[];  // NEW: Citation tracking
  error?: string;
}
```

**EvidenceEntry Interface:**
```typescript
// ADDED
citationCount?: number;  // Track citation counts in evidence logs
```

### 4. Core Execution Rewrite
**executeSearch() Function:**

**BEFORE (CLI Wrapper):**
```typescript
async function executeSearch(...): Promise<SearchResult> {
  const cliConfig = CLI_PATHS[tool];
  const args = [...cliConfig.args, sanitizedQuery];
  
  const { stdout, stderr } = await execFileAsync(cliConfig.path, args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  
  return { success: true, content: stdout };
}
```

**AFTER (Direct API):**
```typescript
async function executeSearch(...): Promise<SearchResult> {
  const config = loadConfig();
  
  let result: SearchResult;
  switch (tool) {
    case 'perplexity':
      result = await perplexitySearch(sanitizedQuery, config.perplexity);
      break;
    case 'gemini':
      result = await geminiSearch(sanitizedQuery, config.gemini);
      break;
    case 'grok':
      result = await grokSearch(sanitizedQuery, config.grok);
      break;
  }
  
  // Format response with citations
  let output = result.content || '';
  if (result.citations && result.citations.length > 0) {
    output += '\n\n--- Citations ---\n';
    result.citations.forEach((url, i) => {
      output += `[${i + 1}] ${url}\n`;
    });
  }
  
  return { success: true, content: output };
}
```

### 5. Enhanced Evidence Logging
Now captures citation metadata:
```typescript
await logEvidence(sessionDir, {
  timestamp: new Date().toISOString(),
  tool,
  query: sanitizedQuery,
  success: result.success,
  outputLength: result.content?.length,
  citationCount: result.citations?.length,  // NEW
});
```

### 6. Error Handling Improvements
**BEFORE:** CLI-specific error handling (ENOENT, timeout, killed process)
**AFTER:** Generic error handling with cleaner error messages

```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  // ... log evidence ...
  return { success: false, error: errorMessage };
}
```

## Security Features PRESERVED

### H7 Security (Lines 42-56, 324-376)
1. **AGENT_TYPE Environment Variable** - Agent identification
2. **AGENT_ALLOWED_TOOLS Mapping** - Tool restrictions per agent type
3. **ListTools Filtering** - Only expose allowed tools to each agent
4. **CallTool Validation** - Server-side enforcement of tool restrictions

### Input Validation (Lines 58-106)
1. **validateQuery()** function - Unchanged
2. **SAFE_QUERY_PATTERN** - Allowlist-only characters
3. **MAX_QUERY_LENGTH** - 4000 character limit
4. **Whitespace normalization** - Prevent injection

### Evidence Logging (Lines 108-141)
1. **logEvidence()** function - Unchanged implementation
2. **JSONL format** - Audit trail in `evidence/research-shell.jsonl`
3. **Enhanced tracking** - Now includes citation counts

## Security Improvements

1. **No Shell Interpretation**: Direct API calls eliminate shell injection risk entirely
2. **No External Processes**: No process spawning vulnerabilities
3. **Type Safety**: TypeScript interfaces ensure proper API contracts
4. **Centralized Config**: Single `loadConfig()` reduces configuration errors

## Dependencies on Parallel Work

This rewrite depends on other agents creating:
1. `/Users/zuul/Projects/shovel-cite-redesign/src/mcp/research-shell/clients/perplexity.ts`
2. `/Users/zuul/Projects/shovel-cite-redesign/src/mcp/research-shell/clients/gemini.ts`
3. `/Users/zuul/Projects/shovel-cite-redesign/src/mcp/research-shell/clients/grok.ts`
4. `/Users/zuul/Projects/shovel-cite-redesign/src/mcp/research-shell/config.ts`

## Testing Recommendations

1. **Unit Tests**: Test `executeSearch()` with mocked API clients
2. **Integration Tests**: Test full MCP server with real API credentials
3. **Security Tests**: Verify H7 agent type restrictions still work
4. **Input Validation**: Test query validation edge cases
5. **Evidence Logging**: Verify JSONL logs include citation counts

## Migration Notes

- No changes to MCP server interface (tools, arguments, responses)
- Existing agents will work without modification
- Evidence logs now include citation metadata
- Citation formatting automatically added to all responses
