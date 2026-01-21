import * as fs from 'fs';
import * as path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import { colors } from '../utils/colors';
import {
  LOCAL_SERVER_PORT,
  AGENT_PORT_FILE,
  AGENT_PID_FILE,
  AGENT_START_TIME_FILE,
} from '../utils/config';
import { agentState } from './state';
import { send } from './bridge';
import { log } from './utils';
import type { LocalMessage } from './types';

let localServer: WebSocketServer | null = null;

/**
 * Start local WebSocket server for vibe-cli connections
 */
export function startLocalServer(): void {
  try {
    localServer = new WebSocketServer({ port: LOCAL_SERVER_PORT });

    localServer.on('listening', () => {
      log(`Local server listening on port ${LOCAL_SERVER_PORT}`, colors.green);

      // Write port file for auto-discovery
      try {
        fs.writeFileSync(AGENT_PORT_FILE, LOCAL_SERVER_PORT.toString(), 'utf8');
      } catch {
        // Ignore
      }

      // Write PID and start time for status command
      try {
        fs.writeFileSync(AGENT_PID_FILE, process.pid.toString(), 'utf8');
        fs.writeFileSync(AGENT_START_TIME_FILE, Date.now().toString(), 'utf8');
      } catch {
        // Ignore
      }
    });

    localServer.on('connection', (clientWs: WebSocket) => {
      log('Local vibe-cli connected', colors.cyan);

      agentState.localClients.set(clientWs, {
        sessionId: null,
        authenticated: false,
      });

      clientWs.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as LocalMessage;
          handleLocalMessage(clientWs, msg);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          log(`Failed to parse local message: ${message}`, colors.red);
        }
      });

      clientWs.on('close', () => {
        handleClientDisconnect(clientWs);
      });

      clientWs.on('error', (err: Error) => {
        log(`Local client error: ${err.message}`, colors.red);
      });
    });

    localServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log(`Port ${LOCAL_SERVER_PORT} in use - another agent running?`, colors.red);
      } else {
        log(`Local server error: ${err.message}`, colors.red);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to start local server: ${message}`, colors.red);
  }
}

/**
 * Stop local server
 */
export function stopLocalServer(): void {
  if (localServer) {
    localServer.close();
    localServer = null;
  }

  // Remove port, PID, and start time files
  try {
    if (fs.existsSync(AGENT_PORT_FILE)) fs.unlinkSync(AGENT_PORT_FILE);
    if (fs.existsSync(AGENT_PID_FILE)) fs.unlinkSync(AGENT_PID_FILE);
    if (fs.existsSync(AGENT_START_TIME_FILE)) fs.unlinkSync(AGENT_START_TIME_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Handle client disconnect
 */
function handleClientDisconnect(clientWs: WebSocket): void {
  const state = agentState;
  const clientInfo = state.localClients.get(clientWs);

  if (clientInfo?.sessionId) {
    const sessionId = clientInfo.sessionId;

    if (clientInfo.isAttached) {
      // Attached client disconnected
      const session = state.runningSessions.get(sessionId);
      if (session?.attachedClients) {
        session.attachedClients.delete(clientWs);
        log(`Attached client disconnected from session ${sessionId.slice(0, 8)}`, colors.dim);
      }
    } else {
      // Session owner disconnected - end session
      const wasIntentionalStop = state.stoppingSessions.has(sessionId);
      state.stoppingSessions.delete(sessionId);

      log(
        `Local session ${sessionId.slice(0, 8)} ${wasIntentionalStop ? 'stopped' : 'disconnected'}`,
        colors.dim
      );

      const session = state.runningSessions.get(sessionId);
      if (session) {
        state.addToSessionHistory(sessionId, session.path, session.name);

        // Notify attached clients
        if (session.attachedClients) {
          for (const attachedWs of session.attachedClients) {
            try {
              attachedWs.send(
                JSON.stringify({
                  type: 'session_ended',
                  sessionId,
                  reason: wasIntentionalStop ? 'stopped_by_user' : 'disconnected',
                })
              );
            } catch {
              // Ignore
            }
          }
        }
      }

      state.runningSessions.delete(sessionId);

      send({
        type: 'agent_session_ended',
        sessionId,
        exitCode: 0,
        reason: wasIntentionalStop ? 'stopped_by_user' : 'disconnected',
      });
    }
  }

  state.localClients.delete(clientWs);
}

/**
 * Handle message from local vibe-cli
 */
function handleLocalMessage(clientWs: WebSocket, msg: LocalMessage): void {
  const state = agentState;
  const clientInfo = state.localClients.get(clientWs);
  if (!clientInfo) return;

  switch (msg.type) {
    case 'authenticate':
      // Local clients inherit agent's auth
      clientInfo.authenticated = true;
      clientWs.send(
        JSON.stringify({
          type: 'authenticated',
          userId: 'local',
          email: 'via-agent',
        })
      );
      break;

    case 'register_session': {
      const sessionId = msg.sessionId as string;
      clientInfo.sessionId = sessionId;

      state.runningSessions.set(sessionId, {
        localWs: clientWs,
        path: (msg.path as string) || process.cwd(),
        name: (msg.name as string) || path.basename((msg.path as string) || process.cwd()),
        startedAt: new Date().toISOString(),
        managed: true,
        attachedClients: new Set(),
      });

      log(
        `Local session registered: ${sessionId.slice(0, 8)} (${msg.name || msg.path})`,
        colors.green
      );

      if (!state.agentId) {
        log('Warning: Agent not authenticated yet, session will not be managed', colors.yellow);
      }

      const registrationMsg = {
        ...msg,
        agentId: state.agentId || null,
        agentHostName: state.agentId ? state.hostName : null,
      };

      if (send(registrationMsg)) {
        // Bridge will respond with session_registered
      } else {
        clientWs.send(JSON.stringify({ type: 'error', message: 'Not connected to bridge' }));
      }
      break;
    }

    case 'attach_session': {
      const attachSessionId = msg.sessionId as string;

      if (!attachSessionId) {
        clientWs.send(JSON.stringify({ type: 'attach_error', error: 'sessionId is required' }));
        break;
      }

      if (state.stoppingSessions.has(attachSessionId)) {
        log(`Attach failed: session ${attachSessionId.slice(0, 8)} is stopping`, colors.yellow);
        clientWs.send(
          JSON.stringify({
            type: 'attach_error',
            sessionId: attachSessionId,
            error: 'Session is currently stopping. Cannot attach.',
          })
        );
        break;
      }

      const session = state.runningSessions.get(attachSessionId);
      if (!session) {
        log(`Attach failed: session ${attachSessionId.slice(0, 8)} not found`, colors.red);
        clientWs.send(
          JSON.stringify({
            type: 'attach_error',
            sessionId: attachSessionId,
            error: 'Session not found. It may have ended or is running on a different agent.',
          })
        );
        break;
      }

      clientInfo.sessionId = attachSessionId;
      clientInfo.isAttached = true;

      if (!session.attachedClients) {
        session.attachedClients = new Set();
      }
      session.attachedClients.add(clientWs);

      log(
        `Client attached to session ${attachSessionId.slice(0, 8)} (${session.attachedClients.size} attached)`,
        colors.cyan
      );

      clientWs.send(
        JSON.stringify({
          type: 'attach_success',
          sessionId: attachSessionId,
          name: session.name,
          path: session.path,
        })
      );
      break;
    }

    case 'list_sessions': {
      const sessionsList = [];
      for (const [sessionId, session] of state.runningSessions) {
        const source = session.process ? 'ios' : 'cli';
        sessionsList.push({
          sessionId,
          name: session.name,
          path: session.path,
          startedAt: session.startedAt,
          source,
        });
      }
      clientWs.send(JSON.stringify({ type: 'sessions_list', sessions: sessionsList }));
      log(`Listed ${sessionsList.length} running sessions`, colors.dim);
      break;
    }

    case 'terminal_input': {
      const targetSession = state.runningSessions.get(clientInfo.sessionId || '');
      if (targetSession?.localWs && clientInfo.isAttached) {
        try {
          targetSession.localWs.send(JSON.stringify({ type: 'terminal_input', data: msg.data }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          log(`Failed to forward terminal input: ${message}`, colors.red);
        }
      }
      break;
    }

    case 'terminal_output': {
      const outputSession = state.runningSessions.get(clientInfo.sessionId || '');
      if (outputSession?.attachedClients) {
        for (const attachedWs of outputSession.attachedClients) {
          try {
            attachedWs.send(JSON.stringify(msg));
          } catch {
            // Ignore
          }
        }
      }
      break;
    }

    default: {
      // Add sessionId if not present
      if (!msg.sessionId && clientInfo.sessionId) {
        msg.sessionId = clientInfo.sessionId;
      }

      // Log important message types
      const sessionPrefix = msg.sessionId ? `[${(msg.sessionId as string).slice(0, 8)}]` : '';

      if (msg.type === 'claude_message') {
        const rawContent = msg.message?.content || msg.content;
        const sender = msg.message?.sender || 'claude';
        const contentStr =
          typeof rawContent === 'string'
            ? rawContent
            : rawContent && typeof rawContent === 'object' && 'ciphertext' in rawContent
              ? '[encrypted]'
              : JSON.stringify(rawContent || '');
        const preview = contentStr.slice(0, 150);
        const truncated = contentStr.length > 150 ? '...' : '';
        const label = sender === 'user' ? 'User' : 'Claude';
        log(
          `${sessionPrefix} ${label}: ${preview}${truncated}`,
          sender === 'user' ? colors.green : colors.cyan
        );
      } else if (msg.type === 'permission_request') {
        log(
          `${sessionPrefix} Permission request: ${msg.toolName || msg.question || 'unknown'}`,
          colors.yellow
        );
      }

      // Relay to attached clients
      if (['claude_message', 'permission_request', 'session_status'].includes(msg.type)) {
        const msgSession = state.runningSessions.get(clientInfo.sessionId || '');
        if (msgSession?.attachedClients) {
          for (const attachedWs of msgSession.attachedClients) {
            try {
              attachedWs.send(JSON.stringify(msg));
            } catch {
              // Ignore
            }
          }
        }
      }

      if (send(msg as Record<string, unknown>)) {
        // Message relayed successfully
      } else {
        clientWs.send(JSON.stringify({ type: 'error', message: 'Not connected to bridge' }));
      }
      break;
    }
  }
}
