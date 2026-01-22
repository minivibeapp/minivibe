/**
 * Shared context/state for the entire application
 * This replaces the global variables in vibe.js
 */

import type { ChildProcess } from 'child_process';
import type WebSocket from 'ws';
import type { PermissionPrompt } from './claude/types';
import type { E2EInterface } from './bridge/connection';

// Re-export for convenience
export type { PermissionPrompt, E2EInterface };

/**
 * Pending permission request
 */
export interface PendingPermission {
  command: string;
  timestamp: number;
}

/**
 * CLI options parsed from command line arguments
 */
export interface CliOptions {
  initialPrompt: string | null;
  resumeSessionId: string | null;
  bridgeUrl: string | null;
  agentUrl: string | null;
  sessionName: string | null;
  headlessMode: boolean;
  useNodePty: boolean;
  skipPermissions: boolean;
  listSessions: boolean;
  remoteAttachMode: boolean;
  e2eEnabled: boolean;
  verboseMode: boolean;
  jsonMode: boolean;
  loginMode: boolean;
  logoutMode: boolean;
  statusMode: boolean;
  helpMode: boolean;
  whoamiMode: boolean;
}

/**
 * Subcommand mode (file upload, session list, etc.)
 */
export interface SubcommandMode {
  group: string;
  action: string;
}

/**
 * Subcommand options
 */
export interface SubcommandOpts {
  folderId: string | null;
  fileType: string | null;
  outputPath: string | null;
  fileName: string | null;
  content: string | null;
  force: boolean;
  json: boolean;
  running: boolean;
  recent: boolean;
  targetPath: string | null;
  newName: string | null;
}

/**
 * Main application context
 */
export interface AppContext {
  // Session identifiers
  sessionId: string;
  effectiveSessionId: string;
  bridgeSessionId: string | null;

  // CLI options
  options: CliOptions;
  subcommandMode: SubcommandMode | null;
  subcommandOpts: SubcommandOpts;

  // Authentication
  authToken: string | null;
  isAuthenticated: boolean;

  // Bridge connection
  bridgeSocket: WebSocket | null;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;

  // Claude process
  claudeProcess: ChildProcess | null;
  isRunning: boolean;
  isShuttingDown: boolean;

  // Session file watching
  sessionFileWatcher: (() => void) | null;
  lastFileSize: number;
  discoveredSessionFile: string | null;

  // Permission handling
  pendingPermission: PendingPermission | null;
  lastApprovalTime: number;
  completedToolIds: Set<string>;
  lastCapturedPrompt: PermissionPrompt | null;

  // Mobile message deduplication
  mobileMessageHashes: Set<string>;

  // E2E encryption
  e2e: E2EInterface | null;
  e2ePending: boolean;
  e2ePendingMessages: Array<{ msg: unknown; timestamp: number }>;

  // Input handling
  inputBuffer: string;

  // Signal handlers (for cleanup)
  sigwinchHandler: (() => void) | null;

  // Callbacks (set by CLI)
  callbacks: AppCallbacks;
}

/**
 * Callbacks for inter-module communication
 */
export interface AppCallbacks {
  // Logging (uses verboseMode state)
  log: (msg: string, color?: string) => void;
  logStderr: (msg: string, color?: string) => void;
  logStatus: (msg: string) => void;

  // Bridge communication
  sendToBridge: (data: Record<string, unknown>) => boolean;

  // Claude communication
  sendToClaude: (content: string, source?: string) => boolean;

  // Terminal output
  writeToTerminal: (data: Buffer | string) => void;
}

/**
 * Create default CLI options
 */
export function createDefaultOptions(): CliOptions {
  return {
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
    whoamiMode: false,
    helpMode: false,
  };
}

/**
 * Create default subcommand options
 */
export function createDefaultSubcommandOpts(): SubcommandOpts {
  return {
    folderId: null,
    fileType: null,
    outputPath: null,
    fileName: null,
    content: null,
    force: false,
    json: false,
    running: false,
    recent: false,
    targetPath: null,
    newName: null,
  };
}

/**
 * Create a new application context
 */
export function createAppContext(
  sessionId: string,
  effectiveSessionId: string,
  options: CliOptions = createDefaultOptions()
): AppContext {
  return {
    // Session identifiers
    sessionId,
    effectiveSessionId,
    bridgeSessionId: process.env.VIBE_SESSION_ID || null,

    // CLI options
    options,
    subcommandMode: null,
    subcommandOpts: createDefaultSubcommandOpts(),

    // Authentication
    authToken: null,
    isAuthenticated: false,

    // Bridge connection
    bridgeSocket: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    reconnectAttempt: 0,

    // Claude process
    claudeProcess: null,
    isRunning: false,
    isShuttingDown: false,

    // Session file watching
    sessionFileWatcher: null,
    lastFileSize: 0,
    discoveredSessionFile: null,

    // Permission handling
    pendingPermission: null,
    lastApprovalTime: 0,
    completedToolIds: new Set(),
    lastCapturedPrompt: null,

    // Mobile message deduplication
    mobileMessageHashes: new Set(),

    // E2E encryption
    e2e: null,
    e2ePending: false,
    e2ePendingMessages: [],

    // Input handling
    inputBuffer: '',

    // Signal handlers
    sigwinchHandler: null,

    // Callbacks (will be set by CLI)
    callbacks: {
      log: () => {},
      logStderr: () => {},
      logStatus: () => {},
      sendToBridge: () => false,
      sendToClaude: () => false,
      writeToTerminal: () => {},
    },
  };
}
