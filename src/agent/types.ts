import WebSocket from 'ws';
import { ChildProcess } from 'child_process';

/**
 * Agent configuration stored on disk
 */
export interface AgentConfig {
  agentId?: string;
  bridgeUrl?: string;
  hostName?: string;
  e2e?: boolean;
}

/**
 * CLI options parsed from arguments
 */
export interface AgentOptions {
  bridge: string | null;
  token: string | null;
  login: boolean;
  logout: boolean;
  name: string | null;
  status: boolean;
  whoami: boolean;
  help: boolean;
  e2e: boolean;
}

/**
 * Session info for running sessions
 */
export interface RunningSession {
  process?: ChildProcess;
  localWs?: WebSocket;
  path: string;
  name: string;
  startedAt: string;
  managed?: boolean;
  attachedClients: Set<WebSocket>;
}

/**
 * Session history entry for resume capability
 */
export interface SessionHistoryEntry {
  path: string;
  name: string;
  endedAt: string;
}

/**
 * Local client info for tracking connected vibe-cli instances
 */
export interface LocalClientInfo {
  sessionId: string | null;
  authenticated: boolean;
  isAttached?: boolean;
}

/**
 * Bridge message types (incoming)
 */
export type BridgeMessageType =
  | 'authenticated'
  | 'auth_error'
  | 'agent_registered'
  | 'start_session'
  | 'resume_session'
  | 'stop_session'
  | 'list_agent_sessions'
  | 'error'
  | 'session_registered'
  | 'joined_session'
  | 'message_history'
  | 'claude_message'
  | 'claude_event'
  | 'permission_request'
  | 'session_status'
  | 'session_ended'
  | 'session_renamed'
  | 'user_message'
  | 'permission_approved'
  | 'permission_denied'
  | 'send_message';

/**
 * Generic bridge message
 */
export interface BridgeMessage {
  type: BridgeMessageType | string;
  sessionId?: string;
  requestId?: string;
  message?: string;
  email?: string;
  userId?: string;
  agentId?: string;
  path?: string;
  name?: string;
  prompt?: string;
  content?: string | { ciphertext?: string };
  error?: string;
  exitCode?: number;
  [key: string]: unknown;
}

/**
 * Local message types (from vibe-cli)
 */
export type LocalMessageType =
  | 'authenticate'
  | 'register_session'
  | 'attach_session'
  | 'list_sessions'
  | 'terminal_input'
  | 'terminal_output'
  | 'claude_message'
  | 'claude_event'
  | 'permission_request'
  | 'session_status';

/**
 * Generic local message from vibe-cli
 */
export interface LocalMessage {
  type: LocalMessageType | string;
  sessionId?: string;
  path?: string;
  name?: string;
  data?: string;
  message?: { content?: string; sender?: string };
  content?: string | { ciphertext?: string };
  toolName?: string;
  question?: string;
  [key: string]: unknown;
}
