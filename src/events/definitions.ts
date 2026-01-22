/**
 * Event definitions for Vibe CLI
 * Defines all events that can be published/subscribed to
 */

import { z } from 'zod';
import { EventBus } from './bus';

// ============================================
// Bridge Events
// ============================================

/** Bridge WebSocket connected */
export const BridgeConnected = EventBus.define(
  'bridge.connected',
  z.object({
    url: z.string(),
  })
);

/** Bridge WebSocket disconnected */
export const BridgeDisconnected = EventBus.define(
  'bridge.disconnected',
  z.object({
    reason: z.string(),
    wasClean: z.boolean().optional(),
  })
);

/** Bridge authentication successful */
export const BridgeAuthenticated = EventBus.define(
  'bridge.authenticated',
  z.object({
    email: z.string().optional(),
    userId: z.string().optional(),
  })
);

/** Bridge authentication failed */
export const BridgeAuthError = EventBus.define(
  'bridge.auth_error',
  z.object({
    message: z.string(),
  })
);

/** Bridge error occurred */
export const BridgeError = EventBus.define(
  'bridge.error',
  z.object({
    message: z.string(),
    code: z.string().optional(),
  })
);

/** Bridge reconnecting */
export const BridgeReconnecting = EventBus.define(
  'bridge.reconnecting',
  z.object({
    attempt: z.number(),
    delayMs: z.number(),
  })
);

// ============================================
// Session Events
// ============================================

/** Session registered with bridge */
export const SessionRegistered = EventBus.define(
  'session.registered',
  z.object({
    sessionId: z.string(),
  })
);

/** Session ended */
export const SessionEnded = EventBus.define(
  'session.ended',
  z.object({
    sessionId: z.string(),
    exitCode: z.number().nullable(),
    signal: z.string().nullable().optional(),
  })
);

/** Session renamed */
export const SessionRenamed = EventBus.define(
  'session.renamed',
  z.object({
    sessionId: z.string(),
    name: z.string(),
  })
);

/** Session file found */
export const SessionFileFound = EventBus.define(
  'session.file_found',
  z.object({
    sessionId: z.string(),
    path: z.string(),
  })
);

// ============================================
// Message Events
// ============================================

/** Message received (from any source) */
export const MessageReceived = EventBus.define(
  'message.received',
  z.object({
    source: z.enum(['mobile', 'local', 'bridge', 'session_file']),
    content: z.string(),
    sessionId: z.string(),
    sender: z.enum(['user', 'claude']).optional(),
  })
);

/** Message sent to Claude */
export const MessageSentToClaude = EventBus.define(
  'message.sent_to_claude',
  z.object({
    content: z.string(),
    source: z.string().optional(),
  })
);

/** Message sent to bridge */
export const MessageSentToBridge = EventBus.define(
  'message.sent_to_bridge',
  z.object({
    type: z.string(),
    sessionId: z.string(),
  })
);

// ============================================
// Permission Events
// ============================================

/** Permission requested by Claude */
export const PermissionRequested = EventBus.define(
  'permission.requested',
  z.object({
    requestId: z.string(),
    command: z.string(),
    question: z.string(),
    toolInput: z.record(z.unknown()).optional(),
  })
);

/** Permission approved */
export const PermissionApproved = EventBus.define(
  'permission.approved',
  z.object({
    requestId: z.string(),
    alwaysAllow: z.boolean(),
  })
);

/** Permission denied */
export const PermissionDenied = EventBus.define(
  'permission.denied',
  z.object({
    requestId: z.string(),
  })
);

// ============================================
// Claude Process Events
// ============================================

/** Claude process started */
export const ClaudeStarted = EventBus.define(
  'claude.started',
  z.object({
    sessionId: z.string(),
    pid: z.number().optional(),
  })
);

/** Claude process exited */
export const ClaudeExited = EventBus.define(
  'claude.exited',
  z.object({
    sessionId: z.string(),
    exitCode: z.number().nullable(),
    signal: z.string().nullable().optional(),
  })
);

/** Claude process error */
export const ClaudeError = EventBus.define(
  'claude.error',
  z.object({
    message: z.string(),
  })
);

// ============================================
// E2E Encryption Events
// ============================================

/** E2E key exchange initiated */
export const E2EKeyExchangeStarted = EventBus.define(
  'e2e.key_exchange_started',
  z.object({
    sessionId: z.string(),
  })
);

/** E2E encryption established */
export const E2EEstablished = EventBus.define(
  'e2e.established',
  z.object({
    sessionId: z.string(),
  })
);

/** E2E error */
export const E2EError = EventBus.define(
  'e2e.error',
  z.object({
    message: z.string(),
    phase: z.enum(['init', 'key_exchange', 'encrypt', 'decrypt']),
  })
);

// ============================================
// Terminal Events
// ============================================

/** Terminal input received */
export const TerminalInput = EventBus.define(
  'terminal.input',
  z.object({
    data: z.string(),
    isSlashCommand: z.boolean(),
  })
);

/** Terminal output produced */
export const TerminalOutput = EventBus.define(
  'terminal.output',
  z.object({
    data: z.string(),
    sessionId: z.string(),
  })
);

// ============================================
// Lifecycle Events
// ============================================

/** Application starting */
export const AppStarting = EventBus.define(
  'app.starting',
  z.object({
    sessionId: z.string(),
    mode: z.enum(['direct', 'agent', 'remote', 'attach']),
  })
);

/** Application shutting down */
export const AppShuttingDown = EventBus.define(
  'app.shutting_down',
  z.object({
    reason: z.enum(['user', 'error', 'signal', 'session_end']),
  })
);

// ============================================
// Export all events for convenience
// ============================================

export const Events = {
  // Bridge
  BridgeConnected,
  BridgeDisconnected,
  BridgeAuthenticated,
  BridgeAuthError,
  BridgeError,
  BridgeReconnecting,
  // Session
  SessionRegistered,
  SessionEnded,
  SessionRenamed,
  SessionFileFound,
  // Message
  MessageReceived,
  MessageSentToClaude,
  MessageSentToBridge,
  // Permission
  PermissionRequested,
  PermissionApproved,
  PermissionDenied,
  // Claude
  ClaudeStarted,
  ClaudeExited,
  ClaudeError,
  // E2E
  E2EKeyExchangeStarted,
  E2EEstablished,
  E2EError,
  // Terminal
  TerminalInput,
  TerminalOutput,
  // Lifecycle
  AppStarting,
  AppShuttingDown,
} as const;
