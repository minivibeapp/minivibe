import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { colors } from '../utils/colors';
import { HEARTBEAT_INTERVAL } from '../utils/config';
import { Retry } from '../utils/retry';
import { refreshIdToken } from '../auth';
import { agentState } from './state';
import { log } from './utils';
import { handleStartSession, handleResumeSession, handleStopSession } from './session';
import type { BridgeMessage } from './types';

/**
 * Connect to bridge WebSocket server
 */
export function connect(): void {
  const state = agentState;

  if (!state.bridgeUrl) {
    log('No bridge URL configured', colors.red);
    process.exit(1);
  }

  log(`Connecting to ${state.bridgeUrl}...`, colors.cyan);

  try {
    state.ws = new WebSocket(state.bridgeUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to create WebSocket: ${message}`, colors.red);
    scheduleReconnect();
    return;
  }

  state.ws.on('open', () => {
    log('Connected to bridge', colors.green);
    state.clearReconnectTimer();
    // Reset reconnect attempt counter on successful connection
    state.reconnectAttempt = 0;

    if (state.authToken) {
      send({ type: 'authenticate', token: state.authToken });
    } else {
      log('No auth token available', colors.red);
      process.exit(1);
    }
  });

  state.ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString()) as BridgeMessage;
      handleMessage(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log(`Failed to parse message: ${message}`, colors.red);
    }
  });

  state.ws.on('close', () => {
    log('Disconnected from bridge', colors.yellow);
    state.isAuthenticated = false;
    stopHeartbeat();

    // Notify all local clients that bridge is disconnected
    for (const [clientWs] of state.localClients) {
      try {
        clientWs.send(
          JSON.stringify({
            type: 'bridge_disconnected',
            message: 'Bridge connection lost, reconnecting...',
          })
        );
      } catch {
        // Client may already be closed
      }
    }

    scheduleReconnect();
  });

  state.ws.on('error', (err: Error) => {
    log(`WebSocket error: ${err.message}`, colors.red);
  });
}

/**
 * Send message to bridge
 */
export function send(msg: Record<string, unknown>): boolean {
  const state = agentState;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

/**
 * Schedule reconnect after delay with exponential backoff
 */
function scheduleReconnect(): void {
  const state = agentState;
  if (state.reconnectTimer) return;

  state.reconnectAttempt += 1;
  const delayMs = Retry.withJitter(Retry.delay(state.reconnectAttempt));
  log(`Reconnecting in ${Retry.formatDelay(delayMs)} (attempt ${state.reconnectAttempt})...`, colors.dim);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delayMs);
}

/**
 * Start heartbeat timer
 */
function startHeartbeat(): void {
  stopHeartbeat();
  agentState.heartbeatTimer = setInterval(() => {
    send({ type: 'agent_heartbeat' });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat timer
 */
function stopHeartbeat(): void {
  agentState.clearHeartbeatTimer();
}

/**
 * Handle message from bridge
 */
function handleMessage(msg: BridgeMessage): void {
  const state = agentState;

  switch (msg.type) {
    case 'authenticated':
      state.isAuthenticated = true;
      log(`Authenticated as ${msg.email || msg.userId}`, colors.green);

      // Register as an agent
      if (!state.agentId) {
        state.agentId = uuidv4();
        const config = state.loadConfig();
        config.agentId = state.agentId;
        state.saveConfig(config);
        log(`Generated new agent ID: ${state.agentId.slice(0, 8)}...`, colors.dim);
      }

      send({
        type: 'agent_register',
        agentId: state.agentId,
        hostName: state.hostName,
        platform: process.platform,
        activeSessions: Array.from(state.runningSessions.keys()),
      });
      startHeartbeat();

      // Re-register all sessions with bridge after reconnect
      for (const [sessionId, session] of state.runningSessions) {
        log(
          `Re-registering session: ${sessionId.slice(0, 8)} (${session.managed ? 'managed' : 'spawned'}${session.yolo ? ', yolo' : ''})`,
          colors.dim
        );
        send({
          type: 'register_session',
          sessionId,
          path: session.path,
          name: session.name,
          agentId: state.agentId,
          agentHostName: state.hostName,
          yolo: !!session.yolo,
        });
      }

      // Notify local clients that bridge is reconnected
      for (const [clientWs] of state.localClients) {
        try {
          clientWs.send(
            JSON.stringify({
              type: 'bridge_reconnected',
              message: 'Bridge connection restored',
            })
          );
        } catch {
          // Client may already be closed
        }
      }
      break;

    case 'auth_error':
      state.isAuthenticated = false;
      log(`Authentication failed: ${msg.message}`, colors.yellow);

      // Try to refresh token
      refreshIdToken().then(newToken => {
        if (newToken) {
          state.authToken = newToken;
          send({ type: 'authenticate', token: newToken });
        } else {
          log('Please re-login: vibe-agent login', colors.red);
        }
      }).catch(err => {
        log(`Token refresh failed: ${err instanceof Error ? err.message : err}`, colors.red);
        log('Please re-login: vibe-agent login', colors.red);
      });
      break;

    case 'agent_registered':
      log(`Agent registered: ${msg.agentId}`, colors.green);
      log(`Host: ${state.hostName}`, colors.dim);
      log(`E2E encryption: ${state.e2eEnabled ? 'enabled' : 'disabled'}`, colors.dim);
      log('Waiting for commands...', colors.cyan);
      break;

    case 'start_session':
      handleStartSession(msg);
      break;

    case 'resume_session':
      handleResumeSession(msg);
      break;

    case 'stop_session':
      handleStopSession(msg);
      break;

    case 'list_agent_sessions':
      send({
        type: 'agent_sessions',
        sessions: Array.from(state.runningSessions.entries()).map(([id, s]) => ({
          sessionId: id,
          path: s.path,
          name: s.name,
          status: 'active',
          yolo: !!s.yolo,
        })),
      });
      break;

    case 'error':
      log(`Bridge error: ${msg.message}`, colors.red);
      relayToLocalClient(msg);

      // Check for auth-related errors and try to refresh token
      const errorLower = (msg.message || '').toLowerCase();
      if (
        errorLower.includes('token') ||
        errorLower.includes('auth') ||
        errorLower.includes('unauthorized')
      ) {
        log('Attempting token refresh...', colors.yellow);
        refreshIdToken().then(newToken => {
          if (newToken) {
            state.authToken = newToken;
            log('Token refreshed, re-authenticating...', colors.green);
            send({ type: 'authenticate', token: newToken });
          } else {
            log('Token refresh failed. Please re-login: vibe-agent login', colors.red);
          }
        }).catch(err => {
          log(`Token refresh error: ${err instanceof Error ? err.message : err}`, colors.red);
          log('Please re-login: vibe-agent login', colors.red);
        });
      }
      break;

    // Messages to relay to local vibe-cli clients
    case 'session_registered':
    case 'joined_session':
    case 'message_history':
    case 'claude_message':
    case 'permission_request':
    case 'session_status':
    case 'session_ended':
    case 'session_renamed':
    case 'user_message':
    case 'permission_approved':
    case 'permission_denied':
      relayToLocalClient(msg);
      break;

    case 'send_message': {
      // Mobile sent a message - relay to local vibe-cli
      const sessionPrefix = msg.sessionId ? `[${msg.sessionId.slice(0, 8)}]` : '';
      const contentStr =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content?.ciphertext
            ? '[encrypted]'
            : JSON.stringify(msg.content || '');
      const preview = contentStr.slice(0, 150);
      const truncated = contentStr.length > 150 ? '...' : '';
      log(`${sessionPrefix} User: ${preview}${truncated}`, colors.green);
      if (!relayToLocalClient(msg)) {
        log(`${sessionPrefix} Failed to relay - no local client`, colors.yellow);
      }
      break;
    }

    default:
      // Try to relay unknown messages to local client
      if (msg.sessionId) {
        relayToLocalClient(msg);
      }
      break;
  }
}

/**
 * Relay bridge messages to appropriate local client
 */
export function relayToLocalClient(msg: BridgeMessage): boolean {
  const state = agentState;
  const sessionId = msg.sessionId;
  if (!sessionId) return false;

  const session = state.runningSessions.get(sessionId);
  if (!session?.localWs) return false;

  try {
    session.localWs.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to relay to local client: ${message}`, colors.red);
    return false;
  }
}
