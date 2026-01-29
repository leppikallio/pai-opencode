#!/usr/bin/env node

/**
 * Research Shell MCP Server
 *
 * Provides hard-enforced tool restrictions for research agents.
 * Each agent type gets ONLY its designated research tool - no bypass possible.
 *
 * SECURITY:
 * - Direct API calls (no shell interpretation)
 * - Strict input validation with allowlist-only characters
 * - Query length limits to prevent injection
 * - Evidence capture for audit trail
 *
 * This server runs via stdio transport and is spawned by the Agent SDK.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { searchGemini as geminiSearch } from './clients/gemini.js';
import { grokSearch } from './clients/grok.js';
import { perplexitySearch } from './clients/perplexity.js';
import { loadConfig } from './config.js';
import { type RetryConfig, withRetry } from './retry.js';

// ============================================================================
// Configuration
// ============================================================================

/** Maximum query length to prevent injection via extremely long inputs */
const MAX_QUERY_LENGTH = 4000;

/** Allowlist for query characters - reject anything outside this */
const SAFE_QUERY_PATTERN = /^[\w\s.,!?'"():;\-–—@#$%&*+=[\]{}|\\/<>~`^\n]+$/u;

/**
 * H7: Agent type from environment (set by container)
 * Used for server-side validation to prevent tool misuse
 */
const AGENT_TYPE = process.env.AGENT_TYPE || '';

/**
 * H7: Mapping of agent types to their allowed tools
 * Empty means all tools are allowed (for development/local use)
 */
const AGENT_ALLOWED_TOOLS: Record<string, string[]> = {
  'perplexity-researcher': ['perplexity_search'],
  'gemini-researcher': ['gemini_search'],
  'grok-researcher': ['grok_search'],
  // Perspective agent uses Gemini for ensemble classification of uncertain perspectives
  'perspective-agent': ['gemini_search'],
};

/**
 * Retry configuration for API calls
 *
 * Essential for handling transient failures from:
 * - Rate limiting (429)
 * - Network issues
 * - Temporary API unavailability
 */
const RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000, // 30 seconds max
  backoffMultiplier: 2, // 1s -> 2s -> 4s
  jitter: true, // Prevent thundering herd
  debug: process.env.DEBUG === '1',
};

// ============================================================================
// Input Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validate and sanitize a search query
 *
 * SECURITY: This is the primary defense against injection attacks.
 * We use allowlist validation (safe characters only) rather than blocklist.
 */
function validateQuery(query: string): ValidationResult {
  // Check length
  if (!query || query.length === 0) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      error: `Query too long: ${query.length} > ${MAX_QUERY_LENGTH}`,
    };
  }

  // Trim whitespace
  const trimmed = query.trim();

  // Check for safe characters only
  if (!SAFE_QUERY_PATTERN.test(trimmed)) {
    // Find the problematic character for debugging
    const unsafeMatch = trimmed.match(
      /[^\w\s.,!?'"():;\-–—@#$%&*+=[\]{}|\\/<>~`^\n]/u,
    );
    return {
      valid: false,
      error: `Query contains unsafe characters: "${unsafeMatch?.[0]}"`,
    };
  }

  // Normalize whitespace
  const sanitized = trimmed.replace(/\s+/g, ' ');

  return { valid: true, sanitized };
}

// ============================================================================
// Evidence Capture
// ============================================================================

interface EvidenceEntry {
  timestamp: string;
  tool: string;
  query: string;
  success: boolean;
  outputLength?: number;
  citationCount?: number;
  /** Error message if success=false (captures final error after retries) */
  error?: string;
}

/**
 * Log evidence of a research query for audit trail
 */
async function logEvidence(
  sessionDir: string,
  entry: EvidenceEntry,
): Promise<void> {
  try {
    const evidenceDir = join(sessionDir, 'evidence');
    await mkdir(evidenceDir, { recursive: true });

    const evidencePath = join(evidenceDir, 'research-shell.jsonl');
    const line = `${JSON.stringify(entry)}\n`;

    await appendFile(evidencePath, line);
  } catch (error) {
    // Don't fail the main operation if evidence logging fails
    console.error('Failed to log evidence:', error);
  }
}

// ============================================================================
// API Execution
// ============================================================================

interface SearchResult {
  success: boolean;
  content?: string;
  citations?: string[];
  error?: string;
}

/**
 * Execute a search using direct API client calls
 *
 * SECURITY: Input validation ensures safe query strings before API calls.
 * No shell interpretation - direct HTTP API calls only.
 */
async function executeSearch(
  tool: 'perplexity' | 'gemini' | 'grok',
  query: string,
  sessionDir: string,
): Promise<SearchResult> {
  // Validate query
  const validation = validateQuery(query);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Safe to access since we checked validation.valid above
  const sanitizedQuery = validation.sanitized as string;

  // Load API configuration
  const config = loadConfig();

  try {
    let result: SearchResult;

    // Call appropriate API client with retry logic
    // Wraps each call with exponential backoff to handle transient failures
    switch (tool) {
      case 'perplexity':
        result = await withRetry(
          () => perplexitySearch(sanitizedQuery, config.perplexity),
          'perplexity_search',
          RETRY_CONFIG,
        );
        break;
      case 'gemini':
        result = await withRetry(
          () => geminiSearch(sanitizedQuery, config.gemini),
          'gemini_search',
          RETRY_CONFIG,
        );
        break;
      case 'grok':
        result = await withRetry(
          () => grokSearch(sanitizedQuery, config.grok),
          'grok_search',
          RETRY_CONFIG,
        );
        break;
      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }

    // Log evidence of search result (after all retries)
    await logEvidence(sessionDir, {
      timestamp: new Date().toISOString(),
      tool,
      query: sanitizedQuery,
      success: result.success,
      outputLength: result.content?.length,
      citationCount: result.citations?.length,
      error: result.error,
    });

    // Return failure if search ultimately failed
    if (!result.success) {
      return result;
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
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Log evidence of failure
    await logEvidence(sessionDir, {
      timestamp: new Date().toISOString(),
      tool,
      query: sanitizedQuery,
      success: false,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  { name: 'research-shell', version: '1.0.0' },
  {
    capabilities: { tools: { listChanged: false } },
    instructions: `Research Shell provides web search tools with automatic citations.

Available tools:
- perplexity_search: Deep research using Perplexity's Sonar Pro model. Best for comprehensive answers with inline citations.
- gemini_search: Multimodal research via Gemini with Google Search grounding. Best for: current events, Google-indexed content, image analysis, YouTube video understanding, visual content research.
- grok_search: X/Twitter-aware research via Grok. Best for real-time social media and trending topics.

Use these tools when you need:
- Verified information with citations
- Current/recent information beyond training cutoff
- Multiple perspectives on a topic
- Academic or technical research`,
  },
);

/**
 * All available tools with their definitions
 */
const ALL_TOOLS = [
  {
    name: 'perplexity_search',
    description:
      'Deep web research using Perplexity Sonar Pro. Returns comprehensive answers with inline citations. Best for: technical topics, academic research, detailed explanations, multi-source synthesis.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
  {
    name: 'gemini_search',
    description:
      'Multimodal research via Gemini with Google Search grounding. Supports text, images, and YouTube videos. Best for: current events, visual content analysis, video understanding, Google-indexed content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
  {
    name: 'grok_search',
    description:
      'Real-time research via Grok with X/Twitter awareness. Best for: trending topics, social media sentiment, breaking news, real-time discussions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
];

// Register tool listing handler - filters tools based on AGENT_TYPE
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // If AGENT_TYPE is set, only return tools allowed for that agent
  // This prevents the model from seeing (and hallucinating) other tools
  if (AGENT_TYPE && AGENT_ALLOWED_TOOLS[AGENT_TYPE]) {
    const allowedToolNames = AGENT_ALLOWED_TOOLS[AGENT_TYPE];
    const filteredTools = ALL_TOOLS.filter((tool) =>
      allowedToolNames.includes(tool.name),
    );

    console.error(
      `[research-shell] Agent type "${AGENT_TYPE}" - exposing tools: ${allowedToolNames.join(', ')}`,
    );

    return { tools: filteredTools };
  }

  // No AGENT_TYPE set - return all tools (development/local mode)
  console.error(
    '[research-shell] No AGENT_TYPE set - exposing all tools (development mode)',
  );
  return { tools: ALL_TOOLS };
});

// Register tool call handler
server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const { query, session_dir } = args as {
      query: string;
      session_dir: string;
    };

    // H7: Server-side agent type validation
    // If AGENT_TYPE is set (from container), only allow matching tools
    if (AGENT_TYPE && AGENT_ALLOWED_TOOLS[AGENT_TYPE]) {
      const allowedTools = AGENT_ALLOWED_TOOLS[AGENT_TYPE];
      if (!allowedTools.includes(name)) {
        console.error(
          `SECURITY: Agent type "${AGENT_TYPE}" attempted to use disallowed tool "${name}". Allowed: ${allowedTools.join(', ')}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Security Error: Tool "${name}" is not allowed for agent type "${AGENT_TYPE}"`,
            },
          ],
          isError: true,
        };
      }
    }

    if (!query || !session_dir) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Both query and session_dir are required',
          },
        ],
        isError: true,
      };
    }

    let result: SearchResult;

    switch (name) {
      case 'perplexity_search':
        result = await executeSearch('perplexity', query, session_dir);
        break;
      case 'gemini_search':
        result = await executeSearch('gemini', query, session_dir);
        break;
      case 'grok_search':
        result = await executeSearch('grok', query, session_dir);
        break;
      default:
        return {
          content: [
            {
              type: 'text',
              text: `Error: Unknown tool "${name}"`,
            },
          ],
          isError: true,
        };
    }

    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: result.content || 'No results returned',
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout, which is used for MCP protocol)
  console.error('Research Shell MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start Research Shell MCP Server:', error);
  process.exit(1);
});
