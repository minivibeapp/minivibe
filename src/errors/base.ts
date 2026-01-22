/**
 * Base error class with typed data
 * Pattern inspired by OpenCode's NamedError system
 */

import { z } from 'zod';

/**
 * Base class for all Vibe errors
 * Provides structured error data with Zod schema validation
 */
export abstract class VibeError extends Error {
  /** Error code for programmatic handling */
  abstract readonly code: string;

  /** Whether this error is retryable */
  abstract readonly retryable: boolean;

  /** Convert error to a serializable object */
  abstract toObject(): { code: string; data: unknown; retryable: boolean };

  /**
   * Factory function to create typed error classes
   *
   * @example
   * const AuthError = VibeError.create('AUTH_ERROR', z.object({
   *   message: z.string(),
   *   provider: z.string().optional(),
   * }), true); // retryable
   *
   * throw new AuthError({ message: 'Token expired', provider: 'firebase' });
   */
  static create<Code extends string, Data extends z.ZodType>(
    code: Code,
    dataSchema: Data,
    retryable = false
  ) {
    return class extends VibeError {
      static readonly code = code;
      static readonly Schema = z.object({
        code: z.literal(code),
        data: dataSchema,
        retryable: z.boolean(),
      });

      readonly code = code;
      readonly retryable = retryable;
      readonly originalCause?: Error;

      constructor(
        public readonly data: z.infer<Data>,
        cause?: Error
      ) {
        // Use the error message from data if available, otherwise use the code
        const message =
          typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message: unknown }).message)
            : code;
        super(message);
        this.name = code;
        this.originalCause = cause;

        // Capture stack trace
        if (Error.captureStackTrace) {
          Error.captureStackTrace(this, this.constructor);
        }
      }

      /**
       * Type guard to check if an error is this type
       */
      static isInstance(input: unknown): input is InstanceType<typeof this> {
        return input instanceof Error && 'code' in input && input.code === code;
      }

      /**
       * Convert to serializable object
       */
      toObject() {
        return {
          code: this.code,
          data: this.data,
          retryable: this.retryable,
        };
      }

      /**
       * Convert to JSON string
       */
      toJSON(): string {
        return JSON.stringify(this.toObject());
      }
    };
  }
}

/**
 * Wrap any error into a VibeError if it isn't already
 */
export function wrapError(err: unknown, fallbackCode = 'UNKNOWN_ERROR'): VibeError {
  if (err instanceof VibeError) {
    return err;
  }

  const UnknownError = VibeError.create(
    fallbackCode,
    z.object({
      message: z.string(),
      originalError: z.unknown().optional(),
    }),
    false
  );

  const message = err instanceof Error ? err.message : String(err);
  return new UnknownError(
    { message, originalError: err },
    err instanceof Error ? err : undefined
  );
}

/**
 * Format an error for display
 */
export function formatError(err: unknown): string {
  if (err instanceof VibeError) {
    const obj = err.toObject();
    const data = obj.data as Record<string, unknown>;
    const details = data.message || JSON.stringify(data);
    return `[${obj.code}] ${details}${obj.retryable ? ' (retryable)' : ''}`;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}
