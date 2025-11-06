/**
 * useApiRetry
 *
 * Hook for making API requests with retry logic and endpoint candidates.
 * Provides request cancellation, timeout handling, and automatic retries
 * across multiple endpoint URLs.
 *
 * Responsibilities:
 * - Retry logic with multiple endpoint candidates
 * - AbortController for request cancellation
 * - Timeout handling
 * - Error aggregation
 * - Cleanup on unmount
 *
 * @phase Phase 3.5 - Custom Hooks Creation
 */

import { useCallback, useRef, useEffect } from "react";
import { makeApiEndpointCandidates } from "../../../utils/backend";

type FetchOptions = RequestInit & {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
};

type RetryOptions = {
  /** Number of retries per endpoint (default: 1, meaning no retries) */
  retries?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
};

type FetchWithRetryOptions = FetchOptions & RetryOptions;

type UseApiRetryOptions = {
  /** Base backend URL */
  backendUrl: string;
  /** Default auth header */
  authHeader?: Record<string, string>;
};

type UseApiRetryReturn = {
  /**
   * Fetch with retry logic across endpoint candidates
   * @param endpoint - API endpoint path (e.g., "/workflows")
   * @param options - Fetch options including retry config
   */
  fetchWithRetry: <T = any>(endpoint: string, options?: FetchWithRetryOptions) => Promise<T>;

  /**
   * Abort all pending requests
   */
  abort: () => void;

  /**
   * Check if there are pending requests
   */
  hasPendingRequests: () => boolean;
};

/**
 * Hook for API requests with retry logic
 *
 * @example
 * ```typescript
 * const { fetchWithRetry, abort } = useApiRetry({
 *   backendUrl: 'http://localhost:8000',
 *   authHeader: { Authorization: `Bearer ${token}` }
 * });
 *
 * // Fetch with automatic retry
 * const data = await fetchWithRetry('/workflows', {
 *   method: 'GET',
 *   timeout: 5000,
 *   retries: 3
 * });
 *
 * // Cancel all pending requests
 * abort();
 * ```
 */
export function useApiRetry(options: UseApiRetryOptions): UseApiRetryReturn {
  const { backendUrl, authHeader = {} } = options;

  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort all pending requests when component unmounts
      abortControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      abortControllersRef.current.clear();
    };
  }, []);

  // Abort all pending requests
  const abort = useCallback(() => {
    abortControllersRef.current.forEach((controller) => {
      controller.abort();
    });
    abortControllersRef.current.clear();
  }, []);

  // Check if there are pending requests
  const hasPendingRequests = useCallback(() => {
    return abortControllersRef.current.size > 0;
  }, []);

  // Fetch with retry logic
  const fetchWithRetry = useCallback(
    async <T = any>(endpoint: string, fetchOptions: FetchWithRetryOptions = {}): Promise<T> => {
      const {
        timeout = 30000,
        retries = 1,
        retryDelay = 1000,
        headers = {},
        ...restOptions
      } = fetchOptions;

      // Get endpoint candidates
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      const errors: Array<{ url: string; error: string }> = [];

      // Try each candidate URL
      for (const url of candidates) {
        let lastError: Error | null = null;

        // Retry logic for each URL
        for (let attempt = 0; attempt < retries; attempt++) {
          // Create abort controller for this request
          const abortController = new AbortController();
          abortControllersRef.current.add(abortController);

          // Create timeout
          const timeoutId = setTimeout(() => {
            abortController.abort();
          }, timeout);

          try {
            const response = await fetch(url, {
              ...restOptions,
              headers: {
                ...authHeader,
                ...headers,
              },
              signal: abortController.signal,
            });

            // Clear timeout and remove controller
            clearTimeout(timeoutId);
            abortControllersRef.current.delete(abortController);

            // Check response status
            if (!response.ok) {
              lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

              // Don't retry on 4xx errors (client errors)
              if (response.status >= 400 && response.status < 500) {
                throw lastError;
              }

              // Retry on 5xx errors (server errors)
              if (attempt < retries - 1) {
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
                continue;
              }

              throw lastError;
            }

            // Parse response
            const contentType = response.headers.get("content-type");
            const data =
              contentType && contentType.includes("application/json")
                ? await response.json()
                : await response.text();

            return data as T;
          } catch (error) {
            // Clear timeout and remove controller
            clearTimeout(timeoutId);
            abortControllersRef.current.delete(abortController);

            if (error instanceof Error) {
              if (error.name === "AbortError") {
                lastError = new Error("Request timeout");
              } else {
                lastError = error;
              }
            } else {
              lastError = new Error("Unknown error");
            }

            // Retry if not the last attempt
            if (attempt < retries - 1) {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
              continue;
            }
          }
        }

        // Record error for this URL
        if (lastError) {
          errors.push({
            url,
            error: lastError.message,
          });
        }
      }

      // All attempts failed
      const errorMessage = errors.length > 0
        ? `Failed to fetch ${endpoint}. Errors: ${errors.map((e) => `${e.url}: ${e.error}`).join(", ")}`
        : `Failed to fetch ${endpoint}`;

      throw new Error(errorMessage);
    },
    [backendUrl, authHeader],
  );

  return {
    fetchWithRetry,
    abort,
    hasPendingRequests,
  };
}
