import type { PerplexityConfig } from '../config.ts';
import { loadApiKey } from '../config.ts';
import type {
  PerplexityRequest,
  PerplexityResponse,
  SearchResult,
} from '../types.ts';

/**
 * Perplexity AI API client for research queries
 */
export class PerplexityClient {
  private apiKey: string;
  private config: PerplexityConfig;
  private readonly endpoint = 'https://api.perplexity.ai/chat/completions';

  /**
   * Create a new Perplexity client
   * @param config Configuration for the client
   */
  constructor(config: PerplexityConfig) {
    this.config = config;
    this.apiKey = loadApiKey('PERPLEXITY_API_KEY');
  }

  /**
   * Perform a research query using Perplexity AI
   * @param query The research question to ask
   * @param options Optional overrides for configuration
   * @returns SearchResult with content and citations
   */
  async search(
    query: string,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
    },
  ): Promise<SearchResult> {
    try {
      // Build the request body
      const requestBody: PerplexityRequest = {
        model: options?.model || this.config.model,
        max_tokens: options?.maxTokens || this.config.maxTokens,
        temperature: options?.temperature || this.config.temperature,
        messages: [
          {
            role: 'system',
            content:
              options?.systemPrompt ||
              this.config.systemPrompt ||
              'You are a helpful research assistant. Provide comprehensive, well-sourced answers.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        // ALWAYS request citations from the API
        return_citations: true,
      };

      // Make the API request
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API request failed (${response.status}): ${errorText}`,
        };
      }

      // Parse the response
      const data = (await response.json()) as PerplexityResponse;

      // Check for API-level errors
      if (data.error) {
        return {
          success: false,
          error: data.error.message || 'Unknown API error',
        };
      }

      // Extract the content from the response
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return {
          success: false,
          error: 'No content in API response',
        };
      }

      // Return successful result with citations
      return {
        success: true,
        content,
        citations: data.citations || [],
      };
    } catch (error) {
      // Handle any unexpected errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get the current configuration
   * @returns The current PerplexityConfig
   */
  getConfig(): PerplexityConfig {
    return { ...this.config };
  }

  /**
   * Update the configuration
   * @param config Partial configuration to update
   */
  updateConfig(config: Partial<PerplexityConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a new Perplexity client with the given configuration
 * @param config Configuration for the client
 * @returns A new PerplexityClient instance
 */
export function createPerplexityClient(
  config: PerplexityConfig,
): PerplexityClient {
  return new PerplexityClient(config);
}

/**
 * Simple function interface for perplexity search
 * Used by the MCP server for consistent API across all providers
 */
export async function perplexitySearch(
  query: string,
  config: PerplexityConfig,
): Promise<SearchResult> {
  const client = new PerplexityClient(config);
  return client.search(query);
}
