/**
 * Retry Logic with Exponential Backoff
 *
 * Provides resilient API call handling for research-shell clients.
 * Essential for handling transient failures from rate limiting,
 * network issues, or temporary API unavailability.
 *
 * Features:
 * - Exponential backoff with jitter to prevent thundering herd
 * - Configurable retry count and delays
 * - Distinguishes between retryable and non-retryable errors
 * - Logs retry attempts for debugging
 */

import type { SearchResult } from './types.ts';

// ============================================================================
// Configuration
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Enable debug logging (default: false) */
  debug: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  debug: false,
};

// ============================================================================
// Error Classification
// ============================================================================

/**
 * HTTP status codes that should trigger a retry
 *
 * 408 - Request Timeout
 * 429 - Too Many Requests (rate limited)
 * 500 - Internal Server Error
 * 502 - Bad Gateway
 * 503 - Service Unavailable
 * 504 - Gateway Timeout
 */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Error message patterns that indicate retryable conditions
 */
const RETRYABLE_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /connection refused/i,
  /connection reset/i,
  /network/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /rate limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /internal server error/i,
  /bad gateway/i,
  /gateway timeout/i,
];

/**
 * Determine if an error should trigger a retry
 *
 * @param error - The error message or SearchResult
 * @returns true if the error is retryable
 */
export function isRetryableError(error: string | SearchResult): boolean {
  const errorMessage = typeof error === 'string' ? error : error.error || '';

  // Check for retryable patterns
  for (const pattern of RETRYABLE_ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return true;
    }
  }

  // Check for HTTP status codes in error message
  for (const statusCode of RETRYABLE_STATUS_CODES) {
    if (errorMessage.includes(`(${statusCode})`)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Delay Calculation
// ============================================================================

/**
 * Calculate delay with exponential backoff and optional jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay = config.initialDelayMs * config.backoffMultiplier ** attempt;

  // Cap at maximum delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter (±25% of delay)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    delay = Math.max(0, delay + jitter);
  }

  return Math.round(delay);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Retry Wrapper
// ============================================================================

/**
 * Execute a search operation with retry logic
 *
 * @param operation - Async function that performs the search
 * @param operationName - Name for logging (e.g., 'gemini_search')
 * @param config - Optional retry configuration
 * @returns SearchResult from successful operation or final failure
 */
export async function withRetry(
  operation: () => Promise<SearchResult>,
  operationName: string,
  config: Partial<RetryConfig> = {},
): Promise<SearchResult> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastResult: SearchResult | null = null;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    // Execute the operation
    const result = await operation();

    // Success - return immediately
    if (result.success) {
      if (attempt > 0 && fullConfig.debug) {
        console.error(
          `[retry] ${operationName}: Succeeded on attempt ${attempt + 1}`,
        );
      }
      return result;
    }

    // Save result for potential final return
    lastResult = result;

    // Check if we should retry
    if (attempt === fullConfig.maxRetries) {
      // No more retries
      break;
    }

    // Check if error is retryable
    if (!isRetryableError(result)) {
      if (fullConfig.debug) {
        console.error(
          `[retry] ${operationName}: Non-retryable error: ${result.error}`,
        );
      }
      return result;
    }

    // Calculate delay
    const delay = calculateDelay(attempt, fullConfig);

    if (fullConfig.debug) {
      console.error(
        `[retry] ${operationName}: Attempt ${attempt + 1} failed: ${result.error}`,
      );
      console.error(
        `[retry] ${operationName}: Retrying in ${delay}ms (attempt ${attempt + 2}/${fullConfig.maxRetries + 1})`,
      );
    }

    // Wait before retry
    await sleep(delay);
  }

  // All retries exhausted - return last result with enhanced error message
  if (lastResult) {
    return {
      ...lastResult,
      error: `${lastResult.error} (after ${fullConfig.maxRetries + 1} attempts)`,
    };
  }

  // Should never reach here, but handle edge case
  return {
    success: false,
    error: `Operation failed after ${fullConfig.maxRetries + 1} attempts`,
  };
}

/**
 * Create a retrying wrapper for a search function
 *
 * @param searchFn - The search function to wrap
 * @param operationName - Name for logging
 * @param config - Optional retry configuration
 * @returns Wrapped function with retry logic
 */
export function createRetryingSearch<TConfig>(
  searchFn: (query: string, config: TConfig) => Promise<SearchResult>,
  operationName: string,
  retryConfig: Partial<RetryConfig> = {},
): (query: string, config: TConfig) => Promise<SearchResult> {
  return (query: string, config: TConfig) =>
    withRetry(() => searchFn(query, config), operationName, retryConfig);
}
