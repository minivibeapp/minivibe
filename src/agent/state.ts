import * as fs from 'fs';
import * as os from 'os';
import WebSocket from 'ws';
import {
  AGENT_DIR,
  AGENT_CONFIG_FILE,
  AGENT_SESSION_HISTORY_FILE,
  MAX_SESSION_HISTORY,
  MAX_SESSION_HISTORY_AGE_DAYS,
} from '../utils/config';
import type {
  AgentConfig,
  RunningSession,
  SessionHistoryEntry,
  LocalClientInfo,
} from './types';

/**
 * Agent state - centralized state management
 */
export class AgentState {
  bridgeUrl: string | null = null;
  authToken: string | null = null;
  ws: WebSocket | null = null;
  isAuthenticated = false;
  agentId: string | null = null;
  hostName: string = os.hostname();
  reconnectTimer: NodeJS.Timeout | null = null;
  heartbeatTimer: NodeJS.Timeout | null = null;
  reconnectAttempt = 0;
  e2eEnabled = false;

  // Track running sessions: sessionId -> session info
  runningSessions: Map<string, RunningSession> = new Map();

  // Track session history for resume capability
  sessionHistory: Map<string, SessionHistoryEntry>;

  // Track sessions being intentionally stopped
  stoppingSessions: Set<string> = new Set();

  // Track local CLI connections: ws -> client info
  localClients: Map<WebSocket, LocalClientInfo> = new Map();

  constructor() {
    this.sessionHistory = this.loadSessionHistory();
  }

  /**
   * Load agent configuration from disk
   */
  loadConfig(): AgentConfig {
    try {
      if (fs.existsSync(AGENT_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf8'));
      }
    } catch {
      // Ignore errors
    }
    return {};
  }

  /**
   * Save agent configuration to disk
   */
  saveConfig(config: AgentConfig): void {
    try {
      if (!fs.existsSync(AGENT_DIR)) {
        fs.mkdirSync(AGENT_DIR, { recursive: true });
      }
      fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      if (process.platform !== 'win32') {
        fs.chmodSync(AGENT_CONFIG_FILE, 0o600);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Failed to save config: ${message}`);
    }
  }

  /**
   * Load session history from disk on startup
   */
  private loadSessionHistory(): Map<string, SessionHistoryEntry> {
    try {
      if (fs.existsSync(AGENT_SESSION_HISTORY_FILE)) {
        const data = JSON.parse(fs.readFileSync(AGENT_SESSION_HISTORY_FILE, 'utf8'));
        const map = new Map<string, SessionHistoryEntry>();
        const cutoffTime = Date.now() - MAX_SESSION_HISTORY_AGE_DAYS * 24 * 60 * 60 * 1000;

        for (const [sessionId, info] of Object.entries(data)) {
          const entry = info as SessionHistoryEntry;
          if (new Date(entry.endedAt).getTime() >= cutoffTime) {
            map.set(sessionId, entry);
          }
        }

        console.log(`[vibe-agent] Loaded ${map.size} sessions from history`);
        return map;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.log(`[vibe-agent] Failed to load session history: ${message}`);
    }
    return new Map();
  }

  /**
   * Save session history to disk
   */
  saveSessionHistory(): void {
    try {
      if (!fs.existsSync(AGENT_DIR)) {
        fs.mkdirSync(AGENT_DIR, { recursive: true });
      }
      const data = Object.fromEntries(this.sessionHistory);
      fs.writeFileSync(AGENT_SESSION_HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.log(`[vibe-agent] Failed to save session history: ${message}`);
    }
  }

  /**
   * Save session info to history for resume capability
   */
  addToSessionHistory(sessionId: string, path: string, name: string): void {
    // Limit history size
    if (this.sessionHistory.size >= MAX_SESSION_HISTORY) {
      const oldest = this.sessionHistory.keys().next().value;
      if (oldest) {
        this.sessionHistory.delete(oldest);
      }
    }

    this.sessionHistory.set(sessionId, {
      path,
      name,
      endedAt: new Date().toISOString(),
    });

    this.saveSessionHistory();
  }

  /**
   * Get session info from history
   */
  getFromSessionHistory(sessionId: string): SessionHistoryEntry | undefined {
    return this.sessionHistory.get(sessionId);
  }

  /**
   * Clear reconnect timer
   */
  clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Clear heartbeat timer
   */
  clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// Singleton instance
export const agentState = new AgentState();
