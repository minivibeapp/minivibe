/**
 * Retry utilities with exponential backoff
 * Pattern inspired by OpenCode's retry system
 */

export namespace Retry {
  /** Initial delay in milliseconds */
  export const INITIAL_DELAY = 2000;

  /** Backoff multiplier */
  export const BACKOFF_FACTOR = 2;

  /** Maximum delay cap in milliseconds */
  export const MAX_DELAY = 30_000;

  /** Maximum safe timeout value (32-bit signed int max) */
  export const MAX_TIMEOUT_DELAY = 2_147_483_647;

  /**
   * Calculate delay for a given attempt number using exponential backoff
   * @param attempt - The attempt number (1-based, values <= 0 treated as 1)
   * @param headers - Optional HTTP headers that may contain retry-after directives
   * @returns Delay in milliseconds
   */
  export function delay(attempt: number, headers?: Record<string, string>): number {
    // Clamp attempt to valid range (minimum 1)
    const safeAttempt = Math.max(1, Math.floor(attempt));

    // Check for retry-after-ms header (highest priority)
    if (headers?.['retry-after-ms']) {
      const ms = Number.parseFloat(headers['retry-after-ms']);
      if (!Number.isNaN(ms) && ms > 0) {
        return Math.min(ms, MAX_DELAY);
      }
    }

    // Check for retry-after header (seconds or HTTP date)
    if (headers?.['retry-after']) {
      const seconds = Number.parseFloat(headers['retry-after']);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(Math.ceil(seconds * 1000), MAX_DELAY);
      }
      // Try HTTP date format
      const parsed = Date.parse(headers['retry-after']) - Date.now();
      if (!Number.isNaN(parsed) && parsed > 0) {
        return Math.min(Math.ceil(parsed), MAX_DELAY);
      }
    }

    // Exponential backoff with cap: 2s, 4s, 8s, 16s, 30s, 30s, ...
    // Cap the exponent to prevent overflow (2^20 = 1048576, which is safe)
    const safeExponent = Math.min(safeAttempt - 1, 20);
    const exponentialDelay = INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, safeExponent);
    return Math.min(exponentialDelay, MAX_DELAY);
  }

  /**
   * Add jitter to a delay to prevent thundering herd
   * @param baseDelay - The base delay in milliseconds
   * @param jitterFactor - Factor of randomness (0-1, default 0.1 = 10%)
   * @returns Delay with jitter applied
   */
  export function withJitter(baseDelay: number, jitterFactor = 0.1): number {
    const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(baseDelay + jitter));
  }

  /**
   * Sleep for a specified duration with optional abort signal
   * @param ms - Duration in milliseconds
   * @param signal - Optional AbortSignal to cancel the sleep
   */
  export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const safeDuration = Math.min(ms, MAX_TIMEOUT_DELAY);
      const timeout = setTimeout(resolve, safeDuration);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
  }

  /**
   * Format delay for display (e.g., "2.0s", "30.0s")
   * @param ms - Delay in milliseconds
   * @returns Formatted string
   */
  export function formatDelay(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
  }
}
