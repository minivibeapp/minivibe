/**
 * Zod schemas for CLI options and configuration
 */

import { z } from 'zod';

// ============================================
// CLI Options Schema
// ============================================

export const CliOptionsSchema = z.object({
  initialPrompt: z.string().nullable(),
  resumeSessionId: z.string().nullable(),
  bridgeUrl: z.string().url().nullable(),
  agentUrl: z.string().url().nullable(),
  sessionName: z.string().nullable(),
  headlessMode: z.boolean().default(false),
  useNodePty: z.boolean(),
  skipPermissions: z.boolean().default(false),
  listSessions: z.boolean().default(false),
  remoteAttachMode: z.boolean().default(false),
  e2eEnabled: z.boolean().default(false),
  verboseMode: z.boolean().default(false),
  jsonMode: z.boolean().default(false),
  loginMode: z.boolean().default(false),
  logoutMode: z.boolean().default(false),
  statusMode: z.boolean().default(false),
  helpMode: z.boolean().default(false),
  whoamiMode: z.boolean().default(false),
});

export type CliOptions = z.infer<typeof CliOptionsSchema>;

// ============================================
// Subcommand Options Schema
// ============================================

export const SubcommandOptsSchema = z.object({
  folderId: z.string().nullable(),
  fileType: z.string().nullable(),
  outputPath: z.string().nullable(),
  fileName: z.string().nullable(),
  content: z.string().nullable(),
  force: z.boolean().default(false),
  json: z.boolean().default(false),
  running: z.boolean().default(false),
  recent: z.boolean().default(false),
  targetPath: z.string().nullable(),
  newName: z.string().nullable(),
});

export type SubcommandOpts = z.infer<typeof SubcommandOptsSchema>;

// ============================================
// User Config File Schema (~/.vibe/config.json)
// ============================================

export const UserConfigSchema = z.object({
  // Connection settings
  bridgeUrl: z.string().url().optional(),
  agentUrl: z.string().url().optional(),

  // Feature toggles
  e2eEnabled: z.boolean().optional(),
  verboseMode: z.boolean().optional(),

  // Timing overrides (milliseconds)
  heartbeatInterval: z.number().int().positive().optional(),
  reconnectDelay: z.number().int().positive().optional(),
  tokenRefreshBuffer: z.number().int().positive().optional(),

  // Limits
  maxMobileMessages: z.number().int().positive().optional(),
  maxCompletedTools: z.number().int().positive().optional(),
  e2ePendingTimeoutMs: z.number().int().positive().optional(),

  // Display
  theme: z.enum(['default', 'dark', 'light']).optional(),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

// ============================================
// Agent Config Schema (~/.vibe-agent/config.json)
// ============================================

export const AgentConfigSchema = z.object({
  agentId: z.string().optional(),
  bridgeUrl: z.string().url().optional(),
  hostName: z.string().optional(),
  e2eEnabled: z.boolean().optional(),
  port: z.number().int().positive().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================
// Session History Entry Schema
// ============================================

/**
 * ISO date string validation (accepts toISOString() output)
 * More lenient than z.string().datetime() which requires exact format
 */
const isoDateString = z.string().refine(
  (val) => !Number.isNaN(Date.parse(val)),
  { message: 'Invalid date string' }
);

export const SessionHistoryEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  endedAt: isoDateString,
});

export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;

// ============================================
// Stored Auth Schema (~/.vibe/auth.json)
// ============================================

export const StoredAuthSchema = z.object({
  idToken: z.string(),
  refreshToken: z.string().nullable().optional(),
  updatedAt: isoDateString.optional(),
});

export type StoredAuth = z.infer<typeof StoredAuthSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate CLI options, returning defaults for invalid fields
 */
export function validateCliOptions(raw: unknown): CliOptions {
  const result = CliOptionsSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  // Return partial valid data merged with defaults
  console.warn('Invalid CLI options, using defaults:', result.error.issues);
  return CliOptionsSchema.parse({
    initialPrompt: null,
    resumeSessionId: null,
    bridgeUrl: null,
    agentUrl: null,
    sessionName: null,
    headlessMode: false,
    useNodePty: process.platform === 'win32',
    skipPermissions: false,
    listSessions: false,
    remoteAttachMode: false,
    e2eEnabled: false,
    verboseMode: false,
    jsonMode: false,
    loginMode: false,
    logoutMode: false,
    statusMode: false,
    helpMode: false,
    whoamiMode: false,
  });
}

/**
 * Safely parse user config file
 */
export function parseUserConfig(raw: unknown): UserConfig {
  const result = UserConfigSchema.safeParse(raw);
  return result.success ? result.data : {};
}

/**
 * Safely parse agent config file
 */
export function parseAgentConfig(raw: unknown): AgentConfig {
  const result = AgentConfigSchema.safeParse(raw);
  return result.success ? result.data : {};
}
