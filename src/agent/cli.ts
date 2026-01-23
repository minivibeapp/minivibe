#!/usr/bin/env node

import * as fs from 'fs';
import WebSocket from 'ws';
import { colors } from '../utils/colors';
import {
  DEFAULT_BRIDGE_URL,
  LOCAL_SERVER_PORT,
  PAIRING_URL,
  AUTH_FILE,
  AGENT_PID_FILE,
  AGENT_START_TIME_FILE,
  AGENT_PORT_FILE,
} from '../utils/config';
import { getStoredAuth, storeAuth, clearAuth, getUserInfo } from '../auth';
import { agentState } from './state';
import { connect } from './bridge';
import { startLocalServer, stopLocalServer } from './local-server';
import { log, showWelcomeMessage, printHelp } from './utils';
import type { AgentOptions } from './types';

/**
 * Parse CLI arguments
 */
function parseArgs(): AgentOptions {
  const rawArgs = process.argv.slice(2);

  // Support subcommand style
  const subcommands: Record<string, string> = {
    login: '--login',
    logout: '--logout',
    status: '--status',
    whoami: '--whoami',
    help: '--help',
  };

  const args =
    rawArgs.length > 0 && subcommands[rawArgs[0]]
      ? [subcommands[rawArgs[0]], ...rawArgs.slice(1)]
      : rawArgs;

  const options: AgentOptions = {
    bridge: null,
    token: null,
    login: false,
    logout: false,
    name: null,
    status: false,
    whoami: false,
    help: false,
    e2e: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--bridge': {
        const url = args[++i];
        if (!url || url.startsWith('-')) {
          console.error(`${colors.red}✗ --bridge requires a URL${colors.reset}`);
          console.error(`  Usage: vibe-agent --bridge <url>`);
          process.exit(1);
        }
        options.bridge = url;
        break;
      }
      case '--token': {
        const token = args[++i];
        if (!token || token.startsWith('-')) {
          console.error(`${colors.red}✗ --token requires a value${colors.reset}`);
          console.error(`  Usage: vibe-agent --token <firebase-token>`);
          process.exit(1);
        }
        options.token = token;
        break;
      }
      case '--login':
        options.login = true;
        break;
      case '--logout':
        options.logout = true;
        break;
      case '--name': {
        const name = args[++i];
        if (!name || name.startsWith('-')) {
          console.error(`${colors.red}✗ --name requires a value${colors.reset}`);
          console.error(`  Usage: vibe-agent --name <host-name>`);
          process.exit(1);
        }
        options.name = name;
        break;
      }
      case '--status':
        options.status = true;
        break;
      case '--whoami':
        options.whoami = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--e2e':
        options.e2e = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`${colors.red}✗ Unknown option: ${arg}${colors.reset}`);
          console.error(`  Run: vibe-agent --help`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Headless login flow using device code
 */
async function startHeadlessLogin(bridgeHttpUrl: string): Promise<void> {
  console.log(`
${colors.cyan}${colors.bold}vibe-agent Headless Login${colors.reset}
${'='.repeat(40)}
`);

  try {
    log('Requesting device code...', colors.dim);
    const codeRes = await fetch(`${bridgeHttpUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!codeRes.ok) {
      log(`Failed to get device code: ${codeRes.status}`, colors.red);
      process.exit(1);
    }

    const { deviceId, code, expiresIn } = (await codeRes.json()) as {
      deviceId: string;
      code: string;
      expiresIn: number;
    };

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
      await new Promise((r) => setTimeout(r, pollInterval));

      try {
        const pollRes = await fetch(`${bridgeHttpUrl}/device/poll/${deviceId}`);
        const pollData = (await pollRes.json()) as {
          status?: string;
          token?: string;
          refreshToken?: string;
          email?: string;
          error?: string;
        };

        if (pollData.status === 'complete' && pollData.token) {
          storeAuth(pollData.token, pollData.refreshToken || null);
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
      } catch {
        process.stdout.write('!');
      }
    }

    console.log('\n\nLogin timed out.');
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Login failed: ${message}`, colors.red);
    process.exit(1);
  }
}

/**
 * Show agent status
 */
async function showStatus(options: AgentOptions): Promise<void> {
  const state = agentState;
  const config = state.loadConfig();

  const bridgeUrl = options.bridge || config.bridgeUrl || DEFAULT_BRIDGE_URL;
  const hostName = options.name || config.hostName || state.hostName;
  const auth = getStoredAuth();

  console.log(`${colors.cyan}${colors.bold}vibe-agent${colors.reset}`);
  console.log();

  // Check if agent is running
  let isRunning = false;
  let pid: number | null = null;
  let uptime: string | null = null;

  try {
    if (fs.existsSync(AGENT_PID_FILE)) {
      pid = parseInt(fs.readFileSync(AGENT_PID_FILE, 'utf8').trim(), 10);
      try {
        process.kill(pid, 0);
        isRunning = true;

        if (fs.existsSync(AGENT_START_TIME_FILE)) {
          const startTime = parseInt(fs.readFileSync(AGENT_START_TIME_FILE, 'utf8').trim(), 10);
          const uptimeMs = Date.now() - startTime;
          if (uptimeMs > 0 && !isNaN(startTime)) {
            const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
            const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
            uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          }
        }
      } catch {
        isRunning = false;
      }
    }
  } catch {
    // Ignore
  }

  // Get session count
  let sessionCount: number | null = null;
  if (isRunning && fs.existsSync(AGENT_PORT_FILE)) {
    try {
      const portStr = fs.readFileSync(AGENT_PORT_FILE, 'utf8').trim();
      const port = parseInt(portStr, 10);

      if (!isNaN(port) && port > 0) {
        const result = await new Promise<number | null>((resolve) => {
          const checkWs = new WebSocket(`ws://localhost:${port}`);
          const timeout = setTimeout(() => {
            try {
              checkWs.close();
            } catch {
              // Ignore
            }
            resolve(null);
          }, 1000);

          checkWs.on('open', () => {
            checkWs.send(JSON.stringify({ type: 'list_sessions' }));
          });

          checkWs.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString()) as { type: string; sessions?: unknown[] };
              if (msg.type === 'sessions_list') {
                clearTimeout(timeout);
                resolve(msg.sessions?.length || 0);
                try {
                  checkWs.close();
                } catch {
                  // Ignore
                }
              }
            } catch {
              // Ignore
            }
          });

          checkWs.on('error', () => {
            clearTimeout(timeout);
            resolve(null);
          });

          checkWs.on('close', () => {
            clearTimeout(timeout);
          });
        });
        sessionCount = result;
      }
    } catch {
      // Ignore
    }
  }

  // Display status
  if (isRunning) {
    console.log(`Status:     ${colors.green}running${colors.reset} (pid ${pid})`);
    if (uptime) {
      console.log(`Uptime:     ${uptime}`);
    }
  } else {
    console.log(`Status:     ${colors.dim}not running${colors.reset}`);
  }

  console.log(`Host:       ${hostName}`);
  console.log(`Bridge:     ${bridgeUrl}`);

  if (sessionCount !== null) {
    console.log(`Sessions:   ${sessionCount} active`);
  }

  console.log();
  console.log(
    `Auth:       ${auth?.idToken ? colors.green + 'configured' + colors.reset : colors.yellow + 'not configured' + colors.reset}`
  );
  console.log(
    `Agent ID:   ${config.agentId || colors.dim + 'will be assigned on first connect' + colors.reset}`
  );

  process.exit(0);
}

/**
 * Shutdown handler
 */
function setupShutdown(): void {
  const state = agentState;

  const shutdown = (): void => {
    log('Shutting down...', colors.yellow);

    // Stop all sessions
    for (const [sessionId, session] of state.runningSessions) {
      log(`Stopping session ${sessionId.slice(0, 8)}`, colors.dim);
      if (session.process) {
        try {
          if (process.platform === 'win32') {
            session.process.kill();
          } else {
            session.process.kill('SIGTERM');
          }
        } catch {
          // Ignore
        }
      } else if (session.localWs) {
        try {
          session.localWs.close(1001, 'Agent shutting down');
        } catch {
          // Ignore
        }
      }
    }

    stopLocalServer();

    if (state.ws) {
      state.ws.close();
    }

    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', shutdown);
  if (process.platform !== 'win32') {
    process.on('SIGTERM', shutdown);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const state = agentState;

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Load saved config
  const config = state.loadConfig();

  state.bridgeUrl = options.bridge || config.bridgeUrl || DEFAULT_BRIDGE_URL;
  state.hostName = options.name || config.hostName || state.hostName;
  state.agentId = config.agentId || null;
  state.e2eEnabled = options.e2e || config.e2e || false;

  if (options.token) {
    state.authToken = options.token;
    storeAuth(state.authToken);
  } else {
    const auth = getStoredAuth();
    state.authToken = auth?.idToken || null;
  }

  // Save config for next time
  if (options.bridge) {
    config.bridgeUrl = state.bridgeUrl;
  }
  if (options.name) {
    config.hostName = state.hostName;
  }
  if (options.e2e) {
    config.e2e = true;
  }
  state.saveConfig(config);

  // Status check
  if (options.status) {
    await showStatus(options);
    return;
  }

  // Logout flow
  if (options.logout) {
    if (getStoredAuth()) {
      clearAuth();
      log('Logged out successfully', colors.green);
    } else {
      log('Not logged in', colors.yellow);
    }
    process.exit(0);
  }

  // Whoami flow
  if (options.whoami) {
    const user = getUserInfo();
    if (!user) {
      console.log('Not logged in. Run: vibe-agent login');
      process.exit(1);
    }
    console.log(`${colors.green}Logged in as:${colors.reset}`);
    if (user.name) console.log(`  Name:  ${user.name}`);
    if (user.email) console.log(`  Email: ${user.email}`);
    process.exit(0);
  }

  // Login flow
  if (options.login) {
    const httpUrl = state.bridgeUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    await startHeadlessLogin(httpUrl);
    return;
  }

  // Require auth
  if (!state.authToken) {
    showWelcomeMessage();
    process.exit(1);
  }

  // Banner
  console.log(`
${colors.cyan}${colors.bold}vibe-agent${colors.reset}
${'='.repeat(40)}
   Host:   ${state.hostName}
   Bridge: ${state.bridgeUrl}
   Local:  ws://localhost:${LOCAL_SERVER_PORT}
   Auth:   ${state.authToken ? 'Configured' : 'Not configured'}
${'='.repeat(40)}
`);

  // Start local server
  startLocalServer();

  // Connect to bridge
  connect();

  // Setup shutdown handlers
  setupShutdown();
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`, colors.red);
  process.exit(1);
});
