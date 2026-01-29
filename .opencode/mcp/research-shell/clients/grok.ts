/**
 * Grok API Client
 *
 * Direct API client for xAI's Grok model with web search capabilities.
 * The Grok API is OpenAI-compatible with additional search parameters.
 *
 * FEATURES:
 * - Web search with automatic citation extraction
 * - OpenAI-compatible chat completions endpoint
 * - Configurable model, temperature, and token limits
 * - Built-in error handling and timeout management
 *
 * SECURITY:
 * - API key validation from environment
 * - HTTPS-only communication
 * - Input validation for all parameters
 */

// ============================================================================
// Configuration & Types
// ============================================================================

export interface GrokConfig {
  /** Model to use (default: 'grok-3-latest') */
  model: string;
  /** Maximum tokens in response (default: 4096) */
  maxTokens: number;
  /** Temperature for response randomness 0.0-1.0 (default: 0.7) */
  temperature: number;
  /** Enable web search capabilities (default: true) */
  searchEnabled: boolean;
  /** Return citations with search results (default: true) */
  returnCitations: boolean;
  /** Custom system prompt (optional) */
  systemPrompt?: string;
}

export interface SearchResult {
  /** Whether the search was successful */
  success: boolean;
  /** The response content */
  content?: string;
  /** Array of citation URLs (if returnCitations=true) */
  citations?: string[];
  /** Error message if success=false */
  error?: string;
}

interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GrokSearchParameters {
  mode: 'auto';
  return_citations: boolean;
}

interface GrokRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  messages: GrokMessage[];
  search_parameters?: GrokSearchParameters;
}

interface GrokChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface GrokResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GrokChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Citations are returned as plain URL strings, not objects */
  citations?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** xAI Grok API endpoint */
const GROK_API_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

/** Default configuration */
const DEFAULT_CONFIG: GrokConfig = {
  model: 'grok-3-latest',
  maxTokens: 4096,
  temperature: 0.7,
  searchEnabled: true,
  returnCitations: true,
};

// ============================================================================
// API Client
// ============================================================================

/**
 * Get Grok API key from environment
 *
 * Checks GROK_API_KEY and GROKAI_API_KEY environment variables.
 */
function getApiKey(): string {
  const apiKey = process.env.GROK_API_KEY || process.env.GROKAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Grok API key not found. Set GROK_API_KEY or GROKAI_API_KEY environment variable.',
    );
  }

  return apiKey;
}

/**
 * Validate configuration parameters
 */
function validateConfig(config: Partial<GrokConfig>): GrokConfig {
  const validated: GrokConfig = { ...DEFAULT_CONFIG, ...config };

  // Validate model
  if (!validated.model || validated.model.trim().length === 0) {
    throw new Error('Model name cannot be empty');
  }

  // Validate maxTokens
  if (validated.maxTokens < 1 || validated.maxTokens > 32768) {
    throw new Error('maxTokens must be between 1 and 32768');
  }

  // Validate temperature
  if (validated.temperature < 0 || validated.temperature > 2) {
    throw new Error('temperature must be between 0 and 2');
  }

  return validated;
}

/**
 * Extract citations from Grok API response
 *
 * The Grok API returns citations as plain URL strings at the top level.
 */
function extractCitations(response: GrokResponse): string[] {
  // Citations are returned as plain strings, not objects
  if (response.citations && Array.isArray(response.citations)) {
    return response.citations.filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    );
  }

  return [];
}

/**
 * Execute a search query using the Grok API
 *
 * @param query - The search query to execute
 * @param config - Optional configuration overrides
 * @returns SearchResult with content and citations
 */
export async function grokSearch(
  query: string,
  config: Partial<GrokConfig> = {},
): Promise<SearchResult> {
  try {
    // Validate input
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Query cannot be empty',
      };
    }

    if (query.length > 4000) {
      return {
        success: false,
        error: `Query too long: ${query.length} > 4000 characters`,
      };
    }

    // Get API key
    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'API key error',
      };
    }

    // Validate and merge config
    const validatedConfig = validateConfig(config);

    // Build request body
    const messages: GrokMessage[] = [];

    // Add system prompt if provided
    if (validatedConfig.systemPrompt) {
      messages.push({
        role: 'system',
        content: validatedConfig.systemPrompt,
      });
    }

    // Add user query
    messages.push({
      role: 'user',
      content: query.trim(),
    });

    // Build request body
    const requestBody: GrokRequestBody = {
      model: validatedConfig.model,
      max_tokens: validatedConfig.maxTokens,
      temperature: validatedConfig.temperature,
      messages,
    };

    // Add search parameters if enabled
    if (validatedConfig.searchEnabled) {
      requestBody.search_parameters = {
        mode: 'auto',
        return_citations: validatedConfig.returnCitations,
      };
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      // Make API request
      const response = await fetch(GROK_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API error (${response.status}): ${response.statusText}`;

        // Try to parse error response
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // Use default error message
        }

        return {
          success: false,
          error: errorMessage,
        };
      }

      // Parse response
      const data = (await response.json()) as GrokResponse;

      // Extract content
      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: 'No response choices returned from API',
        };
      }

      const content = data.choices[0].message.content;

      if (!content) {
        return {
          success: false,
          error: 'Empty response content from API',
        };
      }

      // Extract citations if enabled
      const citations = validatedConfig.returnCitations
        ? extractCitations(data)
        : undefined;

      return {
        success: true,
        content,
        citations,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          };
        }

        return {
          success: false,
          error: `Request failed: ${error.message}`,
        };
      }

      return {
        success: false,
        error: 'Unknown request error',
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Create a configured Grok search function with default settings
 *
 * @param defaultConfig - Default configuration to use
 * @returns A search function with the default config
 */
export function createGrokSearcher(
  defaultConfig: Partial<GrokConfig> = {},
): (query: string, config?: Partial<GrokConfig>) => Promise<SearchResult> {
  return (query: string, config?: Partial<GrokConfig>) => {
    const mergedConfig = { ...defaultConfig, ...config };
    return grokSearch(query, mergedConfig);
  };
}
