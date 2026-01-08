#!/usr/bin/env node

/**
 * vibe-agent - Persistent daemon for remote Claude Code session management
 *
 * Runs on a host (EC2, local Mac, etc.) and accepts commands from iOS to:
 * - Start new Claude Code sessions
 * - Resume existing sessions
 * - Stop running sessions
 *
 * Usage:
 *   vibe-agent --login    Sign in (one-time)
 *   vibe-agent            Start agent daemon
 */

const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ====================
// Configuration
// ====================

// Shared auth directory (same as vibe CLI)
const SHARED_AUTH_DIR = path.join(os.homedir(), '.vibe');
const AUTH_FILE = path.join(SHARED_AUTH_DIR, 'auth.json');

// Agent-specific config directory
const CONFIG_DIR = path.join(os.homedir(), '.vibe-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSION_HISTORY_FILE = path.join(CONFIG_DIR, 'session-history.json');

const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const LOCAL_SERVER_PORT = 9999;
const PORT_FILE = path.join(os.homedir(), '.vibe-agent', 'port');
const MAX_SESSION_HISTORY_AGE_DAYS = 30;
const DEFAULT_BRIDGE_URL = 'wss://ws.minivibeapp.com';
const PAIRING_URL = 'https://minivibeapp.com/pair';

// Show welcome message for first-time users (no auth)
function showWelcomeMessage() {
  console.log(`
Welcome to vibe-agent!

vibe-agent lets you manage Claude Code sessions from your iPhone.

To get started:
  1. Download MiniVibe from the App Store
  2. Run: vibe-agent --login
     (or 'vibe --login' - auth is shared between vibe and vibe-agent)

For help: vibe-agent --help
`);
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

function log(msg, color = colors.reset) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${msg}${colors.reset}`);
}

// ====================
// Configuration Management
// ====================

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    // Ignore
  }
  return {};
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    // Restrict permissions on Unix (Windows uses ACLs instead)
    if (process.platform !== 'win32') {
      fs.chmodSync(CONFIG_FILE, 0o600);
    }
  } catch (err) {
    log(`Failed to save config: ${err.message}`, colors.red);
  }
}

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    }
  } catch (err) {
    // Ignore
  }
  return null;
}

function saveAuth(idToken, refreshToken = null) {
  try {
    if (!fs.existsSync(SHARED_AUTH_DIR)) {
      fs.mkdirSync(SHARED_AUTH_DIR, { recursive: true });
    }
    const data = { idToken, refreshToken, updatedAt: new Date().toISOString() };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
    // Restrict permissions on Unix (Windows uses ACLs instead)
    if (process.platform !== 'win32') {
      fs.chmodSync(AUTH_FILE, 0o600);
    }
    return true;
  } catch (err) {
    log(`Failed to save auth: ${err.message}`, colors.red);
    return false;
  }
}

// ====================
// Token Refresh
// ====================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAJKYavMidKYxRpfhP2IHUiy8dafc3ISqc"
};

async function refreshIdToken() {
  const auth = loadAuth();
  if (!auth?.refreshToken) {
    return null;
  }

  try {
    log('Refreshing authentication token...', colors.dim);
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${auth.refreshToken}`
      }
    );

    if (!response.ok) {
      const error = await response.json();
      log(`Token refresh failed: ${error.error?.message || response.status}`, colors.yellow);
      return null;
    }

    const data = await response.json();
    saveAuth(data.id_token, data.refresh_token);
    log('Token refreshed successfully', colors.green);
    return data.id_token;
  } catch (err) {
    log(`Token refresh error: ${err.message}`, colors.red);
    return null;
  }
}

// ====================
// Agent State
// ====================

let bridgeUrl = null;
let authToken = null;
let ws = null;
let isAuthenticated = false;
let agentId = null;
let hostName = os.hostname();
let reconnectTimer = null;
let heartbeatTimer = null;

// Track running sessions: sessionId -> { process, path, name, localWs }
const runningSessions = new Map();

// Track session history for resume: sessionId -> { path, name, endedAt }
// Kept even after session ends so we can resume with correct path
// Persisted to disk so it survives agent restarts
const MAX_SESSION_HISTORY = 100;
const sessionHistory = loadSessionHistoryFromDisk();

// Track sessions being intentionally stopped (to distinguish from unexpected disconnects)
const stoppingSessions = new Set();

// Load session history from disk on startup
function loadSessionHistoryFromDisk() {
  try {
    if (fs.existsSync(SESSION_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_HISTORY_FILE, 'utf8'));
      const map = new Map();
      const cutoffTime = Date.now() - (MAX_SESSION_HISTORY_AGE_DAYS * 24 * 60 * 60 * 1000);

      // Filter out entries older than MAX_SESSION_HISTORY_AGE_DAYS
      for (const [sessionId, info] of Object.entries(data)) {
        if (new Date(info.endedAt).getTime() >= cutoffTime) {
          map.set(sessionId, info);
        }
      }

      console.log(`[vibe-agent] Loaded ${map.size} sessions from history`);
      return map;
    }
  } catch (err) {
    console.log(`[vibe-agent] Failed to load session history: ${err.message}`);
  }
  return new Map();
}

// Save session history to disk
function saveSessionHistoryToDisk() {
  try {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const data = Object.fromEntries(sessionHistory);
    fs.writeFileSync(SESSION_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`[vibe-agent] Failed to save session history: ${err.message}`);
  }
}

// Local server for vibe-cli connections
let localServer = null;
// Track local CLI connections: ws -> { sessionId, authenticated }
const localClients = new Map();

// ====================
// WebSocket Connection
// ====================

function connect() {
  // Bridge URL should always be set (defaults to DEFAULT_BRIDGE_URL)
  if (!bridgeUrl) {
    log('No bridge URL configured (this should not happen)', colors.red);
    process.exit(1);
  }

  log(`Connecting to ${bridgeUrl}...`, colors.cyan);

  try {
    ws = new WebSocket(bridgeUrl);
  } catch (err) {
    log(`Failed to create WebSocket: ${err.message}`, colors.red);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    log('Connected to bridge', colors.green);
    clearTimeout(reconnectTimer);

    // Authenticate (auth is required, so this should always be true)
    if (authToken) {
      send({ type: 'authenticate', token: authToken });
    } else {
      // Failsafe - should not reach here due to startup check
      showWelcomeMessage();
      process.exit(1);
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      log(`Failed to parse message: ${err.message}`, colors.red);
    }
  });

  ws.on('close', () => {
    log('Disconnected from bridge', colors.yellow);
    isAuthenticated = false;
    stopHeartbeat();

    // Notify all local clients that bridge is disconnected
    for (const [clientWs, clientInfo] of localClients) {
      try {
        clientWs.send(JSON.stringify({
          type: 'bridge_disconnected',
          message: 'Bridge connection lost, reconnecting...'
        }));
      } catch (err) {
        // Client may already be closed
      }
    }

    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, colors.red);
  });
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  log(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`, colors.dim);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ type: 'agent_heartbeat' });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ====================
// Local Server (for vibe-cli connections)
// ====================

function startLocalServer() {
  try {
    localServer = new WebSocketServer({ port: LOCAL_SERVER_PORT });

    localServer.on('listening', () => {
      log(`Local server listening on port ${LOCAL_SERVER_PORT}`, colors.green);
      // Write port file for auto-discovery
      try {
        fs.writeFileSync(PORT_FILE, LOCAL_SERVER_PORT.toString(), 'utf8');
      } catch (err) {
        // Ignore
      }
    });

    localServer.on('connection', (clientWs) => {
      log('Local vibe-cli connected', colors.cyan);

      localClients.set(clientWs, {
        sessionId: null,
        authenticated: false
      });

      clientWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleLocalMessage(clientWs, msg);
        } catch (err) {
          log(`Failed to parse local message: ${err.message}`, colors.red);
        }
      });

      clientWs.on('close', () => {
        const clientInfo = localClients.get(clientWs);
        if (clientInfo?.sessionId) {
          const sessionId = clientInfo.sessionId;

          // Check if this is an attached client (not the session owner)
          if (clientInfo.isAttached) {
            const session = runningSessions.get(sessionId);
            if (session?.attachedClients) {
              session.attachedClients.delete(clientWs);
              log(`Attached client disconnected from session ${sessionId.slice(0, 8)}`, colors.dim);
            }
          } else {
            // This is the session owner - end the session
            const wasIntentionalStop = stoppingSessions.has(sessionId);
            stoppingSessions.delete(sessionId);  // Clean up

            log(`Local session ${sessionId.slice(0, 8)} ${wasIntentionalStop ? 'stopped' : 'disconnected'}`, colors.dim);
            // Save to history before deleting for resume capability
            const session = runningSessions.get(sessionId);
            if (session) {
              saveSessionHistory(sessionId, session.path, session.name);
              // Notify attached clients that session ended
              if (session.attachedClients) {
                for (const attachedWs of session.attachedClients) {
                  try {
                    attachedWs.send(JSON.stringify({
                      type: 'session_ended',
                      sessionId,
                      reason: wasIntentionalStop ? 'stopped_by_user' : 'disconnected'
                    }));
                  } catch (err) {
                    // Ignore
                  }
                }
              }
            }
            runningSessions.delete(sessionId);
            // Notify bridge
            send({
              type: 'agent_session_ended',
              sessionId: sessionId,
              exitCode: 0,
              reason: wasIntentionalStop ? 'stopped_by_user' : 'disconnected'
            });
          }
        }
        localClients.delete(clientWs);
      });

      clientWs.on('error', (err) => {
        log(`Local client error: ${err.message}`, colors.red);
      });
    });

    localServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log(`Port ${LOCAL_SERVER_PORT} in use - another agent running?`, colors.red);
      } else {
        log(`Local server error: ${err.message}`, colors.red);
      }
    });

  } catch (err) {
    log(`Failed to start local server: ${err.message}`, colors.red);
  }
}

function stopLocalServer() {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
  // Remove port file
  try {
    if (fs.existsSync(PORT_FILE)) {
      fs.unlinkSync(PORT_FILE);
    }
  } catch (err) {
    // Ignore
  }
}

function handleLocalMessage(clientWs, msg) {
  const clientInfo = localClients.get(clientWs);

  switch (msg.type) {
    // Authentication: local clients inherit agent's auth
    case 'authenticate':
      // Local clients don't need to re-authenticate - they inherit agent's session
      clientInfo.authenticated = true;
      clientWs.send(JSON.stringify({
        type: 'authenticated',
        userId: 'local',
        email: 'via-agent'
      }));
      break;

    // Session registration: track locally and relay to bridge
    case 'register_session':
      const sessionId = msg.sessionId;
      clientInfo.sessionId = sessionId;

      // Track this session as managed by agent
      runningSessions.set(sessionId, {
        localWs: clientWs,
        path: msg.path || process.cwd(),
        name: msg.name || path.basename(msg.path || process.cwd()),
        startedAt: new Date().toISOString(),
        managed: true,  // Indicates connected via local server, not spawned
        attachedClients: new Set()  // Track attached terminal clients
      });

      log(`Local session registered: ${sessionId.slice(0, 8)} (${msg.name || msg.path})`, colors.green);

      // Check if agent is authenticated (has agentId)
      if (!agentId) {
        log('Warning: Agent not authenticated yet, session will not be managed', colors.yellow);
      }

      // Relay to bridge with agentId so bridge knows this session is managed
      const registrationMsg = {
        ...msg,
        agentId: agentId || null,  // null if not yet authenticated
        agentHostName: agentId ? hostName : null
      };
      if (send(registrationMsg)) {
        // Bridge will respond with session_registered
      } else {
        clientWs.send(JSON.stringify({
          type: 'error',
          message: 'Not connected to bridge'
        }));
      }
      break;

    // Attach to existing session (terminal mirroring)
    case 'attach_session':
      const attachSessionId = msg.sessionId;

      // Validate sessionId
      if (!attachSessionId) {
        clientWs.send(JSON.stringify({
          type: 'attach_error',
          error: 'sessionId is required'
        }));
        break;
      }

      // Check if session is stopping
      if (stoppingSessions.has(attachSessionId)) {
        log(`Attach failed: session ${attachSessionId.slice(0, 8)} is stopping`, colors.yellow);
        clientWs.send(JSON.stringify({
          type: 'attach_error',
          sessionId: attachSessionId,
          error: 'Session is currently stopping. Cannot attach.'
        }));
        break;
      }

      const session = runningSessions.get(attachSessionId);

      if (!session) {
        log(`Attach failed: session ${attachSessionId.slice(0, 8)} not found`, colors.red);
        clientWs.send(JSON.stringify({
          type: 'attach_error',
          sessionId: attachSessionId,
          error: 'Session not found. It may have ended or is running on a different agent.'
        }));
        break;
      }

      // Mark this client as attached to the session
      clientInfo.sessionId = attachSessionId;
      clientInfo.isAttached = true;

      // Add to session's attached clients
      if (!session.attachedClients) {
        session.attachedClients = new Set();
      }
      session.attachedClients.add(clientWs);

      log(`Client attached to session ${attachSessionId.slice(0, 8)} (${session.attachedClients.size} attached)`, colors.cyan);

      clientWs.send(JSON.stringify({
        type: 'attach_success',
        sessionId: attachSessionId,
        name: session.name,
        path: session.path
      }));
      break;

    // List running sessions
    case 'list_sessions':
      const sessionsList = [];
      for (const [sessionId, session] of runningSessions) {
        // Determine source: spawned sessions have 'process', managed have 'localWs'
        // Sessions started from iOS come via bridge with spawn, sessions from CLI use --agent
        const source = session.process ? 'ios' : 'cli';
        sessionsList.push({
          sessionId,
          name: session.name,
          path: session.path,
          startedAt: session.startedAt,
          source
        });
      }
      clientWs.send(JSON.stringify({
        type: 'sessions_list',
        sessions: sessionsList
      }));
      log(`Listed ${sessionsList.length} running sessions`, colors.dim);
      break;

    // Terminal input from attached client - forward to session provider
    case 'terminal_input':
      const targetSession = runningSessions.get(clientInfo.sessionId);
      if (targetSession && targetSession.localWs && clientInfo.isAttached) {
        // Forward input to the session's provider (the original vibe-cli)
        try {
          targetSession.localWs.send(JSON.stringify({
            type: 'terminal_input',
            data: msg.data
          }));
        } catch (err) {
          log(`Failed to forward terminal input: ${err.message}`, colors.red);
        }
      }
      break;

    // Terminal output from session provider - relay to attached clients
    case 'terminal_output':
      const outputSession = runningSessions.get(clientInfo.sessionId);
      if (outputSession?.attachedClients) {
        for (const attachedWs of outputSession.attachedClients) {
          try {
            attachedWs.send(JSON.stringify(msg));
          } catch (err) {
            // Ignore send errors
          }
        }
      }
      break;

    // All other messages: relay to bridge and also to attached clients
    default:
      // Add sessionId if not present
      if (!msg.sessionId && clientInfo.sessionId) {
        msg.sessionId = clientInfo.sessionId;
      }

      // Relay certain message types to attached clients for terminal mirroring
      if (['claude_message', 'permission_request', 'session_status'].includes(msg.type)) {
        const msgSession = runningSessions.get(clientInfo.sessionId);
        if (msgSession?.attachedClients) {
          for (const attachedWs of msgSession.attachedClients) {
            try {
              attachedWs.send(JSON.stringify(msg));
            } catch (err) {
              // Ignore send errors
            }
          }
        }
      }

      if (send(msg)) {
        // Message relayed successfully
      } else {
        clientWs.send(JSON.stringify({
          type: 'error',
          message: 'Not connected to bridge'
        }));
      }
      break;
  }
}

// Relay bridge messages to appropriate local client
function relayToLocalClient(msg) {
  const sessionId = msg.sessionId;
  if (!sessionId) return false;

  const session = runningSessions.get(sessionId);
  if (!session?.localWs) return false;

  try {
    session.localWs.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    log(`Failed to relay to local client: ${err.message}`, colors.red);
    return false;
  }
}

// ====================
// Message Handling
// ====================

function handleMessage(msg) {
  switch (msg.type) {
    case 'authenticated':
      isAuthenticated = true;
      log(`Authenticated as ${msg.email || msg.userId}`, colors.green);

      // Register as an agent
      if (!agentId) {
        agentId = uuidv4();
        // Persist agentId so it survives restarts
        const config = loadConfig();
        config.agentId = agentId;
        saveConfig(config);
        log(`Generated new agent ID: ${agentId.slice(0, 8)}...`, colors.dim);
      }
      send({
        type: 'agent_register',
        agentId,
        hostName,
        platform: process.platform,
        activeSessions: Array.from(runningSessions.keys())
      });
      startHeartbeat();

      // Re-register all sessions with bridge after reconnect
      for (const [sessionId, session] of runningSessions) {
        log(`Re-registering session: ${sessionId.slice(0, 8)} (${session.managed ? 'managed' : 'spawned'})`, colors.dim);
        send({
          type: 'register_session',
          sessionId,
          path: session.path,
          name: session.name,
          agentId: agentId,
          agentHostName: hostName
        });
      }

      // Notify local clients that bridge is reconnected
      for (const [clientWs, clientInfo] of localClients) {
        try {
          clientWs.send(JSON.stringify({
            type: 'bridge_reconnected',
            message: 'Bridge connection restored'
          }));
        } catch (err) {
          // Client may already be closed
        }
      }
      break;

    case 'auth_error':
      isAuthenticated = false;
      log(`Authentication failed: ${msg.message}`, colors.yellow);

      // Try to refresh token
      (async () => {
        const newToken = await refreshIdToken();
        if (newToken) {
          authToken = newToken;
          send({ type: 'authenticate', token: newToken });
        } else {
          log('Please re-login: vibe-agent --login', colors.red);
        }
      })();
      break;

    case 'agent_registered':
      log(`Agent registered: ${msg.agentId}`, colors.green);
      log(`Host: ${hostName}`, colors.dim);
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
        sessions: Array.from(runningSessions.entries()).map(([id, s]) => ({
          sessionId: id,
          path: s.path,
          name: s.name,
          status: 'active'
        }))
      });
      break;

    case 'error':
      log(`Bridge error: ${msg.message}`, colors.red);
      // Relay errors to local client if applicable
      relayToLocalClient(msg);
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
      // These are responses/events for local sessions - relay them
      relayToLocalClient(msg);
      break;

    default:
      // Try to relay unknown messages to local client
      if (msg.sessionId) {
        relayToLocalClient(msg);
      }
      break;
  }
}

// ====================
// Session Management
// ====================

function findVibeCli() {
  // Look for vibe.js in common locations
  const locations = [
    path.join(__dirname, '..', 'vibe-cli', 'vibe.js'),
    path.join(os.homedir(), 'vibe-cli', 'vibe.js'),
  ];

  // Add platform-specific locations
  if (process.platform === 'win32') {
    locations.push(path.join(os.homedir(), 'AppData', 'Local', 'vibe-cli', 'vibe.js'));
  } else {
    locations.push('/usr/local/bin/vibe');
  }

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  // Try to find via which/where
  try {
    const cmd = process.platform === 'win32' ? 'where vibe' : 'which vibe';
    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    // 'where' on Windows can return multiple lines, take the first
    return result.split('\n')[0].trim();
  } catch {
    return null;
  }
}

// Save session info to history for resume capability
function saveSessionHistory(sessionId, sessionPath, sessionName) {
  // Limit history size
  if (sessionHistory.size >= MAX_SESSION_HISTORY) {
    // Delete oldest entry
    const oldest = sessionHistory.keys().next().value;
    sessionHistory.delete(oldest);
  }

  sessionHistory.set(sessionId, {
    path: sessionPath,
    name: sessionName,
    endedAt: new Date().toISOString()
  });

  // Persist to disk
  saveSessionHistoryToDisk();

  log(`Saved session ${sessionId.slice(0, 8)} to history (path: ${sessionPath})`, colors.dim);
}

// Get session info from history
function getSessionFromHistory(sessionId) {
  return sessionHistory.get(sessionId);
}

function handleStartSession(msg) {
  const { sessionId, path: projectPath, name, prompt, requestId } = msg;

  log(`Starting session: ${name || projectPath || 'new'}`, colors.cyan);

  const vibeCli = findVibeCli();
  if (!vibeCli) {
    log('vibe-cli not found!', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'vibe-cli not found on this host'
    });
    return;
  }

  // Build args - use --agent to connect via local server
  const args = ['--agent', `ws://localhost:${LOCAL_SERVER_PORT}`];

  if (name) {
    args.push('--name', name);
  }

  if (prompt) {
    args.push(prompt);
  }

  // Spawn vibe-cli - expand ~ to home directory
  let cwd = projectPath || os.homedir();
  if (cwd.startsWith('~')) {
    cwd = cwd.replace(/^~/, os.homedir());
  }

  // Validate path exists
  if (!fs.existsSync(cwd)) {
    log(`Path does not exist: ${cwd}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: `Path does not exist: ${cwd}`
    });
    return;
  }

  log(`Spawning: node ${vibeCli} ${args.join(' ')}`, colors.dim);
  log(`Working directory: ${cwd}`, colors.dim);

  try {
    const proc = spawn('node', [vibeCli, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    const newSessionId = sessionId || uuidv4();

    runningSessions.set(newSessionId, {
      process: proc,
      path: cwd,
      name: name || path.basename(cwd),
      startedAt: new Date().toISOString(),
      attachedClients: new Set()  // Support terminal attachment
    });

    proc.stdout.on('data', (data) => {
      // Log output for debugging
      const output = data.toString().trim();
      if (output) {
        log(`[${newSessionId.slice(0, 8)}] ${output}`, colors.dim);
      }
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log(`[${newSessionId.slice(0, 8)}] ${output}`, colors.yellow);
      }
    });

    proc.on('exit', (code) => {
      log(`Session ${newSessionId.slice(0, 8)} exited with code ${code}`, colors.dim);
      // Save to history before deleting for resume capability
      const session = runningSessions.get(newSessionId);
      if (session) {
        saveSessionHistory(newSessionId, session.path, session.name);
      }
      runningSessions.delete(newSessionId);

      send({
        type: 'agent_session_ended',
        sessionId: newSessionId,
        exitCode: code
      });
    });

    proc.on('error', (err) => {
      log(`Session error: ${err.message}`, colors.red);
      // Save to history before deleting for resume capability
      const session = runningSessions.get(newSessionId);
      if (session) {
        saveSessionHistory(newSessionId, session.path, session.name);
      }
      runningSessions.delete(newSessionId);

      send({
        type: 'agent_session_error',
        requestId,
        sessionId: newSessionId,
        error: err.message
      });
    });

    // Notify bridge that session started
    send({
      type: 'agent_session_started',
      requestId,
      sessionId: newSessionId,
      path: cwd,
      name: name || path.basename(cwd)
    });

    log(`Session started: ${newSessionId.slice(0, 8)}`, colors.green);

  } catch (err) {
    log(`Failed to start session: ${err.message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: err.message
    });
  }
}

function handleResumeSession(msg) {
  const { sessionId, path: projectPath, name, requestId } = msg;

  // Validate sessionId is present
  if (!sessionId) {
    log('Resume session called without sessionId', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      error: 'sessionId is required to resume a session'
    });
    return;
  }

  log(`Resuming session: ${sessionId.slice(0, 8)}`, colors.cyan);

  // Check if already running
  if (runningSessions.has(sessionId)) {
    log('Session is already running', colors.yellow);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session is already running'
    });
    return;
  }

  // Check if session is currently being stopped
  if (stoppingSessions.has(sessionId)) {
    log('Session is currently stopping', colors.yellow);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session is currently stopping. Please wait a moment and try again.'
    });
    return;
  }

  const vibeCli = findVibeCli();
  if (!vibeCli) {
    log('vibe-cli not found!', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'vibe-cli not found on this host'
    });
    return;
  }

  // Build args with --resume - use --agent to connect via local server
  const args = ['--agent', `ws://localhost:${LOCAL_SERVER_PORT}`, '--resume', sessionId];

  // Try to get session info from history if path not provided
  let effectivePath = projectPath;
  let effectiveName = name;

  if (!effectivePath) {
    const historyEntry = getSessionFromHistory(sessionId);
    if (historyEntry) {
      effectivePath = historyEntry.path;
      effectiveName = effectiveName || historyEntry.name;
      log(`Using path from session history: ${effectivePath}`, colors.dim);
    }
  }

  // Don't silently fall back to home directory - require a valid path
  if (!effectivePath) {
    log(`Cannot resume session ${sessionId.slice(0, 8)}: path unknown`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Cannot resume session: working directory path unknown. The session may have been created before path tracking was enabled, or the agent was restarted.'
    });
    return;
  }

  if (effectiveName) {
    args.push('--name', effectiveName);
  }

  // Spawn vibe-cli with resume - expand ~ to home directory
  let cwd = effectivePath;
  if (cwd.startsWith('~')) {
    cwd = cwd.replace(/^~/, os.homedir());
  }

  // Validate path exists
  if (!fs.existsSync(cwd)) {
    log(`Path does not exist: ${cwd}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: `Path does not exist: ${cwd}`
    });
    return;
  }

  log(`Spawning: node ${vibeCli} ${args.join(' ')}`, colors.dim);

  try {
    const proc = spawn('node', [vibeCli, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    runningSessions.set(sessionId, {
      process: proc,
      path: cwd,
      name: effectiveName || path.basename(cwd),
      startedAt: new Date().toISOString(),
      attachedClients: new Set()  // Support terminal attachment
    });

    proc.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log(`[${sessionId.slice(0, 8)}] ${output}`, colors.dim);
      }
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log(`[${sessionId.slice(0, 8)}] ${output}`, colors.yellow);
      }
    });

    proc.on('exit', (code) => {
      log(`Session ${sessionId.slice(0, 8)} exited with code ${code}`, colors.dim);
      // Save to history before deleting for resume capability
      const session = runningSessions.get(sessionId);
      if (session) {
        saveSessionHistory(sessionId, session.path, session.name);
      }
      runningSessions.delete(sessionId);

      send({
        type: 'agent_session_ended',
        sessionId,
        exitCode: code
      });
    });

    proc.on('error', (err) => {
      log(`Session error: ${err.message}`, colors.red);
      // Save to history before deleting for resume capability
      const session = runningSessions.get(sessionId);
      if (session) {
        saveSessionHistory(sessionId, session.path, session.name);
      }
      runningSessions.delete(sessionId);

      send({
        type: 'agent_session_error',
        requestId,
        sessionId,
        error: err.message
      });
    });

    // Notify bridge
    send({
      type: 'agent_session_resumed',
      requestId,
      sessionId,
      path: cwd,
      name: effectiveName || path.basename(cwd)
    });

    log(`Session resumed: ${sessionId.slice(0, 8)}`, colors.green);

  } catch (err) {
    log(`Failed to resume session: ${err.message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: err.message
    });
  }
}

function handleStopSession(msg) {
  const { sessionId, requestId } = msg;

  const session = runningSessions.get(sessionId);
  if (!session) {
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session not found'
    });
    return;
  }

  log(`Stopping session: ${sessionId.slice(0, 8)}`, colors.yellow);

  try {
    if (session.process) {
      // Spawned session - kill the process
      // On Windows, kill() without signal terminates the process
      // On Unix, SIGTERM is the graceful termination signal
      if (process.platform === 'win32') {
        session.process.kill();
      } else {
        session.process.kill('SIGTERM');

        // Force kill after timeout (Unix only, Windows kill() is already forceful)
        setTimeout(() => {
          if (runningSessions.has(sessionId) && session.process) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } else if (session.localWs) {
      // Managed session (connected via --agent) - send stop command first
      // This tells vibe-cli to NOT reconnect after disconnect
      stoppingSessions.add(sessionId);  // Track intentional stop
      try {
        session.localWs.send(JSON.stringify({
          type: 'session_stop',
          sessionId,
          reason: 'stopped_by_user'
        }));
      } catch (err) {
        // Ignore send errors
      }
      // Give vibe-cli time to process the stop message before closing
      setTimeout(() => {
        try {
          session.localWs.close(1000, 'Stopped by agent');
        } catch (err) {
          // Already closed
        }
        // Cleanup stoppingSessions as backup in case websocket close event doesn't fire
        setTimeout(() => {
          stoppingSessions.delete(sessionId);
        }, 5000);
      }, 100);
      runningSessions.delete(sessionId);
    }

    send({
      type: 'agent_session_stopping',
      requestId,
      sessionId
    });
  } catch (err) {
    log(`Failed to stop session: ${err.message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: err.message
    });
  }
}

// ====================
// Headless Login
// ====================

async function startHeadlessLogin(bridgeHttpUrl) {
  console.log(`
${colors.cyan}${colors.bold}vibe-agent Headless Login${colors.reset}
${'='.repeat(40)}
`);

  try {
    log('Requesting device code...', colors.dim);
    const codeRes = await fetch(`${bridgeHttpUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!codeRes.ok) {
      log(`Failed to get device code: ${codeRes.status}`, colors.red);
      process.exit(1);
    }

    const { deviceId, code, expiresIn } = await codeRes.json();

    console.log(`   Visit:  ${PAIRING_URL}`);
    console.log(`   Code:   ${colors.bold}${code}${colors.reset}`);
    console.log('');
    console.log(`   Code expires in ${Math.floor(expiresIn / 60)} minutes.`);
    console.log('   Waiting for authentication...');
    console.log('');

    // Poll for token
    const pollInterval = 3000;
    const maxAttempts = Math.ceil((expiresIn * 1000) / pollInterval);

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const pollRes = await fetch(`${bridgeHttpUrl}/device/poll/${deviceId}`);
        const pollData = await pollRes.json();

        if (pollData.status === 'complete') {
          saveAuth(pollData.token, pollData.refreshToken || null);
          console.log('');
          log(`Logged in as ${pollData.email}`, colors.green);
          log(`Auth saved to ${AUTH_FILE}`, colors.dim);
          if (pollData.refreshToken) {
            log('Token auto-refresh enabled', colors.dim);
          }
          process.exit(0);
        } else if (pollRes.status === 404 || pollData.error === 'Device not found or expired') {
          console.log('\n\nCode expired. Please try again.');
          process.exit(1);
        }

        process.stdout.write('.');
      } catch (err) {
        process.stdout.write('!');
      }
    }

    console.log('\n\nLogin timed out.');
    process.exit(1);

  } catch (err) {
    log(`Login failed: ${err.message}`, colors.red);
    process.exit(1);
  }
}

// ====================
// CLI Argument Parsing
// ====================

function printHelp() {
  console.log(`
${colors.cyan}${colors.bold}vibe-agent${colors.reset} - Persistent daemon for remote Claude Code sessions

${colors.bold}Usage:${colors.reset}
  vibe-agent                Start agent daemon
  vibe-agent --login        Sign in with Google (one-time)
  vibe-agent --logout       Sign out and clear credentials
  vibe-agent --status       Show agent status

${colors.bold}Options:${colors.reset}
  --login           Sign in via device code flow
  --logout          Sign out and clear saved credentials
  --name <name>     Set host display name
  --status          Show current status and exit
  --help, -h        Show this help

${colors.bold}Advanced:${colors.reset}
  --bridge <url>    Override bridge URL (default: wss://ws.minivibeapp.com)
  --token <token>   Use specific Firebase token

${colors.bold}Examples:${colors.reset}
  vibe-agent --login        Sign in (one-time setup)
  vibe-agent                Start agent
  vibe-agent --name "EC2"   Start with custom name
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    bridge: null,
    token: null,
    login: false,
    logout: false,
    name: null,
    status: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--bridge':
        options.bridge = args[++i];
        break;
      case '--token':
        options.token = args[++i];
        break;
      case '--login':
        options.login = true;
        break;
      case '--logout':
        options.logout = true;
        break;
      case '--name':
        options.name = args[++i];
        break;
      case '--status':
        options.status = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

// ====================
// Main
// ====================

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Load saved config
  const config = loadConfig();

  bridgeUrl = options.bridge || config.bridgeUrl || DEFAULT_BRIDGE_URL;
  hostName = options.name || config.hostName || os.hostname();
  agentId = config.agentId || null;  // Load persisted agentId

  if (options.token) {
    authToken = options.token;
    saveAuth(authToken);
  } else {
    const auth = loadAuth();
    authToken = auth?.idToken;
  }

  // Save config for next time
  if (options.bridge) {
    config.bridgeUrl = bridgeUrl;
  }
  if (options.name) {
    config.hostName = hostName;
  }
  saveConfig(config);

  // Status check
  if (options.status) {
    console.log(`Bridge URL: ${bridgeUrl}`);
    console.log(`Host Name:  ${hostName}`);
    console.log(`Auth Token: ${authToken ? 'Configured' : 'Not configured'}`);
    console.log(`Agent ID:   ${agentId || 'Will be assigned on first connect'}`);
    process.exit(0);
  }

  // Logout flow
  if (options.logout) {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        fs.unlinkSync(AUTH_FILE);
        log('Logged out successfully', colors.green);
      } else {
        log('Not logged in', colors.yellow);
      }
    } catch (err) {
      log(`Logout failed: ${err.message}`, colors.red);
    }
    process.exit(0);
  }

  // Login flow
  if (options.login) {
    const httpUrl = bridgeUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    await startHeadlessLogin(httpUrl);
    return;
  }

  // Require auth (block instead of warn)
  if (!authToken) {
    showWelcomeMessage();
    process.exit(1);
  }

  // Banner
  console.log(`
${colors.cyan}${colors.bold}vibe-agent${colors.reset}
${'='.repeat(40)}
   Host:   ${hostName}
   Bridge: ${bridgeUrl}
   Local:  ws://localhost:${LOCAL_SERVER_PORT}
   Auth:   ${authToken ? 'Configured' : 'Not configured'}
${'='.repeat(40)}
`);

  // Start local server for vibe-cli connections
  startLocalServer();

  // Connect to bridge
  connect();

  // Handle shutdown (SIGINT works on both Unix and Windows for Ctrl+C)
  const shutdown = () => {
    log('Shutting down...', colors.yellow);

    // Stop all sessions (both spawned and managed)
    for (const [sessionId, session] of runningSessions) {
      log(`Stopping session ${sessionId.slice(0, 8)}`, colors.dim);
      if (session.process) {
        try {
          // On Windows, kill() without signal terminates the process
          // On Unix, SIGTERM is the graceful termination signal
          if (process.platform === 'win32') {
            session.process.kill();
          } else {
            session.process.kill('SIGTERM');
          }
        } catch (err) {
          // Ignore
        }
      } else if (session.localWs) {
        try {
          session.localWs.close(1001, 'Agent shutting down');
        } catch (err) {
          // Ignore
        }
      }
    }

    // Stop local server (closes remaining client connections)
    stopLocalServer();

    if (ws) {
      ws.close();
    }

    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', shutdown);

  // SIGTERM only exists on Unix
  if (process.platform !== 'win32') {
    process.on('SIGTERM', shutdown);
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, colors.red);
  process.exit(1);
});
