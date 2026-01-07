#!/usr/bin/env node

/**
 * vibe-cli - Claude Code wrapper with mobile remote control
 *
 * Usage:
 *   vibe "your prompt here"          Start new session with prompt
 *   vibe --bridge ws://server:8080   Connect to bridge server (for internet access)
 *   vibe --resume <id>               Resume existing session
 *   vibe                             Start interactive session
 */

const { spawn, execSync, exec } = require('child_process');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const e2e = require('./e2e');

// Check if Claude Code is installed
function checkClaudeInstalled() {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Show welcome message for first-time users (no auth)
function showWelcomeMessage() {
  console.log(`
Welcome to MiniVibe!

MiniVibe lets you control Claude Code from your iPhone.

To get started:
  1. Download MiniVibe from the App Store
  2. Run: vibe --login

For help: vibe --help
`);
}

// Show error when Claude Code is not installed
function showClaudeNotFoundMessage() {
  console.log(`
Claude Code not found

MiniVibe requires Claude Code CLI to be installed.

Install Claude Code:
  https://claude.ai/download

After installing, run:
  vibe --login
`);
}

// Default bridge URL
const DEFAULT_BRIDGE_URL = 'wss://ws.minivibeapp.com';

// Find claude executable
function findClaudePath() {
  try {
    // Use 'where' on Windows, 'which' on Unix
    const cmd = os.platform() === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    // 'where' on Windows can return multiple lines, take the first
    return result.split('\n')[0].trim();
  } catch {
    // Fallback paths
    if (os.platform() === 'win32') {
      // Common Windows install locations
      const userPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe');
      if (fs.existsSync(userPath)) return userPath;
      return 'claude';  // Hope it's in PATH
    }
    return '/opt/homebrew/bin/claude';
  }
}

// Token storage
const TOKEN_FILE = path.join(os.homedir(), '.vibe', 'token');
const AUTH_FILE = path.join(os.homedir(), '.vibe', 'auth.json');

// Firebase web config (public - safe to embed in client code)
// Update these values from: Firebase Console → Project Settings → Web App
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAJKYavMidKYxRpfhP2IHUiy8dafc3ISqc",
  authDomain: "minivibe-adaf4.firebaseapp.com",
  projectId: "minivibe-adaf4",
  storageBucket: "minivibe-adaf4.firebasestorage.app",
  messagingSenderId: "11868121436",
  appId: "1:11868121436:web:fa1a4941e6b222bc59b999",
  measurementId: "G-29YEJLRVDS"
};

// Discover local vibe-agent
const AGENT_PORT_FILE = path.join(os.homedir(), '.vibe-agent', 'port');
const DEFAULT_AGENT_URL = 'ws://localhost:9999';

function discoverLocalAgent() {
  // Try to read port file from vibe-agent
  try {
    if (fs.existsSync(AGENT_PORT_FILE)) {
      const port = fs.readFileSync(AGENT_PORT_FILE, 'utf8').trim();
      return `ws://localhost:${port}`;
    }
  } catch (err) {
    // Ignore
  }
  // Fall back to default
  return DEFAULT_AGENT_URL;
}

// Get stored auth data (token + refresh token)
function getStoredAuth() {
  try {
    // Try new JSON format first
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      return data;
    }
    // Fall back to old token-only format
    if (fs.existsSync(TOKEN_FILE)) {
      return { idToken: fs.readFileSync(TOKEN_FILE, 'utf8').trim() };
    }
  } catch (err) {
    // Ignore
  }
  return null;
}

function getStoredToken() {
  const auth = getStoredAuth();
  return auth?.idToken || null;
}

// Store auth data (token + refresh token)
function storeAuth(idToken, refreshToken = null) {
  try {
    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = { idToken, refreshToken, updatedAt: new Date().toISOString() };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
    fs.chmodSync(AUTH_FILE, 0o600); // Only user can read
    // Also write to old token file for backwards compatibility
    fs.writeFileSync(TOKEN_FILE, idToken, 'utf8');
    fs.chmodSync(TOKEN_FILE, 0o600);
    return true;
  } catch (err) {
    console.error(`Failed to store auth: ${err.message}`);
    return false;
  }
}

// Legacy function for backwards compatibility
function storeToken(token) {
  return storeAuth(token, null);
}

// Refresh the ID token using Firebase REST API
async function refreshIdToken() {
  const auth = getStoredAuth();
  if (!auth?.refreshToken) {
    logStatus('No refresh token available');
    return null;
  }

  try {
    logStatus('Refreshing authentication token...');
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
      logStatus(`Token refresh failed: ${error.error?.message || response.status}`);
      return null;
    }

    const data = await response.json();
    // Store new tokens
    storeAuth(data.id_token, data.refresh_token);
    log('✅ Token refreshed successfully', colors.green);
    return data.id_token;
  } catch (err) {
    logStatus(`Token refresh error: ${err.message}`);
    return null;
  }
}

// Browser-based login - uses device code flow with public URL
async function startLoginFlow(openBrowser = true) {
  // Convert WebSocket URL to HTTP for API calls
  const bridgeHttpUrl = DEFAULT_BRIDGE_URL
    .replace('wss://', 'https://')
    .replace('ws://', 'http://');

  console.log(`
🔐 Login
══════════════════════════════════════
`);

  try {
    // Request a device code from the bridge server
    console.log('Requesting device code...');
    const codeRes = await fetch(`${bridgeHttpUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!codeRes.ok) {
      console.error(`Failed to get device code: ${codeRes.status}`);
      process.exit(1);
    }

    const { deviceId, code, expiresIn } = await codeRes.json();
    const pairUrl = `${WEB_APP_URL}/pair`;

    console.log(`   Visit:  ${pairUrl}`);
    console.log(`   Code:   ${code}`);
    console.log('');
    console.log(`   Code expires in ${Math.floor(expiresIn / 60)} minutes.`);

    // Open browser if requested
    if (openBrowser) {
      console.log('   Opening browser...');
      if (process.platform === 'win32') {
        exec(`start "" "${pairUrl}"`);
      } else {
        const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${openCmd} ${pairUrl}`);
      }
    }

    console.log('   Waiting for authentication...');
    console.log('');
    console.log('   Press Ctrl+C to cancel.');
    console.log('');

    // Poll for token
    const pollInterval = 3000; // 3 seconds
    const maxAttempts = Math.ceil((expiresIn * 1000) / pollInterval);
    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;

      try {
        const pollRes = await fetch(`${bridgeHttpUrl}/device/poll/${deviceId}`);

        // Handle non-JSON responses gracefully
        const contentType = pollRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.error(`\nServer error: Invalid response format`);
            process.exit(1);
          }
          process.stdout.write('!');
          continue;
        }

        const pollData = await pollRes.json();
        consecutiveErrors = 0; // Reset on successful response

        if (pollData.status === 'complete') {
          console.log(''); // New line after dots
          storeAuth(pollData.token, pollData.refreshToken || null);
          console.log(`✅ Logged in as ${pollData.email}`);
          console.log(`   Auth saved to ${AUTH_FILE}`);
          if (pollData.refreshToken) {
            console.log(`   Token auto-refresh enabled`);
          }
          process.exit(0);
        } else if (pollRes.status === 404 || pollData.error === 'Device not found or expired') {
          console.log('\n\nCode expired. Please try again.');
          process.exit(1);
        } else if (pollData.error) {
          console.error(`\nError: ${pollData.error}`);
          process.exit(1);
        }
        // Still pending, continue polling
        process.stdout.write('.');
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`\nNetwork error: ${err.message}`);
          console.error('Please check your internet connection and try again.');
          process.exit(1);
        }
        // Temporary network error - show warning but continue
        process.stdout.write('!');
      }
    }

    console.log('\n\nLogin timed out. Please try again.');
    process.exit(1);
  } catch (err) {
    console.error(`Failed to start login: ${err.message}`);
    process.exit(1);
  }
}

// Production web app URL for device pairing
const WEB_APP_URL = 'https://minivibeapp.com';

// Headless device code login flow (no browser auto-open)
async function startHeadlessLogin() {
  // Use the same login flow but without opening browser
  await startLoginFlow(false);
}

// Parse arguments
const args = process.argv.slice(2);
let initialPrompt = null;
let resumeSessionId = null;
let bridgeUrl = null;
let agentUrl = null;  // Connect via local vibe-agent
let authToken = null;
let headlessMode = false;
let sessionName = null;
let useNodePty = os.platform() === 'win32';  // Auto-detect Windows, can be overridden
let skipPermissions = false;  // --dangerously-skip-permissions mode
let listSessions = false;    // --list mode: list running sessions
let remoteAttachMode = false;  // --remote with --bridge: pure remote control (no local Claude)
let e2eEnabled = false;  // --e2e mode: enable end-to-end encryption

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
vibe - Claude Code with mobile remote control

Usage:
  vibe                    Start session (connects to bridge)
  vibe "prompt"           Start with initial prompt
  vibe --login            Sign in with Google
  vibe --agent            Connect via local vibe-agent

Options:
  --login          Sign in via minivibeapp.com (opens browser)
  --headless       Use device code flow for servers (no browser)
  --agent [url]    Connect via local vibe-agent (default: auto-discover)
  --name <name>    Name this session (shown in mobile app)
  --resume <id>    Resume a previous session
  --e2e            Enable end-to-end encryption

Advanced:
  --bridge <url>   Override bridge URL (default: wss://ws.minivibeapp.com)
  --attach <id>    Attach to session via local agent (full terminal)
  --remote <id>    Remote control session via bridge (no local Claude needed)
  --list           List running sessions on local agent
  --token <token>  Set Firebase auth token manually
  --logout         Remove stored auth token
  --node-pty       Use Node.js PTY wrapper (required for Windows)
  --dangerously-skip-permissions   Auto-approve all tool executions
  --help, -h       Show this help message

Examples:
  vibe --login            Sign in (one-time setup)
  vibe                    Start session
  vibe "Fix the bug"      Start with prompt
  vibe --e2e              Enable encryption
  vibe --agent            Use local agent

For local-only use without remote control, run 'claude' directly.
`);
    process.exit(0);
  } else if (args[i] === '--headless') {
    headlessMode = true;
  } else if (args[i] === '--login') {
    // Defer login handling until we know if --headless is also present
    // Will be handled after the loop
  } else if (args[i] === '--bridge' && args[i + 1]) {
    bridgeUrl = args[i + 1];
    i++;
  } else if (args[i] === '--agent') {
    // Check if next arg is a URL or another flag
    if (args[i + 1] && !args[i + 1].startsWith('--')) {
      agentUrl = args[i + 1];
      i++;
    } else {
      // Auto-discover or use default
      agentUrl = discoverLocalAgent();
    }
  } else if (args[i] === '--name' && args[i + 1]) {
    sessionName = args[i + 1];
    i++;
  } else if (args[i] === '--resume' && args[i + 1]) {
    resumeSessionId = args[i + 1];
    i++;
  } else if (args[i] === '--attach' && args[i + 1]) {
    // --attach: LOCAL mode via local vibe-agent (full terminal passthrough)
    resumeSessionId = args[i + 1];
    // Auto-discover local agent
    if (!agentUrl) {
      agentUrl = discoverLocalAgent();
    }
    i++;
  } else if (args[i] === '--remote' && args[i + 1]) {
    // --remote: REMOTE mode via bridge (no local Claude needed)
    resumeSessionId = args[i + 1];
    remoteAttachMode = true;
    i++;
  } else if (args[i] === '--list') {
    listSessions = true;
    // Auto-discover agent if not specified
    if (!agentUrl) {
      agentUrl = discoverLocalAgent();
    }
  } else if (args[i] === '--token' && args[i + 1]) {
    authToken = args[i + 1];
    storeToken(authToken);
    console.log('Token stored successfully');
    i++;
  } else if (args[i] === '--logout') {
    let loggedOut = false;
    let errors = [];

    // Try to delete AUTH_FILE
    if (fs.existsSync(AUTH_FILE)) {
      try {
        fs.unlinkSync(AUTH_FILE);
        loggedOut = true;
      } catch (err) {
        errors.push(`auth.json: ${err.message}`);
      }
    }

    // Try to delete TOKEN_FILE regardless of first result
    if (fs.existsSync(TOKEN_FILE)) {
      try {
        fs.unlinkSync(TOKEN_FILE);
        loggedOut = true;
      } catch (err) {
        errors.push(`token: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      console.error('Logout partially failed:', errors.join(', '));
    } else if (loggedOut) {
      console.log('Logged out successfully');
    } else {
      console.log('Not logged in');
    }
    process.exit(0);
  } else if (args[i] === '--node-pty') {
    useNodePty = true;
  } else if (args[i] === '--dangerously-skip-permissions') {
    skipPermissions = true;
  } else if (args[i] === '--e2e') {
    e2eEnabled = true;
  } else if (!args[i].startsWith('--')) {
    initialPrompt = args[i];
  }
}

// Handle login after all args are parsed (so we know if --headless was set)
// Login mode is exclusive - don't start Claude
let loginMode = false;
if (args.includes('--login')) {
  loginMode = true;
  if (headlessMode) {
    startHeadlessLogin();
    // startHeadlessLogin is async and exits on its own
  } else {
    startLoginFlow();
    // startLoginFlow is async and exits on its own
  }
}

// Load stored token if not provided
if (!authToken) {
  authToken = getStoredToken();
}

// ====================
// Startup Checks
// ====================

// Skip checks if in login mode (already handled above)
if (!loginMode) {
  const isAgentMode = !!agentUrl || listSessions;

  // 1. --remote mode doesn't need local Claude (controls remote session)
  // 2. --list mode doesn't need local Claude (just queries agent)
  // 3. All other modes need Claude installed
  if (!remoteAttachMode && !listSessions && !checkClaudeInstalled()) {
    showClaudeNotFoundMessage();
    process.exit(1);
  }

  // 3. Check auth (unless agent mode - agent handles its own auth)
  if (!isAgentMode && !authToken) {
    showWelcomeMessage();
    process.exit(1);
  }

  // 4. Default to bridge URL when authenticated (and not in agent mode)
  if (!isAgentMode && !bridgeUrl && authToken) {
    bridgeUrl = DEFAULT_BRIDGE_URL;
  }

  // 5. --remote without --bridge: use default bridge
  if (remoteAttachMode && !bridgeUrl) {
    bridgeUrl = DEFAULT_BRIDGE_URL;
  }
}

// Initialize E2E encryption if enabled
// Track if E2E is pending (enabled but not yet established)
let e2ePending = false;

if (e2eEnabled) {
  console.log('\n[E2E] Initializing end-to-end encryption...');
  e2e.initE2E();

  // Try to load saved peer first
  if (!e2e.loadSavedPeer()) {
    // No saved peer - key exchange will happen automatically when both sides connect
    e2ePending = true;
    console.log('[E2E] No saved peer. Key exchange will happen automatically when iOS connects.');
  }
}

// Note: E2E key exchange now works automatically since bridge is defaulted when authenticated

// Session state
const sessionId = resumeSessionId || uuidv4();
let claudeProcess = null;
let isRunning = false;
let isShuttingDown = false;
let bridgeSocket = null;
let reconnectTimer = null;
let sessionFileWatcher = null;
let lastFileSize = 0;
let heartbeatTimer = null;
let isAuthenticated = false;
let pendingPermission = null;  // Track pending permission request { id, command, timestamp }
let lastApprovalTime = 0;      // Debounce rapid approvals
const completedToolIds = new Set();  // Track tool_use IDs that have tool_result (already executed)
const MAX_COMPLETED_TOOLS = 500;     // Limit Set size to prevent memory issues in long sessions
let lastCapturedPrompt = null;       // Last permission prompt captured from CLI output
const mobileMessageHashes = new Set();  // Track messages from mobile to avoid duplicate echo
const MAX_MOBILE_MESSAGES = 100;     // Limit Set size

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

// Log to stderr to avoid corrupting PTY terminal output
// Use this for async messages that may arrive while Claude is running
function logStderr(msg, color = '') {
  process.stderr.write(`${color}${msg}${colors.reset}\n`);
}

function logStatus(msg) {
  // Use stderr when Claude is running to avoid corrupting PTY output
  if (isRunning) {
    logStderr(`[vibe] ${msg}`, colors.dim);
  } else {
    log(`[vibe] ${msg}`, colors.dim);
  }
}

// Find and change to the correct directory for a session
// Returns true if found and changed, false otherwise
function findAndChangeToSessionDir(targetSessionId) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(projectsDir)) {
    return false;
  }

  try {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      const sessionFile = path.join(projectsDir, dir, `${targetSessionId}.jsonl`);
      if (fs.existsSync(sessionFile)) {
        // Found the session! Decode the directory name back to path
        // Directory name is path with '/' replaced by '-'
        // e.g., "-home-ubuntu-gitssh" -> "/home/ubuntu/gitssh"
        let originalPath;
        if (dir.startsWith('-')) {
          // Has leading dash, convert back: -home-ubuntu -> /home/ubuntu
          originalPath = dir.replace(/-/g, '/');
        } else {
          // No leading dash (relative path or Windows)
          originalPath = '/' + dir.replace(/-/g, '/');
        }

        // Verify the path exists
        if (fs.existsSync(originalPath)) {
          logStatus(`Found session in: ${originalPath}`);
          process.chdir(originalPath);
          return true;
        } else {
          // Try without leading slash (might be relative or different encoding)
          const altPath = dir.replace(/-/g, '/').replace(/^\//, '');
          if (fs.existsSync(altPath)) {
            logStatus(`Found session in: ${altPath}`);
            process.chdir(altPath);
            return true;
          }
          logStatus(`Session found but path doesn't exist: ${originalPath}`);
        }
      }
    }
  } catch (err) {
    logStatus(`Error scanning for session: ${err.message}`);
  }

  return false;
}

// Get Claude session file path
// Claude uses path with '/' replaced by '-' (not base64)
// But the exact format may vary - we try multiple strategies
function getSessionFilePath() {
  const cwd = process.cwd();
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  // Strategy 1: Direct replacement (e.g., /home/ubuntu -> -home-ubuntu)
  const directHash = cwd.replace(/\//g, '-');

  // Strategy 2: Without leading dash (e.g., home-ubuntu)
  const noLeadingDash = directHash.replace(/^-/, '');

  // Strategy 3: URL-safe encoding variations
  const candidates = [directHash, noLeadingDash];

  // Try to find existing directory that matches
  if (fs.existsSync(projectsDir)) {
    for (const candidate of candidates) {
      const candidateDir = path.join(projectsDir, candidate);
      if (fs.existsSync(candidateDir)) {
        return path.join(candidateDir, `${sessionId}.jsonl`);
      }
    }

    // Scan for session file in any project directory
    try {
      const dirs = fs.readdirSync(projectsDir);
      for (const dir of dirs) {
        const sessionFile = path.join(projectsDir, dir, `${sessionId}.jsonl`);
        if (fs.existsSync(sessionFile)) {
          return sessionFile;
        }
      }
    } catch (err) {
      // Ignore scan errors
    }
  }

  // Fall back to direct hash (will be created by Claude)
  return path.join(projectsDir, directHash, `${sessionId}.jsonl`);
}

// Cache for discovered session file path
let discoveredSessionFile = null;

// Get local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Safe write to Claude's stdin
function safeStdinWrite(data) {
  if (!claudeProcess || !isRunning || isShuttingDown) {
    return false;
  }
  try {
    if (claudeProcess.stdin && claudeProcess.stdin.writable) {
      claudeProcess.stdin.write(data);
      return true;
    }
    return false;
  } catch (err) {
    logStatus(`Failed to write to Claude: ${err.message}`);
    return false;
  }
}

// Send message to Claude (from bridge)
function sendToClaude(content, source = 'bridge') {
  if (!claudeProcess || !isRunning || isShuttingDown) {
    log('Claude is not running', colors.yellow);
    return false;
  }

  logStatus(`Sending message: "${content}"`);

  // Send text first
  const textBuffer = Buffer.from(content, 'utf8');
  if (!safeStdinWrite(textBuffer)) {
    return false;
  }

  // Send Enter key separately after a short delay
  // This mimics how a real keyboard sends input
  setTimeout(() => {
    if (!claudeProcess || !isRunning || isShuttingDown) return;

    const enterBuffer = Buffer.from('\r', 'utf8');
    logStatus(`Sending Enter (\\r = 0x0d)`);
    safeStdinWrite(enterBuffer);
  }, 100);

  if (source === 'mobile') {
    log(`📱 [mobile]: ${content}`, colors.cyan);
  }

  return true;
}

// ====================
// Bridge Connection
// ====================

function connectToBridge() {
  // Use agentUrl if set, otherwise bridgeUrl
  const targetUrl = agentUrl || bridgeUrl;
  if (!targetUrl) return;

  const isAgentMode = !!agentUrl;

  // Auth should already be checked in startup, but double-check here
  if (!isAgentMode && !authToken) {
    showWelcomeMessage();
    process.exit(1);
  }

  if (isAgentMode) {
    logStatus(`Connecting to local agent: ${targetUrl}`);
  } else {
    logStatus(`Connecting to bridge: ${targetUrl}`);
  }
  isAuthenticated = false;

  bridgeSocket = new WebSocket(targetUrl);

  bridgeSocket.on('open', () => {
    logStatus('Connected to bridge server');

    // Authenticate first
    if (authToken) {
      logStatus('Sending authentication...');
      bridgeSocket.send(JSON.stringify({
        type: 'authenticate',
        token: authToken
      }));
    } else {
      // No token - send a placeholder (will work if bridge is in dev mode)
      bridgeSocket.send(JSON.stringify({
        type: 'authenticate',
        token: 'dev-mode'
      }));
    }

    // Start heartbeat to keep connection alive
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
        bridgeSocket.ping();
      }
    }, 30000); // Ping every 30 seconds
  });

  bridgeSocket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleBridgeMessage(msg);
    } catch (err) {
      logStatus(`Invalid bridge message: ${err.message}`);
    }
  });

  bridgeSocket.on('close', () => {
    logStatus('Disconnected from bridge');
    bridgeSocket = null;

    // Stop heartbeat
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Reconnect if not shutting down
    if (!isShuttingDown) {
      logStatus('Reconnecting in 3 seconds...');
      reconnectTimer = setTimeout(connectToBridge, 3000);
    }
  });

  bridgeSocket.on('error', (err) => {
    if (isAgentMode && err.code === 'ECONNREFUSED') {
      // Agent not running - show helpful message
      console.log(`
Cannot connect to vibe-agent at ${targetUrl}

Make sure vibe-agent is running:
  vibe-agent --login   # First time
  vibe-agent           # Start daemon
`);
      process.exit(1);
    }
    logStatus(`Bridge connection error: ${err.message}`);
  });
}

function handleBridgeMessage(msg) {
  // Handle E2E key exchange
  // Use logStderr to avoid corrupting Claude's PTY terminal output (if Claude is running)
  if (msg.type === 'e2e_key_exchange') {
    if (e2eEnabled) {
      // Always use stderr since Claude is likely running
      logStderr(`[E2E] Received key exchange from peer: ${msg.deviceId || 'unknown'}`, colors.cyan);
      e2e.handleKeyExchange(msg);
      // Send our public key back if peer doesn't have it
      if (msg.needsResponse) {
        const keyExchangeMsg = e2e.createKeyExchangeMessage(false);  // false = we don't need response back
        // Include sessionId so bridge can route to the right viewers
        keyExchangeMsg.sessionId = sessionId;
        bridgeSocket.send(JSON.stringify(keyExchangeMsg));
        logStderr(`[E2E] Sent key exchange response (sessionId: ${sessionId?.slice(0,8)}...)`, colors.dim);
      }
      logStderr('[E2E] Encryption established!', colors.green);
      e2ePending = false;
    }
    return;
  }

  // Decrypt E2E content if enabled and ready
  if (e2eEnabled && e2e.isReady()) {
    try {
      msg = e2e.decryptContent(msg);
    } catch (err) {
      logStderr(`[E2E] Decryption error: ${err.message}`, colors.yellow);

      // Check if we need to re-exchange keys due to repeated failures
      if (e2e.needsKeyReExchange()) {
        logStderr('[E2E] Too many decryption failures - initiating key re-exchange...', colors.yellow);
        e2e.resetForKeyReExchange();

        // Send fresh key exchange request
        const keyExchangeMsg = e2e.createKeyExchangeMessage(true);
        keyExchangeMsg.sessionId = sessionId;
        bridgeSocket.send(JSON.stringify(keyExchangeMsg));
        logStderr('[E2E] Sent fresh key exchange request', colors.cyan);
      }
    }
  } else if (!e2eEnabled) {
    // Check if any field is encrypted
    const hasEncrypted = msg.content?.e2e === true ||
                         msg.message?.content?.e2e === true ||
                         msg.fullText?.e2e === true ||
                         msg.displayText?.e2e === true ||
                         msg.question?.e2e === true ||
                         msg.data?.e2e === true;
    if (hasEncrypted) {
      // Received encrypted message but E2E not enabled - can't decrypt
      logStderr('⚠️  Received ENCRYPTED message but --e2e not enabled', colors.yellow);
      logStderr('   Run with --e2e flag to decrypt messages from iOS', colors.dim);
      logStderr('   Message will display as encrypted data', colors.dim);
    }
  }

  switch (msg.type) {
    case 'authenticated':
      isAuthenticated = true;
      logStatus(`Authenticated as ${msg.userId} (${msg.email || 'no email'})`);
      log('✅ Authenticated with bridge server', colors.green);

      // Register our session FIRST so we become a 'provider' type
      // This is required before E2E key exchange so our keys can reach viewers
      bridgeSocket.send(JSON.stringify({
        type: 'register_session',
        sessionId,
        path: process.cwd(),
        name: sessionName || path.basename(process.cwd()),  // Use --name or fallback to directory name
        e2e: e2eEnabled  // Indicate if this session has E2E enabled
      }));
      break;

    case 'session_registered':
      logStatus(`Session registered with bridge: ${msg.sessionId.slice(0, 8)}...`);

      // Now that we're registered as a provider, send E2E key exchange
      // Must be AFTER register_session so our type is 'provider' and keys reach viewers
      if (e2eEnabled && e2e.isEnabled()) {
        const keyExchangeMsg = e2e.createKeyExchangeMessage(true);  // needsResponse=true
        keyExchangeMsg.sessionId = sessionId;  // Include sessionId for routing
        bridgeSocket.send(JSON.stringify(keyExchangeMsg));
        log('[E2E] Sent public key to bridge (waiting for peer)', colors.cyan);
      }

      // Log E2E status
      if (e2eEnabled) {
        if (e2e.isReady()) {
          logStderr('[E2E] Encryption active (using saved peer)', colors.green);
        } else {
          logStderr('[E2E] Waiting for iOS to connect for key exchange...', colors.cyan);
        }
      }
      break;

    case 'auth_error':
      isAuthenticated = false;
      log(`❌ Authentication failed: ${msg.message}`, colors.red);

      // Try to refresh the token
      (async () => {
        const newToken = await refreshIdToken();
        if (newToken) {
          authToken = newToken;
          // Re-authenticate with new token
          if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
            bridgeSocket.send(JSON.stringify({
              type: 'authenticate',
              token: newToken
            }));
          }
        } else {
          log('', colors.red);
          log('╔════════════════════════════════════════════╗', colors.red);
          log('║  FATAL: Authentication failed              ║', colors.red);
          log('║                                            ║', colors.red);
          log('║  Your token is invalid or expired.        ║', colors.red);
          log('║  Please re-login:                          ║', colors.red);
          log('║                                            ║', colors.red);
          log('║    vibe --login                            ║', colors.red);
          log('║                                            ║', colors.red);
          log('╚════════════════════════════════════════════╝', colors.red);
          log('', colors.red);
          process.exit(1);
        }
      })();
      break;

    case 'e2e_key_exchange_pending':
      // iOS not connected yet - just log, key will be exchanged when iOS connects
      if (e2eEnabled) {
        logStderr('[E2E] iOS app not connected yet - will exchange keys when it connects', colors.dim);
      }
      break;

    case 'e2e_key_exchange_sent':
      // Key exchange was relayed to peer(s)
      if (e2eEnabled) {
        logStderr(`[E2E] Key sent to ${msg.recipients || 1} peer(s)`, colors.dim);
      }
      break;

    case 'send_message':
      // Mobile sent a message - forward to Claude
      // Track it so we don't echo it back (bridge already echoed to iOS)
      if (msg.content) {
        // Check if decryption failed (content is still an encrypted object)
        if (typeof msg.content === 'object' && msg.content.e2e) {
          logStderr('⚠️  Failed to decrypt message from mobile - E2E keys may be out of sync', colors.yellow);
          logStderr('   Try resetting E2E on both CLI (delete ~/.vibe/e2e-keys.json) and iOS', colors.dim);
          break;
        }

        // Warn if E2E enabled but received unencrypted message
        if (e2eEnabled && !e2e.isReady()) {
          logStderr('⚠️  E2E enabled but received UNENCRYPTED message from iOS', colors.yellow);
          logStderr('   Enable E2E on iOS: Settings > Security > E2E Encryption', colors.dim);
        }

        // Store hash of message content to detect it in session file later
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const hash = contentStr.trim().toLowerCase();
        if (mobileMessageHashes.size >= MAX_MOBILE_MESSAGES) {
          // Remove oldest (first) entry
          const first = mobileMessageHashes.values().next().value;
          mobileMessageHashes.delete(first);
        }
        mobileMessageHashes.add(hash);
        sendToClaude(contentStr, msg.source || 'mobile');
      }
      break;

    case 'send_file':
      // Mobile sent a file (image) - save and forward path to Claude
      {
        log(`📱 Received send_file: ${msg.fileName} (${msg.data?.length || 0} bytes base64)`, colors.cyan);

        if (!msg.data || msg.data.length === 0 || !msg.fileName) {
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: 'Invalid file upload: missing data or fileName'
          });
          break;
        }

        // Validate file size (10MB raw = ~14MB base64)
        const MAX_BASE64_SIZE = 14 * 1024 * 1024;
        if (msg.data.length > MAX_BASE64_SIZE) {
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: 'File too large (max 10MB)'
          });
          break;
        }

        const uploadDir = path.join(os.tmpdir(), 'vibe-uploads', sessionId);

        try {
          // Ensure upload directory exists (use try/catch to handle race conditions)
          try {
            fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
          } catch (mkdirErr) {
            if (mkdirErr.code !== 'EEXIST') throw mkdirErr;
          }

          // Sanitize filename (prevent path traversal)
          let safeName = path.basename(msg.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
          // Ensure filename is not empty after sanitization
          if (!safeName || safeName === '_' || !safeName.includes('.')) {
            const ext = (msg.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
            safeName = `image.${ext}`;
          }
          const timestamp = Date.now();
          const filePath = path.join(uploadDir, `${timestamp}_${safeName}`);

          // Decode and save file
          const fileBuffer = Buffer.from(msg.data, 'base64');

          // Validate decoded data
          if (fileBuffer.length === 0) {
            throw new Error('Invalid or empty image data');
          }

          // Validate decoded size
          if (fileBuffer.length > 10 * 1024 * 1024) {
            throw new Error('Decoded file exceeds 10MB limit');
          }

          fs.writeFileSync(filePath, fileBuffer, { mode: 0o600 });

          // Calculate hash for verification
          const localHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
          const header = fileBuffer.slice(0, 4);
          const headerHex = header.toString('hex').toUpperCase();

          // Log image details for debugging
          log(`📷 Saved image: ${filePath}`, colors.cyan);
          log(`   Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB, Header: ${headerHex}`, colors.dim);
          log(`   Local hash: ${localHash}`, colors.dim);

          // Verify hash if provided by bridge
          if (msg.imageHash) {
            if (msg.imageHash === localHash) {
              log(`   ✅ Hash verified: matches bridge (${msg.imageHash})`, colors.green);
            } else {
              log(`   ❌ Hash MISMATCH! Bridge: ${msg.imageHash}, Local: ${localHash}`, colors.red);
            }
          }
          if (msg.imageSize && msg.imageSize !== fileBuffer.length) {
            log(`   ⚠️ Size mismatch: Bridge=${msg.imageSize}, Local=${fileBuffer.length}`, colors.yellow);
          }

          // Build message for Claude - include file path with clear instruction
          // Claude Code uses the Read tool to view images, so we need to reference the file clearly
          let claudeMessage;
          if (msg.content) {
            // User provided a prompt with the image
            claudeMessage = `[Image uploaded: ${filePath}]\n\n${msg.content}`;
          } else {
            // No prompt - just tell Claude about the image
            claudeMessage = `[Image uploaded: ${filePath}]\n\nPlease describe this image.`;
          }

          // Send to Claude via stdin
          if (claudeProcess && claudeProcess.stdin && claudeProcess.stdin.writable) {
            log(`📤 Sending to Claude: ${claudeMessage.split('\n')[0]}...`, colors.dim);
            sendToClaude(claudeMessage, 'mobile-file');
          } else {
            throw new Error('Claude process not ready');
          }

          // Use iOS-provided thumbnail if available, otherwise fall back to full image
          let thumbnailData = msg.thumbnailData || msg.data;

          if (msg.thumbnailData) {
            log(`   Thumbnail: using iOS-provided (${(msg.thumbnailData.length / 1024).toFixed(0)}KB)`, colors.dim);
          } else {
            log(`   Thumbnail: using full image (${(msg.data.length / 1024).toFixed(0)}KB) - no iOS thumbnail provided`, colors.yellow);
          }

          // Echo the message back using claude_message type (matches iOS handler)
          sendToBridge({
            type: 'claude_message',
            sessionId: sessionId,
            message: {
              id: uuidv4(),
              sender: 'user',
              content: msg.content || `[Image: ${safeName}]`,
              timestamp: new Date().toISOString(),
              attachment: {
                id: uuidv4(),
                fileName: safeName,
                mimeType: msg.mimeType || 'image/jpeg',
                localPath: filePath,
                thumbnailData: thumbnailData,
                size: fileBuffer.length
              }
            }
          });

          // Also send file_received confirmation
          sendToBridge({
            type: 'file_received',
            sessionId: sessionId,
            fileName: safeName,
            localPath: filePath,
            size: fileBuffer.length
          });

        } catch (err) {
          log(`❌ Failed to save file: ${err.message}`, colors.red);
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: `Failed to upload file: ${err.message}`
          });
        }
      }
      break;

    case 'send_files':
      // Mobile sent multiple files (images) - save and forward paths to Claude
      {
        log(`📱 Received send_files: ${msg.images?.length || 0} images`, colors.cyan);

        if (!msg.images || !Array.isArray(msg.images) || msg.images.length === 0) {
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: 'Invalid file upload: missing or empty images array'
          });
          break;
        }

        // Validate total size (50MB limit for all images)
        const MAX_TOTAL_BASE64_SIZE = 70 * 1024 * 1024; // ~50MB raw = ~70MB base64
        const totalBase64Size = msg.images.reduce((sum, img) => sum + (img.data?.length || 0), 0);
        if (totalBase64Size > MAX_TOTAL_BASE64_SIZE) {
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: 'Total file size too large (max 50MB combined)'
          });
          break;
        }

        const uploadDir = path.join(os.tmpdir(), 'vibe-uploads', sessionId);

        try {
          // Ensure upload directory exists
          try {
            fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
          } catch (mkdirErr) {
            if (mkdirErr.code !== 'EEXIST') throw mkdirErr;
          }

          const savedFiles = [];
          const attachments = [];
          const timestamp = Date.now();

          for (let i = 0; i < msg.images.length; i++) {
            const img = msg.images[i];

            if (!img.data || img.data.length === 0 || !img.fileName) {
              log(`⚠️ Skipping invalid image ${i + 1}: missing data or fileName`, colors.yellow);
              continue;
            }

            // Validate individual size (10MB raw = ~14MB base64)
            const MAX_BASE64_SIZE = 14 * 1024 * 1024;
            if (img.data.length > MAX_BASE64_SIZE) {
              log(`⚠️ Skipping image ${i + 1}: too large (max 10MB each)`, colors.yellow);
              continue;
            }

            // Sanitize filename
            let safeName = path.basename(img.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
            if (!safeName || safeName === '_' || !safeName.includes('.')) {
              const ext = (img.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
              safeName = `image_${i}.${ext}`;
            }
            const filePath = path.join(uploadDir, `${timestamp}_${i}_${safeName}`);

            // Decode and save
            const fileBuffer = Buffer.from(img.data, 'base64');

            if (fileBuffer.length === 0) {
              log(`⚠️ Skipping image ${i + 1}: empty data after decode`, colors.yellow);
              continue;
            }

            if (fileBuffer.length > 10 * 1024 * 1024) {
              log(`⚠️ Skipping image ${i + 1}: decoded size exceeds 10MB`, colors.yellow);
              continue;
            }

            fs.writeFileSync(filePath, fileBuffer, { mode: 0o600 });

            // Calculate hash for verification
            const localHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);
            const header = fileBuffer.slice(0, 4);
            const headerHex = header.toString('hex').toUpperCase();

            log(`📷 Saved image ${i + 1}/${msg.images.length}: ${filePath}`, colors.cyan);
            log(`   Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB, Header: ${headerHex}`, colors.dim);

            // Verify hash if provided
            if (img.imageHash) {
              if (img.imageHash === localHash) {
                log(`   ✅ Hash verified: ${img.imageHash}`, colors.green);
              } else {
                log(`   ❌ Hash MISMATCH! Expected: ${img.imageHash}, Got: ${localHash}`, colors.red);
              }
            }

            savedFiles.push({ path: filePath, name: safeName });

            // Build attachment for echo
            const thumbnailData = img.thumbnailData || img.data;
            attachments.push({
              id: uuidv4(),
              fileName: safeName,
              mimeType: img.mimeType || 'image/jpeg',
              localPath: filePath,
              thumbnailData: thumbnailData,
              size: fileBuffer.length
            });
          }

          if (savedFiles.length === 0) {
            throw new Error('No valid images to process');
          }

          // Build message for Claude with all file paths
          let claudeMessage;
          const filePaths = savedFiles.map(f => f.path).join('\n');
          const userPrompt = msg.prompt || msg.content;  // iOS sends as "content", bridge might use "prompt"

          if (userPrompt) {
            claudeMessage = `[${savedFiles.length} images uploaded:\n${filePaths}]\n\n${userPrompt}`;
          } else {
            claudeMessage = `[${savedFiles.length} images uploaded:\n${filePaths}]\n\nPlease describe and compare these images.`;
          }

          // Send to Claude
          if (claudeProcess && claudeProcess.stdin && claudeProcess.stdin.writable) {
            log(`📤 Sending to Claude: ${savedFiles.length} images`, colors.dim);
            sendToClaude(claudeMessage, 'mobile-files');
          } else {
            throw new Error('Claude process not ready');
          }

          // Echo the message back with attachments array
          sendToBridge({
            type: 'claude_message',
            sessionId: sessionId,
            message: {
              id: uuidv4(),
              sender: 'user',
              content: userPrompt || `[${savedFiles.length} images]`,
              timestamp: new Date().toISOString(),
              attachments: attachments
            }
          });

          // Send confirmation
          sendToBridge({
            type: 'files_received',
            sessionId: sessionId,
            count: savedFiles.length,
            files: savedFiles.map(f => ({ fileName: f.name, localPath: f.path }))
          });

          log(`✅ Processed ${savedFiles.length}/${msg.images.length} images`, colors.green);

        } catch (err) {
          log(`❌ Failed to process files: ${err.message}`, colors.red);
          sendToBridge({
            type: 'error',
            sessionId: sessionId,
            message: `Failed to upload files: ${err.message}`
          });
        }
      }
      break;

    case 'approve_permission':
    case 'approve_permission_always':
      // Claude Code shows numbered selection: 1=Yes, 2=Yes don't ask again, 3=Custom
      // approve_permission sends '1', approve_permission_always sends '2'
      // Can also use msg.option to specify: 1, 2, or 3
      {
        const now = Date.now();
        // Debounce: ignore if less than 500ms since last approval
        if (now - lastApprovalTime < 500) {
          log('📱 Permission approval debounced (too fast)', colors.dim);
          break;
        }
        // Check if there's a pending permission
        if (!pendingPermission) {
          log('📱 No pending permission to approve', colors.yellow);
          break;
        }
        // Determine which option to send
        let option = '1';
        let optionLabel = 'Yes';
        let customText = null;

        if (msg.type === 'approve_permission_always' || msg.option === 2) {
          option = '2';
          optionLabel = "Yes, don't ask again";
        } else if (msg.option === 3) {
          // Option 3: custom text
          if (msg.customText && typeof msg.customText === 'string' && msg.customText.trim()) {
            option = '3';
            optionLabel = 'Custom';
            // Sanitize: remove newlines, limit length
            customText = msg.customText.replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
          } else {
            log('📱 Option 3 requires customText, falling back to option 1', colors.yellow);
          }
        } else if (msg.option && msg.option !== 1) {
          log(`📱 Invalid option ${msg.option}, using option 1`, colors.yellow);
        }

        // Send the option number first, then Enter separately (like sendToClaude)
        // Claude's ink UI needs them sent separately to register the selection
        const optionBuffer = Buffer.from(option, 'utf8');
        if (safeStdinWrite(optionBuffer)) {
          log(`📱 Permission approved (${option}: ${optionLabel}): ${pendingPermission.command}`, colors.green);
          lastApprovalTime = now;
          const savedCustomText = customText;  // Save for closure
          pendingPermission = null;

          // Send Enter after a short delay
          setTimeout(() => {
            // Guard: check if process is still running
            if (!claudeProcess || !isRunning || isShuttingDown) return;

            const enterBuffer = Buffer.from('\r', 'utf8');
            safeStdinWrite(enterBuffer);
            logStatus('Sent Enter for permission confirmation');

            // For option 3, send custom text after another delay
            if (option === '3' && savedCustomText) {
              setTimeout(() => {
                // Guard: check if process is still running
                if (!claudeProcess || !isRunning || isShuttingDown) return;

                // Send custom text
                const textBuffer = Buffer.from(savedCustomText, 'utf8');
                safeStdinWrite(textBuffer);
                // Then Enter
                setTimeout(() => {
                  // Guard: check if process is still running
                  if (!claudeProcess || !isRunning || isShuttingDown) return;

                  const enterBuffer2 = Buffer.from('\r', 'utf8');
                  if (safeStdinWrite(enterBuffer2)) {
                    log(`📱 Sent custom text: "${savedCustomText.slice(0, 50)}${savedCustomText.length > 50 ? '...' : ''}"`, colors.dim);
                  }
                }, 100);
              }, 150);
            }
          }, 100);

          sendToBridge({ type: 'session_status', status: 'active' });
        }
      }
      break;

    case 'deny_permission':
      // Send Ctrl+C to cancel the permission prompt (more reliable than Escape)
      {
        if (!pendingPermission) {
          log('📱 No pending permission to deny', colors.yellow);
          break;
        }
        // Try Escape first, then Ctrl+C as fallback
        if (safeStdinWrite('\x1b') || safeStdinWrite('\x03')) {
          log(`📱 Permission denied: ${pendingPermission.command}`, colors.yellow);
          pendingPermission = null;
          sendToBridge({ type: 'session_status', status: 'active' });
        }
      }
      break;

    case 'session_renamed':
      // Update local session name (could be from our rename or from iOS rename)
      if (msg.name) {
        sessionName = msg.name;
        log(`📝 Session name updated: ${msg.name}`, colors.cyan);
      }
      break;

    case 'error':
      // Check for auth-related errors - these are fatal
      const authErrors = ['Invalid token', 'Token expired', 'Authentication required', 'Unauthorized'];
      const isAuthError = authErrors.some(e => msg.message?.includes(e));

      if (isAuthError) {
        log('', colors.red);
        log('╔════════════════════════════════════════════╗', colors.red);
        log('║  FATAL: Authentication failed              ║', colors.red);
        log('║                                            ║', colors.red);
        log(`║  ${(msg.message || 'Invalid token').padEnd(42)}║`, colors.red);
        log('║                                            ║', colors.red);
        log('║  Please re-login:                          ║', colors.red);
        log('║    vibe --login                            ║', colors.red);
        log('║                                            ║', colors.red);
        log('╚════════════════════════════════════════════╝', colors.red);
        log('', colors.red);
        process.exit(1);
      } else {
        logStatus(`Bridge error: ${msg.message}`);
      }
      break;

    // Agent-mode messages (when connected via --agent)
    case 'bridge_disconnected':
      log('⚠️  Bridge connection lost, agent reconnecting...', colors.yellow);
      break;

    case 'bridge_reconnected':
      log('✅ Bridge connection restored', colors.green);
      break;

    case 'session_stop':
      // Agent is stopping this session - don't reconnect
      log('🛑 Session stopped by agent', colors.yellow);
      isShuttingDown = true;
      // Let Claude process finish gracefully
      if (claudeProcess && !claudeProcess.killed) {
        try { claudeProcess.kill('SIGTERM'); } catch {}
      }
      break;

    case 'terminal_input':
      // Input from attached terminal client - forward to Claude
      if (msg.data && claudeProcess && claudeProcess.stdin) {
        safeStdinWrite(msg.data);
      }
      break;

    default:
      logStatus(`Unknown bridge message: ${msg.type}`);
  }
}

function sendToBridge(data) {
  if (!isAuthenticated) {
    logStatus(`Cannot send to bridge: not authenticated`);
    return false;
  }
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    try {
      // Encrypt content if E2E is enabled and ready
      let dataToSend = data;
      let e2eStatus = '';

      if (e2eEnabled) {
        // Fields that contain sensitive content and should be encrypted
        const sensitiveFields = ['content', 'fullText', 'displayText', 'question', 'data'];

        if (e2e.isReady()) {
          dataToSend = { ...data };
          let encryptedCount = 0;

          // Helper to check if already encrypted
          const isAlreadyEncrypted = (val) => val && typeof val === 'object' && val.e2e === true;

          // Encrypt top-level sensitive fields
          for (const field of sensitiveFields) {
            if (data[field] !== undefined && !isAlreadyEncrypted(data[field])) {
              dataToSend[field] = e2e.encrypt(data[field]);
              encryptedCount++;
            }
          }

          // Handle nested message.content (claude_message format)
          if (data.message?.content !== undefined && !isAlreadyEncrypted(data.message?.content)) {
            dataToSend.message = { ...data.message, content: e2e.encrypt(data.message.content) };
            encryptedCount++;
          }

          e2eStatus = encryptedCount > 0 ? ' [E2E]' : ' [E2E:no-content]';
        } else {
          // Check if message has any sensitive content
          const hasSensitive = sensitiveFields.some(f => data[f] !== undefined) || data.message?.content !== undefined;
          if (hasSensitive) {
            e2eStatus = ' [UNENCRYPTED]';
            logStderr('⚠️  E2E enabled but not established - message sent UNENCRYPTED', colors.yellow);
            logStderr('   Enable E2E on iOS: Settings > Security > E2E Encryption', colors.dim);
          }
        }
      }

      const json = JSON.stringify(dataToSend);
      bridgeSocket.send(json);
      logStatus(`SENT to bridge${e2eStatus}: type=${data.type}, size=${json.length} bytes`);
      return true;
    } catch (err) {
      logStatus(`Failed to send to bridge: ${err.message}`);
    }
  } else {
    logStatus(`Cannot send to bridge: socket ${bridgeSocket ? 'not open' : 'null'}`);
  }
  return false;
}

// ====================
// Session File Watcher (for Claude output)
// ====================

function startSessionFileWatcher() {
  let sessionFile = getSessionFilePath();
  logStatus(`Watching for session file: ${sessionFile}`);

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let fileCheckCount = 0;
  let lastNotFoundLog = 0;
  let fileFound = false;

  // Function to scan for session file in all project directories
  function scanForSessionFile() {
    if (!fs.existsSync(projectsDir)) return null;

    try {
      const dirs = fs.readdirSync(projectsDir);
      // Limit scan to 50 directories to avoid slowdown
      const dirsToScan = dirs.slice(0, 50);
      for (const dir of dirsToScan) {
        const fullDir = path.join(projectsDir, dir);
        try {
          if (fs.statSync(fullDir).isDirectory()) {
            const candidateFile = path.join(fullDir, `${sessionId}.jsonl`);
            if (fs.existsSync(candidateFile)) {
              return candidateFile;
            }
          }
        } catch (e) {
          // Skip inaccessible directories
        }
      }
    } catch (err) {
      // Ignore scan errors
    }
    return null;
  }

  const pollInterval = setInterval(() => {
    if (!isRunning || isShuttingDown) {
      clearInterval(pollInterval);
      return;
    }

    try {
      // If file not found yet, try to discover it
      if (!fileFound) {
        if (!fs.existsSync(sessionFile)) {
          // Try scanning for it every 5 seconds
          fileCheckCount++;
          if (fileCheckCount % 10 === 0) {
            const discovered = scanForSessionFile();
            if (discovered) {
              sessionFile = discovered;
              fileFound = true;
              lastFileSize = 0;  // Reset to read from beginning
              log(`📁 Found session file: ${sessionFile}`, colors.dim);
            } else {
              // Only log "not found" every 30 seconds to reduce spam
              const now = Date.now();
              if (now - lastNotFoundLog > 30000) {
                logStatus(`Waiting for session file... (${Math.floor(fileCheckCount / 2)}s)`);
                lastNotFoundLog = now;
              }
            }
          }
          return;
        }
        fileFound = true;
        lastFileSize = 0;  // Reset to read from beginning
        log(`📁 Session file ready: ${sessionFile}`, colors.dim);
      }

      if (!fs.existsSync(sessionFile)) {
        return;
      }

      const stats = fs.statSync(sessionFile);

      // Handle file being recreated (size shrunk)
      if (stats.size < lastFileSize) {
        logStatus(`Session file was recreated, re-reading from start`);
        lastFileSize = 0;
      }

      if (stats.size > lastFileSize) {
        logStatus(`Session file changed: ${lastFileSize} -> ${stats.size} bytes`);
        const fd = fs.openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(stats.size - lastFileSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastFileSize);
        fs.closeSync(fd);
        lastFileSize = stats.size;

        const newContent = buffer.toString('utf8');
        const lines = newContent.split('\n').filter(l => l.trim());
        logStatus(`Processing ${lines.length} new lines from session file`);

        // First pass: collect all tool_result IDs (auto-approved tools)
        // This ensures we know which tools are already completed before processing tool_use
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              for (const block of msg.message.content) {
                if (block.type === 'tool_result' && block.tool_use_id) {
                  // Limit Set size to prevent memory issues
                  if (completedToolIds.size >= MAX_COMPLETED_TOOLS) {
                    const firstId = completedToolIds.values().next().value;
                    completedToolIds.delete(firstId);
                  }
                  completedToolIds.add(block.tool_use_id);
                  logStatus(`Pre-scan: found completed tool ${block.tool_use_id}`);
                }
              }
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        }

        // Second pass: process all messages
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            processSessionMessage(msg);
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
    } catch (err) {
      logStatus(`Session file error: ${err.message}`);
    }
  }, 500);

  return () => clearInterval(pollInterval);
}

function processSessionMessage(msg) {
  logStatus(`Processing message: type=${msg.type || 'unknown'}, has_message=${!!msg.message}`);

  // Debug: log content block types
  if (msg.message?.content && Array.isArray(msg.message.content)) {
    const blockTypes = msg.message.content.map(b => b.type).join(', ');
    logStatus(`Content blocks: [${blockTypes}]`);
  }

  if (!msg.message || !msg.message.role) {
    logStatus(`Skipping: no message.role (type=${msg.type})`);
    return;
  }

  const role = msg.message.role;
  const content = msg.message.content;

  logStatus(`Message role=${role}, content_type=${typeof content}, is_array=${Array.isArray(content)}`);

  // Build comprehensive message with all content types
  let parts = [];
  let toolUses = [];
  let thinkingContent = '';

  if (typeof content === 'string') {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'thinking') {
        // Claude's reasoning/planning
        thinkingContent = block.thinking || '';
        logStatus(`Found thinking block: ${thinkingContent.slice(0, 100)}...`);
      } else if (block.type === 'tool_use') {
        // Tool use request (permission prompt)
        const toolInfo = {
          id: block.id,
          name: block.name,
          input: block.input
        };
        toolUses.push(toolInfo);
        logStatus(`Found tool_use: ${block.name} (id: ${block.id})`);

        // Format tool use for display
        let toolDescription = `**${block.name}**`;
        if (block.input) {
          if (block.name === 'Bash' && block.input.command) {
            toolDescription += `\n\`\`\`\n${block.input.command}\n\`\`\``;
            if (block.input.description) {
              toolDescription += `\n${block.input.description}`;
            }
          } else if (block.name === 'Read' && block.input.file_path) {
            toolDescription += `: ${block.input.file_path}`;
          } else if (block.name === 'Write' && block.input.file_path) {
            toolDescription += `: ${block.input.file_path}`;
          } else if (block.name === 'Edit' && block.input.file_path) {
            toolDescription += `: ${block.input.file_path}`;
          } else {
            // Generic tool input display
            const inputStr = JSON.stringify(block.input, null, 2);
            if (inputStr.length < 500) {
              toolDescription += `\n\`\`\`json\n${inputStr}\n\`\`\``;
            }
          }
        }
        parts.push(toolDescription);
      } else if (block.type === 'tool_result') {
        // Tool execution result - permission was processed (auto-approved or user approved)
        logStatus(`Found tool_result for tool_use_id: ${block.tool_use_id}`);
        // Mark this tool as completed so we don't send permission_request for it
        if (completedToolIds.size >= MAX_COMPLETED_TOOLS) {
          const firstId = completedToolIds.values().next().value;
          completedToolIds.delete(firstId);
        }
        completedToolIds.add(block.tool_use_id);
        // Clear pending permission since tool was executed
        if (pendingPermission && pendingPermission.id === block.tool_use_id) {
          pendingPermission = null;
        }
        if (block.content) {
          const resultText = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
          if (resultText.length < 1000) {
            parts.push(`*Result:*\n${resultText}`);
          } else {
            parts.push(`*Result:* (${resultText.length} chars)`);
          }
        }
      }
    }
  }

  // Send thinking content if present
  if (thinkingContent) {
    log(`💭 Sending thinking to iOS (${thinkingContent.length} chars)`, colors.dim);
    sendToBridge({
      type: 'claude_message',
      message: {
        id: uuidv4(),
        sender: 'claude',
        content: `💭 *Thinking:*\n${thinkingContent}`,
        timestamp: new Date().toISOString(),
        messageType: 'thinking'
      }
    });
  }

  // Send tool use as permission request (only for tools not yet executed)
  const pendingTools = toolUses.filter(t => !completedToolIds.has(t.id));
  if (pendingTools.length > 0) {
    log(`🔧 Sending ${pendingTools.length} tool_use to iOS (${toolUses.length - pendingTools.length} already completed)`, colors.dim);
  }

  // Helper function to send permission request with captured or fallback options
  function sendPermissionRequest(tool, displayText, capturedPrompt) {
    let options;
    let question = 'Permission required';

    if (capturedPrompt && capturedPrompt.options) {
      // Use actual options captured from CLI terminal output
      log(`📋 Using captured CLI prompt with ${capturedPrompt.options.length} options`, colors.dim);
      options = capturedPrompt.options.map(opt => ({
        id: opt.id,
        label: opt.label,
        action: opt.id === 1 ? 'approve' : opt.id === 2 ? 'approve_always' : 'custom',
        requiresInput: opt.requiresInput || false
      }));
      question = capturedPrompt.question || question;
    } else {
      // Fallback: build context-aware options
      log(`⚠️ No captured prompt, using fallback options`, colors.dim);
      let dontAskAgainLabel = "Yes, and don't ask again";
      if (tool.name === 'Bash' && tool.input?.command) {
        const baseCmd = tool.input.command.trim().split(/\s+/)[0];
        dontAskAgainLabel = `Yes, and don't ask again for ${baseCmd} commands`;
      } else if (tool.name === 'Read') {
        dontAskAgainLabel = "Yes, and don't ask again for Read";
      } else if (tool.name === 'Write') {
        dontAskAgainLabel = "Yes, and don't ask again for Write";
      } else if (tool.name === 'Edit') {
        dontAskAgainLabel = "Yes, and don't ask again for Edit";
      }
      options = [
        { id: 1, label: 'Yes', action: 'approve' },
        { id: 2, label: dontAskAgainLabel, action: 'approve_always' },
        { id: 3, label: 'Tell Claude what to do differently', action: 'custom', requiresInput: true }
      ];
    }

    sendToBridge({
      type: 'permission_request',
      sessionId: sessionId,
      requestId: tool.id,
      command: tool.name,
      question: question,
      displayText: displayText,
      fullText: JSON.stringify(tool.input, null, 2),
      options: options,
      cancelLabel: 'Cancel'
    });
  }

  for (const tool of pendingTools) {
    // Track the pending permission (only last one if multiple)
    pendingPermission = {
      id: tool.id,
      command: tool.name,
      timestamp: Date.now()
    };

    // Build display-friendly description
    let displayText = `**${tool.name}**`;
    if (tool.input) {
      if (tool.name === 'Bash' && tool.input.command) {
        displayText = `Run command:\n\`\`\`\n${tool.input.command}\n\`\`\``;
      } else if (tool.name === 'Read' && tool.input.file_path) {
        displayText = `Read file: ${tool.input.file_path}`;
      } else if (tool.name === 'Write' && tool.input.file_path) {
        displayText = `Write file: ${tool.input.file_path}`;
      } else if (tool.name === 'Edit' && tool.input.file_path) {
        displayText = `Edit file: ${tool.input.file_path}`;
      } else {
        displayText = `${tool.name}: ${JSON.stringify(tool.input, null, 2)}`;
      }
    }

    // Check if we already have a captured prompt
    if (lastCapturedPrompt && lastCapturedPrompt.options) {
      sendPermissionRequest(tool, displayText, lastCapturedPrompt);
      lastCapturedPrompt = null;
    } else {
      // Wait briefly for prompt to be captured from terminal output
      // The prompt appears on terminal slightly after tool_use is written to session file
      const toolCopy = { ...tool };
      const displayTextCopy = displayText;
      setTimeout(() => {
        sendPermissionRequest(toolCopy, displayTextCopy, lastCapturedPrompt);
        lastCapturedPrompt = null;
      }, 300);  // 300ms delay to allow prompt capture
    }
  }

  // Send text content
  const textContent = parts.join('\n\n');
  if (!textContent.trim()) {
    logStatus(`Skipping: no displayable content extracted`);
    return;
  }

  // Only skip user messages that came from mobile (send_message)
  // Bridge already echoed those, so sending again would cause duplicates
  // But initial prompts and local terminal input should still be sent
  if (role === 'user') {
    const hash = textContent.trim().toLowerCase();
    if (mobileMessageHashes.has(hash)) {
      // This message came from mobile - bridge already echoed it
      mobileMessageHashes.delete(hash);  // Clean up (each message only needs to be skipped once)
      logStatus(`Skipping mobile message (bridge echoed): "${textContent.slice(0, 30)}..."`);
      return;
    }
    // This is initial prompt or local terminal input - send it
    logStatus(`Sending user message (initial/local): "${textContent.slice(0, 50)}..."`);
  } else {
    logStatus(`Sending ${role} message to bridge: "${textContent.slice(0, 50)}${textContent.length > 50 ? '...' : ''}"`);
  }

  // Send to bridge
  sendToBridge({
    type: 'claude_message',
    message: {
      id: msg.uuid || uuidv4(),
      sender: role === 'user' ? 'user' : 'claude',
      content: textContent,
      timestamp: new Date().toISOString()
    }
  });

  // Send token usage if available (assistant messages include usage data)
  if (msg.message?.usage) {
    const usage = msg.message.usage;
    sendToBridge({
      type: 'token_usage',
      sessionId: sessionId,
      model: msg.message.model || null,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0
      }
    });
    logStatus(`Token usage: in=${usage.input_tokens || 0}, out=${usage.output_tokens || 0}, cache_create=${usage.cache_creation_input_tokens || 0}, cache_read=${usage.cache_read_input_tokens || 0}`);
  }
}

// ====================
// Claude Process
// ====================

function startClaude() {
  const claudePath = findClaudePath();

  // Claude CLI: --session-id and --resume are mutually exclusive
  // - For new sessions: use --session-id <id>
  // - For resume: use --resume <id>
  let claudeArgs;
  if (resumeSessionId) {
    // Auto-detect and change to the correct directory for this session
    // This allows resuming from any directory without manually cd'ing
    if (findAndChangeToSessionDir(sessionId)) {
      log(`📂 Changed to session directory: ${process.cwd()}`, colors.cyan);
    }
    claudeArgs = ['--resume', sessionId];
    logStatus(`Resuming Claude session: ${sessionId.slice(0, 8)}...`);
  } else {
    claudeArgs = ['--session-id', sessionId];
    logStatus(`Starting new Claude session: ${sessionId.slice(0, 8)}...`);
  }

  // Add --dangerously-skip-permissions if requested
  if (skipPermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
    log('⚠️  Running in skip-permissions mode (no prompts)', colors.yellow);
  }

  // Choose PTY wrapper based on platform/flag
  // - Windows: always use node-pty (Python PTY doesn't work)
  // - Unix: use Python by default, node-pty with --node-pty flag
  if (useNodePty) {
    const nodeWrapperPath = path.join(__dirname, 'pty-wrapper-node.js');
    logStatus('Using Node.js PTY wrapper');

    // Check if wrapper file exists
    if (!fs.existsSync(nodeWrapperPath)) {
      log('Error: pty-wrapper-node.js not found.', colors.red);
      log('Re-install vibe-cli or check installation.', colors.yellow);
      process.exit(1);
    }

    // Check if node-pty is available
    try {
      require.resolve('node-pty');
    } catch (err) {
      log('Error: node-pty is not installed.', colors.red);
      log('Install it with: npm install node-pty', colors.yellow);
      if (os.platform() === 'win32') {
        log('', colors.reset);
        log('On Windows, you may also need:', colors.yellow);
        log('  - Python 3.x', colors.dim);
        log('  - Visual Studio Build Tools', colors.dim);
        log('  npm install --global windows-build-tools', colors.dim);
      }
      process.exit(1);
    }

    // Always use FD 4 for terminal output mirroring (needed for proper PTY handling)
    const stdioConfig = ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'];

    claudeProcess = spawn('node', [nodeWrapperPath, claudePath, ...claudeArgs], {
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: stdioConfig
    });
  } else {
    // Use Python PTY wrapper (Unix only)
    if (os.platform() === 'win32') {
      log('Error: Python PTY wrapper does not work on Windows.', colors.red);
      log('Please install node-pty: npm install node-pty', colors.yellow);
      process.exit(1);
    }

    const pythonWrapperPath = path.join(__dirname, 'pty-wrapper.py');

    // Check if wrapper file exists
    if (!fs.existsSync(pythonWrapperPath)) {
      log('Error: pty-wrapper.py not found.', colors.red);
      log('Re-install vibe-cli or check installation.', colors.yellow);
      process.exit(1);
    }

    // Always use FD 4 for terminal output mirroring (needed for proper PTY handling)
    const stdioConfig = ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'];

    claudeProcess = spawn('python3', ['-u', pythonWrapperPath, claudePath, ...claudeArgs], {
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' },
      stdio: stdioConfig
    });
  }

  isRunning = true;

  // Start watching session file after a delay to avoid output conflicts during Claude startup
  setTimeout(() => {
    sessionFileWatcher = startSessionFileWatcher();
  }, 2000);  // 2 second delay

  // Read from FD 4 (terminal output mirror) - must consume to prevent pipe buffer from filling
  if (claudeProcess.stdio[4]) {
    claudeProcess.stdio[4].on('data', (data) => {
      // In agent mode, forward to attached clients
      if (agentUrl) {
        sendToBridge({ type: 'terminal_output', data: data.toString('base64'), encoding: 'base64' });
      }
      // In direct mode, just consume (data already goes to terminal via stdout)
    });
  }

  // Read permission prompts from FD 3 (captured by PTY wrapper)
  let promptBuffer = '';
  if (claudeProcess.stdio[3]) {
    claudeProcess.stdio[3].on('data', (data) => {
      promptBuffer += data.toString();
      // Process complete JSON lines
      const lines = promptBuffer.split('\n');
      promptBuffer = lines.pop() || '';  // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const prompt = JSON.parse(line);
          if (prompt.type === 'permission_prompt') {
            log(`🔔 Captured permission prompt from CLI`, colors.dim);
            // Store for use when we see the corresponding tool_use
            lastCapturedPrompt = prompt;
          }
        } catch (e) {
          // Not valid JSON, skip
        }
      }
    });
  }

  claudeProcess.on('exit', (code, signal) => {
    isRunning = false;
    logStatus(`Claude exited (code: ${code}, signal: ${signal})`);

    if (sessionFileWatcher) {
      sessionFileWatcher();
      sessionFileWatcher = null;
    }

    // Cleanup uploaded files
    cleanupUploads(sessionId);

    sendToBridge({
      type: 'session_ended',
      exitCode: code,
      signal
    });

    process.exit(code || 0);
  });

  // Cleanup function for uploaded files
  function cleanupUploads(sid) {
    const uploadDir = path.join(os.tmpdir(), 'vibe-uploads', sid);
    if (fs.existsSync(uploadDir)) {
      try {
        fs.rmSync(uploadDir, { recursive: true });
        log(`🧹 Cleaned up uploads for session ${sid.slice(0, 8)}...`, colors.dim);
      } catch (err) {
        log(`⚠️ Failed to cleanup uploads: ${err.message}`, colors.yellow);
      }
    }
  }

  claudeProcess.on('error', (err) => {
    log(`Failed to start Claude: ${err.message}`, colors.yellow);
    process.exit(1);
  });
}

// ====================
// Terminal Input
// ====================

function setupTerminalInput() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    // Pass all input directly to Claude - no command interception
    if (claudeProcess && isRunning && claudeProcess.stdin && claudeProcess.stdin.writable) {
      claudeProcess.stdin.write(data);
    }
  });
}

// ====================
// Shutdown
// ====================

function setupShutdown() {
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log('\n');
    logStatus('Shutting down...');

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    if (bridgeSocket) {
      try { bridgeSocket.close(); } catch {}
    }

    if (sessionFileWatcher) {
      sessionFileWatcher();
    }

    if (claudeProcess && !claudeProcess.killed) {
      try { claudeProcess.kill('SIGTERM'); } catch {}
    }

    setTimeout(() => process.exit(0), 2000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logStatus(`Uncaught exception: ${err.message}`);
    shutdown();
  });
}

// ====================
// Remote Attach Mode
// ====================

function remoteAttachMain() {
  // Validate before displaying banner (redundant with startup checks, but good failsafe)
  if (!authToken) {
    showWelcomeMessage();
    process.exit(1);
  }

  if (!resumeSessionId) {
    console.log('');
    log('❌ Remote mode requires a session ID', colors.red);
    log('   Run: vibe --remote <session-id>', colors.dim);
    process.exit(1);
  }

  console.log('');
  log('🎵 vibe-cli (Remote Attach)', colors.bright + colors.magenta);
  log('══════════════════════════════════════', colors.dim);
  log(`   Session:  ${sessionId.slice(0, 8)}...`, colors.dim);
  log(`   Bridge:   ${bridgeUrl}`, colors.dim);
  log(`   Mode:     Remote (no local Claude)`, colors.dim);
  log(`   Auth:     Token stored`, colors.dim);
  log('══════════════════════════════════════', colors.dim);
  console.log('');

  setupRemoteAttachShutdown();
  connectToRemoteSession();
  setupRemoteAttachInput();
}

// Connect to bridge and join session for remote viewing/control
function connectToRemoteSession() {
  const ws = new WebSocket(bridgeUrl);
  bridgeSocket = ws;

  ws.on('open', () => {
    log('✓ Connected to bridge', colors.green);
    // Authenticate
    ws.send(JSON.stringify({ type: 'authenticate', token: authToken }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleRemoteAttachMessage(msg);
    } catch (err) {
      logStatus(`Parse error: ${err.message}`);
    }
  });

  ws.on('close', () => {
    log('✗ Disconnected from bridge', colors.yellow);
    bridgeSocket = null;
    isAuthenticated = false;
    // Clear stale permission state on disconnect
    if (pendingPermission) {
      log('  (Pending permission request cancelled)', colors.dim);
      pendingPermission = null;
    }
    // Try to reconnect after 3 seconds
    setTimeout(() => {
      if (!isShuttingDown) {
        log('Reconnecting...', colors.dim);
        connectToRemoteSession();
      }
    }, 3000);
  });

  ws.on('error', (err) => {
    log(`Bridge error: ${err.message}`, colors.red);
  });
}

// Handle messages from bridge in remote attach mode
function handleRemoteAttachMessage(msg) {
  switch (msg.type) {
    case 'authenticated':
      isAuthenticated = true;
      log(`✓ Authenticated as ${msg.email || msg.userId}`, colors.green);
      // Join the session
      bridgeSocket.send(JSON.stringify({
        type: 'join_session',
        sessionId: sessionId
      }));
      break;

    case 'auth_error':
      log(`✗ Authentication failed: ${msg.message}`, colors.red);
      log('  Run: vibe --login --bridge ' + bridgeUrl, colors.dim);
      process.exit(1);
      break;

    case 'joined_session':
      log(`✓ Joined session: ${msg.sessionId?.slice(0, 8)}...`, colors.green);
      if (msg.path) log(`  Path: ${msg.path}`, colors.dim);
      if (msg.isLive === false) {
        log('  ⚠️  Session is not live (ended or no provider)', colors.yellow);
      }
      console.log('');
      log('─────────────────────────────────────', colors.dim);
      log('Type messages to send to Claude.', colors.dim);
      log('Commands: /help for all commands', colors.dim);
      log('─────────────────────────────────────', colors.dim);
      console.log('');
      break;

    case 'message_history':
      // Display recent messages
      if (msg.messages && msg.messages.length > 0) {
        log(`Loading ${msg.messages.length} messages from history...`, colors.dim);
        for (const m of msg.messages.slice(-10)) {  // Show last 10
          displayRemoteMessage(m);
        }
        console.log('');
      }
      break;

    case 'claude_message':
      // Display Claude's message
      displayRemoteMessage(msg.message);
      break;

    case 'permission_request':
      // Display permission request
      console.log('');
      log('🔐 Permission Request:', colors.yellow);
      log(`   Command: ${msg.command}`, colors.bright);
      if (msg.displayText) {
        // Show the human-readable version
        const lines = msg.displayText.split('\n').slice(0, 5);
        for (const line of lines) {
          log(`   ${line}`, colors.dim);
        }
      }
      log('', colors.reset);
      log('   Type /approve or /deny', colors.cyan);
      pendingPermission = { id: msg.requestId, command: msg.command };
      break;

    case 'permission_resolved':
      log(`✓ Permission ${msg.approved ? 'approved' : 'denied'}`, msg.approved ? colors.green : colors.yellow);
      pendingPermission = null;
      break;

    case 'session_ended':
      log(`Session ended (exit code: ${msg.exitCode})`, colors.yellow);
      break;

    case 'join_error':
      log(`✗ Could not join session: ${msg.message || 'Session not found'}`, colors.red);
      log('  The session may have ended or does not exist.', colors.dim);
      break;

    case 'rate_limited':
      console.log('');
      if (msg.reason === 'tokens_per_day') {
        log('⚠️  Daily Limit Reached', colors.yellow);
        log(`   ${msg.message}`, colors.dim);
        log('   Upgrade your plan at: https://minivibeapp.com/pricing', colors.cyan);
      } else {
        log('⚠️  Rate Limited', colors.yellow);
        log(`   ${msg.message}`, colors.dim);
      }
      break;

    case 'error':
      log(`Error: ${msg.message}`, colors.red);
      // Handle specific error types
      if (msg.message && msg.message.includes('session')) {
        log('  Use /reconnect to try again.', colors.dim);
      }
      break;

    case 'session_renamed':
      log(`Session renamed to: ${msg.name}`, colors.cyan);
      break;

    default:
      // Ignore other message types silently
      break;
  }
}

// Display a message from the remote session
function displayRemoteMessage(message) {
  if (!message) return;

  const role = message.role || (message.isUser ? 'user' : 'assistant');
  let content = message.content || message.text || '';

  // Check if content is encrypted and we can't decrypt it
  if (content && typeof content === 'object' && content.e2e === true) {
    content = '[🔒 Encrypted message - run with --e2e to decrypt]';
  }

  if (role === 'user') {
    log(`👤 You: ${truncateText(content, 200)}`, colors.cyan);
  } else if (role === 'assistant') {
    // Handle structured content (array of blocks)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          log(`🤖 Claude: ${truncateText(block.text, 500)}`, colors.green);
        } else if (block.type === 'tool_use') {
          log(`🔧 Tool: ${block.name}`, colors.yellow);
        } else if (block.type === 'thinking' && block.thinking) {
          log(`💭 Thinking: ${truncateText(block.thinking, 100)}...`, colors.dim);
        }
      }
    } else {
      log(`🤖 Claude: ${truncateText(content, 500)}`, colors.green);
    }
  }
}

// Truncate text for display
function truncateText(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// Setup terminal input for remote attach mode
function setupRemoteAttachInput() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();

    if (input === '/quit' || input === '/exit') {
      log('Goodbye!', colors.magenta);
      process.exit(0);
    } else if (input === '/approve' || input === '/yes' || input === '/y') {
      if (pendingPermission) {
        sendRemoteCommand({
          type: 'approve_permission',
          sessionId: sessionId,
          requestId: pendingPermission.id
        });
        log('Sent approval', colors.green);
        pendingPermission = null;
      } else {
        log('No pending permission to approve', colors.yellow);
      }
    } else if (input === '/deny' || input === '/no' || input === '/n') {
      if (pendingPermission) {
        sendRemoteCommand({
          type: 'deny_permission',
          sessionId: sessionId,
          requestId: pendingPermission.id
        });
        log('Sent denial', colors.yellow);
        pendingPermission = null;
      } else {
        log('No pending permission to deny', colors.yellow);
      }
    } else if (input === '/status') {
      log('Remote Session Status:', colors.cyan);
      log(`  Session ID: ${sessionId}`, colors.dim);
      log(`  Connected: ${bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN ? 'Yes' : 'No'}`, colors.dim);
      log(`  Authenticated: ${isAuthenticated ? 'Yes' : 'No'}`, colors.dim);
      log(`  Pending Permission: ${pendingPermission ? 'Yes' : 'No'}`, colors.dim);
    } else if (input === '/reconnect') {
      if (bridgeSocket) {
        bridgeSocket.close();
      }
      log('Reconnecting...', colors.cyan);
      connectToRemoteSession();
    } else if (input === '/help') {
      log('Remote Attach Commands:', colors.cyan);
      log('  /approve, /yes, /y  - Approve pending permission request', colors.dim);
      log('  /deny, /no, /n      - Deny pending permission request', colors.dim);
      log('  /status             - Show session status', colors.dim);
      log('  /reconnect          - Force reconnection to bridge', colors.dim);
      log('  /help               - Show this help', colors.dim);
      log('  /quit, /exit        - Exit remote session', colors.dim);
      log('  <text>              - Send message to Claude', colors.dim);
    } else if (input.startsWith('/')) {
      log(`Unknown command: ${input}`, colors.red);
      log('Commands: /approve, /deny, /status, /reconnect, /help, /quit', colors.dim);
    } else if (input) {
      // Send message to Claude
      sendRemoteCommand({
        type: 'send_message',
        sessionId: sessionId,
        content: input
      });
      log(`📤 Sent: ${truncateText(input, 50)}`, colors.dim);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    log('Input closed', colors.dim);
    process.exit(0);
  });
}

// Send command to bridge in remote attach mode
function sendRemoteCommand(msg) {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify(msg));
  } else {
    log('Not connected to bridge', colors.red);
  }
}

// Setup shutdown handlers for remote attach mode
function setupRemoteAttachShutdown() {
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('');
    log('Shutting down...', colors.dim);

    if (bridgeSocket) {
      bridgeSocket.close();
    }

    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ====================
// Main
// ====================

function startClaudeAndTerminal() {
  startClaude();
  setupTerminalInput();

  // Send initial prompt after a short delay (let Claude start up)
  if (initialPrompt) {
    setTimeout(() => {
      logStatus(`Sending initial prompt: ${initialPrompt}`);
      sendToClaude(initialPrompt, 'initial');
    }, 2000);
  }
}

function main() {
  console.log('');
  log('🎵 vibe-cli', colors.bright + colors.magenta);
  log('══════════════════════════════════════', colors.dim);
  log(`   Session:  ${sessionId.slice(0, 8)}...`, colors.dim);

  if (agentUrl) {
    log(`   Agent:    ${agentUrl}`, colors.dim);
    log(`   Mode:     Managed (via local agent)`, colors.dim);
  } else if (bridgeUrl) {
    log(`   Bridge:   ${bridgeUrl}`, colors.dim);
    log(`   Mode:     Cloud (via bridge server)`, colors.dim);
    log(`   Auth:     ${authToken ? 'Token stored' : 'No token (dev mode)'}`, colors.dim);
  } else {
    log(`   Mode:     Local (no bridge - terminal only)`, colors.dim);
  }

  if (skipPermissions) {
    log(`   Perms:    SKIPPED (dangerously-skip-permissions)`, colors.yellow);
  }

  if (e2eEnabled) {
    if (e2ePending) {
      log(`   E2E:      ⚠️  PENDING - messages will be UNENCRYPTED until iOS enables E2E`, colors.yellow);
    } else {
      log(`   E2E:      🔒 Ready (saved peer)`, colors.green);
    }
  }

  log(`   Terminal: ${process.cwd()}`, colors.dim);
  log('══════════════════════════════════════', colors.dim);
  console.log('');

  setupShutdown();

  if (agentUrl || bridgeUrl) {
    connectToBridge();
  }

  // Start Claude immediately - E2E key exchange happens automatically in the background
  if (e2ePending) {
    log('', '');
    log('⚠️  E2E ENCRYPTION NOT YET ESTABLISHED', colors.yellow + colors.bright);
    log('   Messages will be sent UNENCRYPTED until iOS enables E2E.', colors.yellow);
    log('   Enable on iOS: Settings > Security > E2E Encryption', colors.dim);
    log('', '');
  }
  startClaudeAndTerminal();
}

// List sessions mode - query agent for running sessions
function listSessionsMode() {
  if (!agentUrl) {
    log('❌ List mode requires agent connection', colors.red);
    log('   Agent not found. Make sure vibe-agent is running.', colors.dim);
    process.exit(1);
  }

  const WebSocket = require('ws');
  const listSocket = new WebSocket(agentUrl);
  let gotResponse = false;

  // Timeout after 10 seconds
  const timeout = setTimeout(() => {
    if (!gotResponse) {
      log('❌ Timeout waiting for agent response', colors.red);
      listSocket.close();
      process.exit(1);
    }
  }, 10000);

  listSocket.on('open', () => {
    // Authenticate first
    listSocket.send(JSON.stringify({ type: 'authenticate' }));
  });

  listSocket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'authenticated':
          // Request session list
          listSocket.send(JSON.stringify({ type: 'list_sessions' }));
          break;

        case 'sessions_list':
          gotResponse = true;
          clearTimeout(timeout);

          console.log('');
          log('Running Sessions', colors.bright + colors.cyan);
          log('══════════════════════════════════════', colors.dim);

          if (!msg.sessions || msg.sessions.length === 0) {
            log('   No running sessions', colors.dim);
          } else {
            for (const session of msg.sessions) {
              const source = session.source === 'ios' ? '📱' :
                            session.source === 'cli' ? '💻' : '❓';
              console.log('');
              log(`${source} ${session.name || 'Unnamed'}`, colors.green);
              log(`   ID:     ${session.sessionId || '(unknown)'}`, colors.dim);
              log(`   Path:   ${session.path || '(unknown)'}`, colors.dim);
              if (session.startedAt) {
                const started = new Date(session.startedAt);
                log(`   Started: ${started.toLocaleString()}`, colors.dim);
              }
            }
          }

          console.log('');
          log('══════════════════════════════════════', colors.dim);
          log(`Use: vibe --attach <sessionId>`, colors.dim);
          console.log('');

          listSocket.close();
          process.exit(0);
          break;

        case 'error':
          gotResponse = true;
          clearTimeout(timeout);
          log(`❌ Error: ${msg.message}`, colors.red);
          listSocket.close();
          process.exit(1);
          break;
      }
    } catch (err) {
      // Ignore parse errors
    }
  });

  listSocket.on('error', (err) => {
    clearTimeout(timeout);
    log(`❌ Connection error: ${err.message}`, colors.red);
    log('   Make sure vibe-agent is running.', colors.dim);
    process.exit(1);
  });

  listSocket.on('close', () => {
    clearTimeout(timeout);
    // If we haven't got a response yet, this is an unexpected close
    if (!gotResponse) {
      log('❌ Connection closed unexpectedly', colors.red);
      process.exit(1);
    }
  });
}

// Only start Claude if not in login mode
if (!loginMode) {
  if (listSessions) {
    listSessionsMode();
  } else if (remoteAttachMode) {
    remoteAttachMain();
  } else {
    main();
  }
}
