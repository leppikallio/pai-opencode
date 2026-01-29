/**
 * Result of a research query from any provider
 */
export interface SearchResult {
  success: boolean;
  content?: string;
  citations?: string[];
  /** Raw provider response payload (best-effort, no secrets). */
  raw?: unknown;
  error?: string;
}

/**
 * Perplexity API request message
 */
export interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Perplexity API request body
 */
export interface PerplexityRequest {
  model: string;
  messages: PerplexityMessage[];
  max_tokens?: number;
  temperature?: number;
  return_citations?: boolean;
}

/**
 * Perplexity API response choice
 */
export interface PerplexityChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
  index: number;
}

/**
 * Perplexity API usage statistics
 */
export interface PerplexityUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Perplexity API response
 */
export interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  choices: PerplexityChoice[];
  usage: PerplexityUsage;
  citations?: string[];
  error?: {
    message: string;
    type: string;
    code?: string;
  };
}
