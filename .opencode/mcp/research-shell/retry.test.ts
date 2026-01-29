/**
 * Tests for retry logic with exponential backoff
 */
import { describe, expect, it } from 'vitest';
import {
  calculateDelay,
  isRetryableError,
  type RetryConfig,
  withRetry,
} from './retry';
import type { SearchResult } from './types';

describe('retry utilities', () => {
  describe('isRetryableError', () => {
    it('should identify timeout errors as retryable', () => {
      expect(isRetryableError('Connection timeout')).toBe(true);
      expect(isRetryableError('Request timed out')).toBe(true);
      expect(isRetryableError('ETIMEDOUT')).toBe(true);
    });

    it('should identify network errors as retryable', () => {
      expect(isRetryableError('ECONNRESET')).toBe(true);
      expect(isRetryableError('ECONNREFUSED')).toBe(true);
      expect(isRetryableError('socket hang up')).toBe(true);
      expect(isRetryableError('network error')).toBe(true);
    });

    it('should identify HTTP 5xx errors as retryable', () => {
      expect(isRetryableError('API error (500): Internal server error')).toBe(
        true,
      );
      expect(isRetryableError('API error (502): Bad gateway')).toBe(true);
      expect(isRetryableError('API error (503): Service unavailable')).toBe(
        true,
      );
      expect(isRetryableError('API error (504): Gateway timeout')).toBe(true);
    });

    it('should identify rate limiting as retryable', () => {
      expect(isRetryableError('API error (429): Too many requests')).toBe(true);
      expect(isRetryableError('Rate limit exceeded')).toBe(true);
    });

    it('should NOT identify client errors as retryable', () => {
      expect(isRetryableError('API error (401): Unauthorized')).toBe(false);
      expect(isRetryableError('API error (403): Forbidden')).toBe(false);
      expect(isRetryableError('API error (404): Not found')).toBe(false);
      expect(isRetryableError('Query cannot be empty')).toBe(false);
    });

    it('should handle SearchResult objects', () => {
      expect(isRetryableError({ success: false, error: 'timeout' })).toBe(true);
      expect(
        isRetryableError({ success: false, error: 'Query too long' }),
      ).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    const baseConfig: RetryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: false,
      debug: false,
    };

    it('should calculate exponential backoff', () => {
      expect(calculateDelay(0, baseConfig)).toBe(1000); // 1000 * 2^0
      expect(calculateDelay(1, baseConfig)).toBe(2000); // 1000 * 2^1
      expect(calculateDelay(2, baseConfig)).toBe(4000); // 1000 * 2^2
      expect(calculateDelay(3, baseConfig)).toBe(8000); // 1000 * 2^3
    });

    it('should respect maxDelayMs', () => {
      const config = { ...baseConfig, maxDelayMs: 5000 };
      expect(calculateDelay(0, config)).toBe(1000);
      expect(calculateDelay(1, config)).toBe(2000);
      expect(calculateDelay(2, config)).toBe(4000);
      expect(calculateDelay(3, config)).toBe(5000); // Capped at maxDelayMs
      expect(calculateDelay(10, config)).toBe(5000); // Still capped
    });

    it('should add jitter when enabled', () => {
      const config = { ...baseConfig, jitter: true };
      const delays = new Set<number>();

      // Run multiple times to verify randomness
      for (let i = 0; i < 20; i++) {
        delays.add(calculateDelay(0, config));
      }

      // With jitter, we should get varying delays around 1000ms (±25%)
      // At least some variation should exist
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry', () => {
    it('should return immediately on success', async () => {
      let callCount = 0;
      const successFn = async (): Promise<SearchResult> => {
        callCount++;
        return { success: true, content: 'Success!', citations: [] };
      };

      const result = await withRetry(successFn, 'test');

      expect(callCount).toBe(1);
      expect(result.success).toBe(true);
      expect(result.content).toBe('Success!');
    });

    it('should retry on retryable errors', async () => {
      let callCount = 0;
      const failThenSuccessFn = async (): Promise<SearchResult> => {
        callCount++;
        if (callCount < 3) {
          return { success: false, error: 'API error (429): Rate limited' };
        }
        return { success: true, content: 'Success after retries!' };
      };

      // Use very short delays for testing
      const config = {
        maxRetries: 3,
        initialDelayMs: 10, // 10ms instead of 1s for fast tests
        jitter: false,
        debug: false,
      };

      const result = await withRetry(failThenSuccessFn, 'test', config);

      expect(callCount).toBe(3);
      expect(result.success).toBe(true);
      expect(result.content).toBe('Success after retries!');
    });

    it('should NOT retry on non-retryable errors', async () => {
      let callCount = 0;
      const nonRetryableFn = async (): Promise<SearchResult> => {
        callCount++;
        return { success: false, error: 'Query cannot be empty' };
      };

      const config = { maxRetries: 3, initialDelayMs: 10, jitter: false };

      const result = await withRetry(nonRetryableFn, 'test', config);

      expect(callCount).toBe(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Query cannot be empty');
    });

    it('should give up after maxRetries', async () => {
      let callCount = 0;
      const alwaysFailFn = async (): Promise<SearchResult> => {
        callCount++;
        return {
          success: false,
          error: 'API error (503): Service unavailable',
        };
      };

      const config = {
        maxRetries: 2,
        initialDelayMs: 10, // 10ms for fast tests
        jitter: false,
        debug: false,
      };

      const result = await withRetry(alwaysFailFn, 'test', config);

      expect(callCount).toBe(3); // Initial + 2 retries
      expect(result.success).toBe(false);
      expect(result.error).toContain('after 3 attempts');
    });
  });
});
