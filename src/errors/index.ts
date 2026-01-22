/**
 * Domain-specific error classes for Vibe CLI
 */

import { z } from 'zod';
import { VibeError, wrapError, formatError } from './base';

// Re-export base utilities
export { VibeError, wrapError, formatError };

// ============================================
// Authentication Errors
// ============================================

/**
 * Authentication error (login, token refresh, etc.)
 */
export const AuthError = VibeError.create(
  'AUTH_ERROR',
  z.object({
    message: z.string(),
    provider: z.string().optional(),
    reason: z.enum(['expired', 'invalid', 'revoked', 'network', 'unknown']).optional(),
  }),
  true // retryable
);
export type AuthError = InstanceType<typeof AuthError>;

// ============================================
// Bridge Connection Errors
// ============================================

/**
 * Bridge WebSocket connection error
 */
export const BridgeConnectionError = VibeError.create(
  'BRIDGE_CONNECTION_ERROR',
  z.object({
    message: z.string(),
    url: z.string(),
    code: z.string().optional(),
    attempt: z.number().optional(),
  }),
  true // retryable
);
export type BridgeConnectionError = InstanceType<typeof BridgeConnectionError>;

/**
 * Bridge message error (parse error, unexpected message, etc.)
 */
export const BridgeMessageError = VibeError.create(
  'BRIDGE_MESSAGE_ERROR',
  z.object({
    message: z.string(),
    rawMessage: z.string().optional(),
    expectedType: z.string().optional(),
  }),
  false // not retryable
);
export type BridgeMessageError = InstanceType<typeof BridgeMessageError>;

// ============================================
// Claude Process Errors
// ============================================

/**
 * Claude process error (spawn, crash, etc.)
 */
export const ClaudeProcessError = VibeError.create(
  'CLAUDE_PROCESS_ERROR',
  z.object({
    message: z.string(),
    exitCode: z.number().nullable().optional(),
    signal: z.string().nullable().optional(),
    command: z.string().optional(),
  }),
  false // not retryable
);
export type ClaudeProcessError = InstanceType<typeof ClaudeProcessError>;

/**
 * Claude not found error
 */
export const ClaudeNotFoundError = VibeError.create(
  'CLAUDE_NOT_FOUND',
  z.object({
    message: z.string(),
    searchedPaths: z.array(z.string()).optional(),
  }),
  false // not retryable
);
export type ClaudeNotFoundError = InstanceType<typeof ClaudeNotFoundError>;

// ============================================
// Session Errors
// ============================================

/**
 * Session file error (read, write, watch, etc.)
 */
export const SessionFileError = VibeError.create(
  'SESSION_FILE_ERROR',
  z.object({
    message: z.string(),
    path: z.string().optional(),
    operation: z.enum(['read', 'write', 'watch', 'parse']).optional(),
  }),
  true // retryable for transient issues
);
export type SessionFileError = InstanceType<typeof SessionFileError>;

/**
 * Session not found error
 */
export const SessionNotFoundError = VibeError.create(
  'SESSION_NOT_FOUND',
  z.object({
    message: z.string(),
    sessionId: z.string(),
  }),
  false // not retryable
);
export type SessionNotFoundError = InstanceType<typeof SessionNotFoundError>;

// ============================================
// Validation Errors
// ============================================

/**
 * Schema validation error
 */
export const ValidationError = VibeError.create(
  'VALIDATION_ERROR',
  z.object({
    message: z.string(),
    path: z.string().optional(),
    issues: z
      .array(
        z.object({
          path: z.array(z.string()),
          message: z.string(),
        })
      )
      .optional(),
  }),
  false // not retryable
);
export type ValidationError = InstanceType<typeof ValidationError>;

// ============================================
// E2E Encryption Errors
// ============================================

/**
 * E2E encryption error
 */
export const E2EError = VibeError.create(
  'E2E_ERROR',
  z.object({
    message: z.string(),
    phase: z.enum(['init', 'key_exchange', 'encrypt', 'decrypt']),
  }),
  true // retryable for key exchange
);
export type E2EError = InstanceType<typeof E2EError>;

// ============================================
// Configuration Errors
// ============================================

/**
 * Configuration error
 */
export const ConfigError = VibeError.create(
  'CONFIG_ERROR',
  z.object({
    message: z.string(),
    path: z.string().optional(),
    key: z.string().optional(),
  }),
  false // not retryable
);
export type ConfigError = InstanceType<typeof ConfigError>;

// ============================================
// Network Errors
// ============================================

/**
 * General network error
 */
export const NetworkError = VibeError.create(
  'NETWORK_ERROR',
  z.object({
    message: z.string(),
    url: z.string().optional(),
    statusCode: z.number().optional(),
  }),
  true // retryable
);
export type NetworkError = InstanceType<typeof NetworkError>;

// ============================================
// Permission Errors
// ============================================

/**
 * Permission denied error
 */
export const PermissionDeniedError = VibeError.create(
  'PERMISSION_DENIED',
  z.object({
    message: z.string(),
    tool: z.string().optional(),
    requestId: z.string().optional(),
  }),
  false // not retryable
);
export type PermissionDeniedError = InstanceType<typeof PermissionDeniedError>;

/**
 * Permission timeout error
 */
export const PermissionTimeoutError = VibeError.create(
  'PERMISSION_TIMEOUT',
  z.object({
    message: z.string(),
    tool: z.string().optional(),
    requestId: z.string().optional(),
    timeoutMs: z.number().optional(),
  }),
  true // retryable
);
export type PermissionTimeoutError = InstanceType<typeof PermissionTimeoutError>;

// ============================================
// Error Type Guards
// ============================================

/**
 * Check if error is retryable
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof VibeError) {
    return err.retryable;
  }
  return false;
}

/**
 * Check if error is a specific type
 */
export function isErrorType<T extends typeof VibeError>(
  err: unknown,
  ErrorClass: { isInstance(input: unknown): input is InstanceType<T> }
): err is InstanceType<T> {
  return ErrorClass.isInstance(err);
}
