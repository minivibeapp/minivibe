/**
 * Schema exports
 * Re-exports all Zod schemas for easy importing
 */

// Message schemas
export {
  // Outgoing messages (CLI -> Bridge)
  AuthenticateMessageSchema,
  RegisterSessionMessageSchema,
  ClaudeMessageSchema,
  PermissionRequestMessageSchema,
  SessionEndedMessageSchema,
  RenameSessionMessageSchema,
  TerminalOutputMessageSchema,
  KeyExchangeMessageSchema,
  // Incoming messages (Bridge -> CLI)
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  SessionRegisteredMessageSchema,
  SessionRenamedMessageSchema,
  SessionStopMessageSchema,
  SendMessageMessageSchema,
  ApprovePermissionMessageSchema,
  ApprovePermissionAlwaysMessageSchema,
  DenyPermissionMessageSchema,
  TerminalInputMessageSchema,
  ErrorMessageSchema,
  // Union type
  BridgeMessageSchema,
  // Claude prompts
  PermissionPromptSchema,
  PermissionPromptOptionSchema,
  // Session file
  SessionFileMessageSchema,
  // Validation helpers
  parseBridgeMessage,
  parsePermissionPrompt,
  parseSessionFileMessage,
  // Types
  type BridgeMessage,
  type PermissionPrompt,
  type SessionFileMessage,
} from './messages';

// Config schemas
export {
  CliOptionsSchema,
  SubcommandOptsSchema,
  UserConfigSchema,
  AgentConfigSchema,
  SessionHistoryEntrySchema,
  StoredAuthSchema,
  // Validation helpers
  validateCliOptions,
  parseUserConfig,
  parseAgentConfig,
  // Types
  type CliOptions,
  type SubcommandOpts,
  type UserConfig,
  type AgentConfig,
  type SessionHistoryEntry,
  type StoredAuth,
} from './config';
