/**
 * Zod schemas for bridge and Claude messages
 * Pattern inspired by OpenCode's bus-event schemas
 */

import { z } from 'zod';

// ============================================
// Base Types
// ============================================

/** UUID v4 format validation */
const UUIDSchema = z.string().uuid();

/** Session ID can be UUID or custom string */
const SessionIdSchema = z.string().min(1);

// ============================================
// Outgoing Messages (CLI -> Bridge)
// ============================================

export const AuthenticateMessageSchema = z.object({
  type: z.literal('authenticate'),
  token: z.string(),
});

export const RegisterSessionMessageSchema = z.object({
  type: z.literal('register_session'),
  sessionId: SessionIdSchema,
  path: z.string(),
  name: z.string(),
  e2e: z.boolean().optional(),
  agentId: z.string().optional(),
  agentHostName: z.string().optional(),
});

export const ClaudeMessageSchema = z.object({
  type: z.literal('claude_message'),
  sessionId: SessionIdSchema,
  message: z.object({
    id: z.string(),
    sender: z.enum(['user', 'claude']),
    content: z.string(),
    timestamp: z.string(),
  }),
});

export const PermissionRequestMessageSchema = z.object({
  type: z.literal('permission_request'),
  sessionId: SessionIdSchema,
  requestId: z.string(),
  command: z.string(),
  question: z.string(),
  displayText: z.string().optional(),
  fullText: z.string().optional(),
});

export const SessionEndedMessageSchema = z.object({
  type: z.literal('session_ended'),
  sessionId: SessionIdSchema,
  exitCode: z.number().nullable(),
  signal: z.string().optional(),
});

export const RenameSessionMessageSchema = z.object({
  type: z.literal('rename_session'),
  sessionId: SessionIdSchema,
  name: z.string(),
});

export const TerminalOutputMessageSchema = z.object({
  type: z.literal('terminal_output'),
  sessionId: SessionIdSchema,
  data: z.string(), // base64 encoded
});

export const KeyExchangeMessageSchema = z.object({
  type: z.literal('key_exchange'),
  sessionId: SessionIdSchema.optional(),
  publicKey: z.string(),
  isInitiator: z.boolean().optional(),
});

// ============================================
// Incoming Messages (Bridge -> CLI)
// ============================================

export const AuthenticatedMessageSchema = z.object({
  type: z.literal('authenticated'),
  email: z.string().optional(),
  userId: z.string().optional(),
});

export const AuthErrorMessageSchema = z.object({
  type: z.literal('auth_error'),
  message: z.string(),
});

export const SessionRegisteredMessageSchema = z.object({
  type: z.literal('session_registered'),
  sessionId: SessionIdSchema,
});

export const SessionRenamedMessageSchema = z.object({
  type: z.literal('session_renamed'),
  sessionId: SessionIdSchema.optional(),
  name: z.string(),
});

export const SessionStopMessageSchema = z.object({
  type: z.literal('session_stop'),
  sessionId: SessionIdSchema.optional(),
});

/** E2E encrypted content wrapper */
const EncryptedContentSchema = z.object({
  e2e: z.literal(true),
  ciphertext: z.string(),
});

export const SendMessageMessageSchema = z.object({
  type: z.literal('send_message'),
  sessionId: SessionIdSchema.optional(),
  content: z.union([z.string(), EncryptedContentSchema]),
});

export const ApprovePermissionMessageSchema = z.object({
  type: z.literal('approve_permission'),
  sessionId: SessionIdSchema.optional(),
  requestId: z.string().optional(),
});

export const ApprovePermissionAlwaysMessageSchema = z.object({
  type: z.literal('approve_permission_always'),
  sessionId: SessionIdSchema.optional(),
  requestId: z.string().optional(),
});

export const DenyPermissionMessageSchema = z.object({
  type: z.literal('deny_permission'),
  sessionId: SessionIdSchema.optional(),
  requestId: z.string().optional(),
});

export const TerminalInputMessageSchema = z.object({
  type: z.literal('terminal_input'),
  sessionId: SessionIdSchema.optional(),
  data: z.string(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

// ============================================
// Discriminated Union for All Bridge Messages
// ============================================

/** All possible incoming bridge message types */
export const BridgeMessageSchema = z.discriminatedUnion('type', [
  // Auth
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  // Session
  SessionRegisteredMessageSchema,
  SessionRenamedMessageSchema,
  SessionStopMessageSchema,
  // Communication
  SendMessageMessageSchema,
  KeyExchangeMessageSchema,
  // Permissions
  ApprovePermissionMessageSchema,
  ApprovePermissionAlwaysMessageSchema,
  DenyPermissionMessageSchema,
  // Terminal
  TerminalInputMessageSchema,
  // Errors
  ErrorMessageSchema,
]);

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

// ============================================
// Claude Permission Prompt Schema
// ============================================

export const PermissionPromptOptionSchema = z.object({
  id: z.number(),
  label: z.string(),
  requiresInput: z.boolean().optional(),
});

export const PermissionPromptSchema = z.object({
  type: z.literal('permission_prompt'),
  tool_name: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
  prompt_id: z.string().optional(),
  question: z.string().optional(),
  options: z.array(PermissionPromptOptionSchema).optional(),
});

export type PermissionPrompt = z.infer<typeof PermissionPromptSchema>;

// ============================================
// Session File Message Schema
// ============================================

/** Content block types in session file */
const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()).optional(),
});

const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.unknown()]),
});

const ContentBlockSchema = z.union([
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
]);

export const SessionFileMessageSchema = z.object({
  type: z.enum(['user', 'assistant']),
  uuid: z.string().optional(),
  message: z.object({
    content: z.union([z.string(), z.array(ContentBlockSchema)]),
  }),
});

export type SessionFileMessage = z.infer<typeof SessionFileMessageSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Safely parse a bridge message with detailed error info
 * Returns { success: true, data } or { success: false, error }
 */
export function parseBridgeMessage(raw: unknown): z.SafeParseReturnType<unknown, BridgeMessage> {
  return BridgeMessageSchema.safeParse(raw);
}

/**
 * Safely parse a permission prompt
 */
export function parsePermissionPrompt(raw: unknown): z.SafeParseReturnType<unknown, PermissionPrompt> {
  return PermissionPromptSchema.safeParse(raw);
}

/**
 * Safely parse a session file message
 */
export function parseSessionFileMessage(raw: unknown): z.SafeParseReturnType<unknown, SessionFileMessage> {
  return SessionFileMessageSchema.safeParse(raw);
}
