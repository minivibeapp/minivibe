/**
 * Core orchestration logic for vibe-cli
 * Handles the main session lifecycle: bridge connection, Claude process, etc.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

import {
  DEFAULT_BRIDGE_URL,
  HEARTBEAT_INTERVAL,
  RECONNECT_DELAY,
  MAX_MOBILE_MESSAGES,
  MAX_COMPLETED_TOOLS,
  E2E_PENDING_TIMEOUT_MS,
} from './utils/config';
import { colors } from './utils/colors';
import { refreshIdToken } from './auth';
import { findClaudePath, getSessionFilePath } from './claude/process';
import type { AppContext } from './context';
import type { PermissionPrompt } from './claude/types';

/**
 * Connect to bridge server and set up handlers
 */
export function connectToBridge(ctx: AppContext): void {
  const { log, logStatus } = ctx.callbacks;
  const targetUrl = ctx.options.agentUrl || ctx.options.bridgeUrl || DEFAULT_BRIDGE_URL;
  const isAgentMode = !!ctx.options.agentUrl;

  if (isAgentMode) {
    logStatus(`Connecting to local agent: ${targetUrl}`);
  } else {
    logStatus(`Connecting to bridge: ${targetUrl}`);
  }

  ctx.isAuthenticated = false;
  ctx.bridgeSocket = new WebSocket(targetUrl);

  ctx.bridgeSocket.on('open', () => {
    logStatus('Connected to bridge server');
    ctx.bridgeSocket?.send(JSON.stringify({
      type: 'authenticate',
      token: ctx.authToken || 'dev-mode',
    }));

    if (ctx.heartbeatTimer) clearInterval(ctx.heartbeatTimer);
    ctx.heartbeatTimer = setInterval(() => {
      if (ctx.bridgeSocket?.readyState === WebSocket.OPEN) {
        ctx.bridgeSocket.ping();
      }
    }, HEARTBEAT_INTERVAL);
  });

  ctx.bridgeSocket.on('message', (raw) => {
    try {
      handleBridgeMessage(ctx, JSON.parse(raw.toString()));
    } catch (err) {
      logStatus(`Invalid bridge message: ${err instanceof Error ? err.message : err}`);
    }
  });

  ctx.bridgeSocket.on('close', () => {
    logStatus('Disconnected from bridge');
    ctx.bridgeSocket = null;
    if (ctx.heartbeatTimer) {
      clearInterval(ctx.heartbeatTimer);
      ctx.heartbeatTimer = null;
    }
    if (!ctx.isShuttingDown) {
      logStatus(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
      ctx.reconnectTimer = setTimeout(() => connectToBridge(ctx), RECONNECT_DELAY);
    }
  });

  ctx.bridgeSocket.on('error', (err: Error & { code?: string }) => {
    if (isAgentMode && err.code === 'ECONNREFUSED') {
      console.log(`Cannot connect to vibe-agent at ${targetUrl}\nRun: vibe-agent`);
      process.exit(1);
    }
    logStatus(`Bridge error: ${err.message}`);
  });
}

/**
 * Send data to bridge
 */
export function sendToBridge(ctx: AppContext, data: Record<string, unknown>): boolean {
  if (!ctx.isAuthenticated || ctx.bridgeSocket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    let dataToSend = data;
    if (ctx.options.e2eEnabled && ctx.e2e?.isReady()) {
      const sensitiveFields = ['content', 'fullText', 'displayText', 'question', 'data'];
      dataToSend = { ...data };
      for (const field of sensitiveFields) {
        if (data[field] !== undefined) {
          dataToSend[field] = ctx.e2e.encrypt(data[field]);
        }
      }
    }
    ctx.bridgeSocket.send(JSON.stringify(dataToSend));
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle bridge messages
 */
function handleBridgeMessage(ctx: AppContext, msg: Record<string, unknown>): void {
  const { log, logStatus } = ctx.callbacks;

  switch (msg.type) {
    case 'authenticated':
      ctx.isAuthenticated = true;
      log('Authenticated with bridge', colors.green);
      ctx.bridgeSocket?.send(JSON.stringify({
        type: 'register_session',
        sessionId: ctx.effectiveSessionId,
        path: process.cwd(),
        name: ctx.options.sessionName || path.basename(process.cwd()),
        e2e: ctx.options.e2eEnabled,
      }));
      if (ctx.options.e2eEnabled && ctx.e2e) {
        ctx.e2e.init();
        if (!ctx.e2e.isReady()) {
          ctx.bridgeSocket?.send(JSON.stringify(ctx.e2e.createKeyExchangeMessage(true)));
        }
      }
      break;

    case 'auth_error':
      ctx.isAuthenticated = false;
      log(`Auth failed: ${msg.message}`, colors.red);
      refreshIdToken().then(token => {
        if (token) {
          ctx.authToken = token;
          ctx.bridgeSocket?.send(JSON.stringify({ type: 'authenticate', token }));
        } else {
          log('Please re-login: vibe login', colors.red);
          process.exit(1);
        }
      });
      break;

    case 'user_message':
      handleUserMessage(ctx, msg);
      break;

    case 'key_exchange':
      if (ctx.e2e?.handleKeyExchange(msg) && ctx.e2e.isReady()) {
        log('E2E encryption established', colors.green);
        for (const p of ctx.e2ePendingMessages) {
          if (Date.now() - p.timestamp < E2E_PENDING_TIMEOUT_MS) {
            handleBridgeMessage(ctx, p.msg as Record<string, unknown>);
          }
        }
        ctx.e2ePendingMessages.length = 0;
      }
      break;

    case 'permission_response':
      ctx.callbacks.sendToClaude(msg.approved ? 'y' : 'n', 'permission');
      ctx.pendingPermission = null;
      break;
  }
}

/**
 * Handle user message from mobile
 */
function handleUserMessage(ctx: AppContext, msg: Record<string, unknown>): void {
  let content = msg.content as string;

  // Decrypt if E2E
  if (ctx.e2e?.isReady()) {
    const obj = msg.content as Record<string, unknown>;
    if (obj?.e2e === true) {
      try { content = ctx.e2e.decrypt(obj) as string; } catch { return; }
    }
  }

  // Dedupe
  const hash = Buffer.from(content).toString('base64').slice(0, 32);
  if (ctx.mobileMessageHashes.has(hash)) return;
  ctx.mobileMessageHashes.add(hash);
  if (ctx.mobileMessageHashes.size > MAX_MOBILE_MESSAGES) {
    const first = ctx.mobileMessageHashes.values().next().value;
    if (first) ctx.mobileMessageHashes.delete(first);
  }

  ctx.callbacks.log(`[mobile]: ${content}`, colors.cyan);
  ctx.callbacks.sendToClaude(content, 'mobile');
}

/**
 * Send to Claude stdin
 */
export function sendToClaude(ctx: AppContext, content: string): boolean {
  if (!ctx.claudeProcess?.stdin?.writable || !ctx.isRunning) return false;
  try {
    ctx.claudeProcess.stdin.write(Buffer.from(content, 'utf8'));
    setTimeout(() => {
      ctx.claudeProcess?.stdin?.writable && ctx.claudeProcess.stdin.write('\r');
    }, 100);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Claude process
 */
export function startClaude(ctx: AppContext): void {
  const { log, logStatus } = ctx.callbacks;
  const claudePath = findClaudePath();
  const claudeArgs = ctx.options.resumeSessionId
    ? ['--resume', ctx.sessionId]
    : ['--session-id', ctx.sessionId];

  if (ctx.options.skipPermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  const dirname = __dirname.includes('/dist/') ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
  const wrapper = ctx.options.useNodePty ? 'pty-wrapper-node.js' : 'pty-wrapper.py';
  const wrapperPath = path.join(dirname, wrapper);
  const cmd = ctx.options.useNodePty ? 'node' : 'python3';
  const args = ctx.options.useNodePty ? [wrapperPath, claudePath, ...claudeArgs] : ['-u', wrapperPath, claudePath, ...claudeArgs];

  if (!fs.existsSync(wrapperPath)) {
    log(`Error: ${wrapper} not found`, colors.red);
    process.exit(1);
  }

  ctx.claudeProcess = spawn(cmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' },
    stdio: ctx.options.agentUrl ? ['pipe', 'ignore', 'ignore', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'],
  });
  ctx.isRunning = true;

  const stdio = ctx.claudeProcess.stdio as (NodeJS.ReadableStream | null)[];
  stdio[4]?.on('data', (data: Buffer) => {
    sendToBridge(ctx, { type: 'terminal_output', sessionId: ctx.effectiveSessionId, data: data.toString('base64') });
  });

  let promptBuf = '';
  stdio[3]?.on('data', (data: Buffer) => {
    promptBuf += data.toString();
    const lines = promptBuf.split('\n');
    promptBuf = lines.pop() || '';
    for (const line of lines) {
      try {
        const p = JSON.parse(line) as PermissionPrompt;
        if (p.type === 'permission_prompt') {
          sendToBridge(ctx, {
            type: 'permission_request',
            sessionId: ctx.effectiveSessionId,
            tool_name: p.tool_name,
            tool_input: p.tool_input,
            prompt_id: p.prompt_id,
          });
        }
      } catch { /* not json */ }
    }
  });

  ctx.claudeProcess.on('exit', (code) => {
    ctx.isRunning = false;
    cleanup(ctx);
    process.exit(code || 0);
  });

  ctx.claudeProcess.on('error', (err) => {
    log(`Failed to start Claude: ${err.message}`, colors.red);
    process.exit(1);
  });

  startSessionWatcher(ctx);
}

/**
 * Watch session file for Claude messages
 */
function startSessionWatcher(ctx: AppContext): void {
  const sessionFile = getSessionFilePath(ctx.sessionId);
  const check = setInterval(() => {
    if (fs.existsSync(sessionFile)) {
      clearInterval(check);
      try {
        const watcher = fs.watch(sessionFile, () => processSessionFile(ctx, sessionFile));
        ctx.sessionFileWatcher = () => watcher.close();
        processSessionFile(ctx, sessionFile);
      } catch { /* ignore */ }
    }
  }, 1000);
  ctx.sessionFileWatcher = () => clearInterval(check);
}

/**
 * Process session file for new messages
 */
function processSessionFile(ctx: AppContext, file: string): void {
  try {
    const stats = fs.statSync(file);
    if (stats.size <= ctx.lastFileSize) return;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').slice(ctx.lastFileSize > 0 ? -10 : 0);
    ctx.lastFileSize = stats.size;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'assistant' && msg.message) {
          sendToBridge(ctx, { type: 'claude_message', sessionId: ctx.effectiveSessionId, message: msg.message });
        }
        // Track completed tools
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'tool_result' && b.tool_use_id) {
              ctx.completedToolIds.add(b.tool_use_id);
              if (ctx.completedToolIds.size > MAX_COMPLETED_TOOLS) {
                const first = ctx.completedToolIds.values().next().value;
                if (first) ctx.completedToolIds.delete(first);
              }
            }
          }
        }
      } catch { /* not json */ }
    }
  } catch { /* file not ready */ }
}

/**
 * Setup terminal input forwarding
 */
export function setupTerminalInput(ctx: AppContext): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    if (data.toString() === '\x03') { cleanup(ctx); process.exit(0); }
    ctx.claudeProcess?.stdin?.writable && ctx.claudeProcess.stdin.write(data);
  });
}

/**
 * Setup shutdown handlers
 */
export function setupShutdown(ctx: AppContext): void {
  const shutdown = () => { if (!ctx.isShuttingDown) { cleanup(ctx); process.exit(0); } };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

/**
 * Cleanup all resources
 */
export function cleanup(ctx: AppContext): void {
  ctx.isShuttingDown = true;
  if (ctx.heartbeatTimer) clearInterval(ctx.heartbeatTimer);
  if (ctx.reconnectTimer) clearTimeout(ctx.reconnectTimer);
  if (ctx.sessionFileWatcher) ctx.sessionFileWatcher();
  if (ctx.bridgeSocket) ctx.bridgeSocket.close();
  if (ctx.claudeProcess && !ctx.claudeProcess.killed) ctx.claudeProcess.kill('SIGTERM');
}
