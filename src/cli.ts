#!/usr/bin/env node

/**
 * vibe-cli - Claude Code with mobile remote control
 * Thin CLI entry point: argument parsing + module wiring
 */

import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { DEFAULT_BRIDGE_URL, DEFAULT_AGENT_URL, AGENT_PORT_FILE } from './utils/config';
import { colors } from './utils/colors';
import {
  ui,
  formatError,
  setJsonOutputMode,
  isJsonOutputMode,
  output,
} from './utils/terminal';
import { clearAuth, ensureValidToken, startLoginFlow, startHeadlessLogin, getUserInfo, getStoredAuth } from './auth';
import { showWelcomeMessage, showClaudeNotFoundMessage, showHelp } from './commands/help';
import { checkClaudeInstalled } from './claude/process';
import { createAppContext, createDefaultOptions, type CliOptions, type SubcommandMode } from './context';
import { connectToBridge, sendToBridge, sendToClaude, startClaude, setupTerminalInput, setupShutdown } from './core';

// E2E module (optional JavaScript)
let e2eModule: any = null;
try { e2eModule = require('../e2e'); } catch { /* not available */ }

/**
 * Discover local vibe-agent
 */
function discoverAgent(): string {
  try {
    if (fs.existsSync(AGENT_PORT_FILE)) {
      return `ws://localhost:${fs.readFileSync(AGENT_PORT_FILE, 'utf8').trim()}`;
    }
  } catch { /* ignore */ }
  return DEFAULT_AGENT_URL;
}

/**
 * Parse command line arguments
 */
function parseArgs(argv: string[]): { options: CliOptions; subcommand: SubcommandMode | null } {
  const options = createDefaultOptions();
  let subcommand: SubcommandMode | null = null;

  // Subcommand shortcuts
  const shortcuts: Record<string, string> = { login: '--login', logout: '--logout', status: '--status', help: '--help', whoami: '--whoami' };
  const groups: Record<string, string[]> = {
    file: ['upload', 'list', 'download', 'delete'],
    session: ['list', 'rename', 'info'],
  };

  // Check multi-level subcommands (file upload, session list, etc.)
  if (argv.length >= 2 && groups[argv[0]]?.includes(argv[1])) {
    subcommand = { group: argv[0], action: argv[1] };
    return { options, subcommand };
  }

  // Transform shortcuts
  const args = argv.length > 0 && shortcuts[argv[0]] ? [shortcuts[argv[0]], ...argv.slice(1)] : argv;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--login') options.loginMode = true;
    else if (a === '--logout') options.logoutMode = true;
    else if (a === '--status') options.statusMode = true;
    else if (a === '--whoami') options.whoamiMode = true;
    else if (a === '--help' || a === '-h') options.helpMode = true;
    else if (a === '--headless') options.headlessMode = true;
    else if (a === '--verbose' || a === '-v') options.verboseMode = true;
    else if (a === '--json') options.jsonMode = true;
    else if (a === '--e2e') options.e2eEnabled = true;
    else if (a === '--node-pty') options.useNodePty = true;
    else if (a === '--dangerously-skip-permissions' || a === '--yolo' || a === '-y') options.skipPermissions = true;
    else if (a === '--list') options.listSessions = true;
    else if (a === '--bridge') {
      const nextArg = args[i + 1];
      const url = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
      if (!url) {
        console.log(formatError({
          message: '--bridge requires a URL',
          suggestions: ['Usage: vibe --bridge <url>', 'Example: vibe --bridge wss://custom.server.com'],
        }));
        process.exit(1);
      }
      options.bridgeUrl = url;
    }
    else if (a === '--agent') {
      const nextArg = args[i + 1];
      options.agentUrl = (nextArg && !nextArg.startsWith('-')) ? args[++i] : discoverAgent();
    }
    else if (a === '--resume' || a === '-r') {
      const nextArg = args[i + 1];
      const sessionId = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
      if (!sessionId) {
        console.log(formatError({
          message: '--resume requires a session ID',
          suggestions: ['Usage: vibe --resume <session-id>'],
        }));
        process.exit(1);
      }
      options.resumeSessionId = sessionId;
    }
    else if (a === '--name') {
      const nextArg = args[i + 1];
      const name = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
      if (!name) {
        console.log(formatError({
          message: '--name requires a value',
          suggestions: ['Usage: vibe --name <session-name>'],
        }));
        process.exit(1);
      }
      options.sessionName = name;
    }
    else if (a === '--remote') {
      options.remoteAttachMode = true;
      const nextArg = args[i + 1];
      options.resumeSessionId = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
    }
    else if (a === '--attach') {
      options.attachMode = true;
      const nextArg = args[i + 1];
      options.attachSessionId = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
    }
    else if (a === '--token') {
      const nextArg = args[i + 1];
      const token = (nextArg && !nextArg.startsWith('-')) ? args[++i] : null;
      if (!token) {
        console.log(formatError({
          message: '--token requires a value',
          suggestions: ['Usage: vibe --token <firebase-token>', 'Get token from MiniVibe iOS app: Settings > Copy Token'],
        }));
        process.exit(1);
      }
      options.manualToken = token;
    }
    else if (a.startsWith('-') && a !== '-') {
      console.log(formatError({
        message: `Unknown option: ${a}`,
        suggestions: ['Run: vibe --help'],
      }));
      process.exit(1);
    }
    else if (!a.startsWith('-') && !options.initialPrompt) options.initialPrompt = a;
  }

  return { options, subcommand };
}

/**
 * Show status banner
 */
function showBanner(sessionId: string, options: CliOptions, hasAuth: boolean): void {
  const url = options.agentUrl || options.bridgeUrl || DEFAULT_BRIDGE_URL;
  const mode = options.agentUrl ? 'Local (vibe-agent)' : 'Cloud (bridge)';
  console.log(`
${colors.bright}${colors.magenta}vibe-cli${colors.reset}
${colors.dim}${'═'.repeat(38)}
   Session:  ${sessionId.slice(0, 8)}...
   Bridge:   ${url}
   Mode:     ${mode}
   Auth:     ${hasAuth ? 'Token stored' : 'Not authenticated'}
   Dir:      ${process.cwd()}
${'═'.repeat(38)}${colors.reset}
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { options, subcommand } = parseArgs(process.argv.slice(2));

  // Enable JSON output mode if requested
  if (options.jsonMode) {
    setJsonOutputMode(true);
  }

  // Simple modes
  if (options.helpMode) { showHelp(); process.exit(0); }
  if (options.loginMode) { await (options.headlessMode ? startHeadlessLogin() : startLoginFlow()); return; }
  if (options.logoutMode) {
    if (getStoredAuth()) {
      clearAuth();
      output({ success: true, message: 'Logged out successfully' }, () => {
        console.log(ui.success('Logged out successfully'));
      });
    } else {
      output({ success: false, message: 'Not logged in' }, () => {
        console.log(ui.warn('Not logged in'));
      });
    }
    process.exit(0);
  }
  if (options.whoamiMode) {
    const user = getUserInfo();
    if (!user) {
      output({ success: false, error: 'Not logged in' }, () => {
        console.log(formatError({
          message: 'Not logged in',
          suggestions: ['Run: vibe login'],
        }));
      });
      process.exit(1);
    }
    output({ success: true, user }, () => {
      console.log(ui.success('Logged in as:'));
      if (user.name) console.log(`  Name:  ${user.name}`);
      if (user.email) console.log(`  Email: ${user.email}`);
    });
    process.exit(0);
  }

  // Validate required arguments for flags that need them
  if (options.remoteAttachMode && !options.resumeSessionId) {
    output({ success: false, error: 'Session ID required' }, () => {
      console.log(formatError({
        message: '--remote requires a session ID',
        suggestions: ['Usage: vibe --remote <session-id>'],
      }));
    });
    process.exit(1);
  }
  if (options.attachMode && !options.attachSessionId) {
    output({ success: false, error: 'Session ID required' }, () => {
      console.log(formatError({
        message: '--attach requires a session ID',
        suggestions: ['Usage: vibe --attach <session-id>', 'Use --list to see running sessions'],
      }));
    });
    process.exit(1);
  }

  // Handle --status mode
  if (options.statusMode) {
    const hasAuth = !!getStoredAuth();
    const user = getUserInfo();
    output({ success: true, status: { authenticated: hasAuth, user } }, () => {
      console.log(ui.highlight('Status:'));
      console.log(`  Auth:     ${hasAuth ? ui.success('Authenticated') : ui.warn('Not authenticated')}`);
      if (user?.email) console.log(`  User:     ${user.email}`);
      console.log(`  Bridge:   ${options.bridgeUrl || 'wss://ws.minivibeapp.com (default)'}`);
    });
    process.exit(0);
  }

  // Handle --list mode (requires agent)
  if (options.listSessions) {
    output({ success: false, error: 'Not implemented' }, () => {
      console.log(ui.warn('--list requires vibe-agent. Use: vibe-agent status'));
    });
    process.exit(1);
  }

  // Handle --attach mode (requires agent)
  if (options.attachMode) {
    if (!options.agentUrl) {
      // Auto-discover agent
      options.agentUrl = discoverAgent();
    }
    output({ success: false, error: 'Not implemented' }, () => {
      console.log(ui.warn('--attach mode not yet implemented in refactored CLI'));
      console.log(ui.dim('Session ID: ' + options.attachSessionId));
    });
    process.exit(1);
  }

  // TODO: Handle subcommands (file upload, session list, etc.)
  if (subcommand) {
    output({ success: false, error: 'Not implemented' }, () => {
      console.log(ui.warn(`Subcommand ${subcommand.group} ${subcommand.action} not yet implemented`));
    });
    process.exit(1);
  }

  // Check Claude installed (not required for --remote mode)
  if (!options.remoteAttachMode && !checkClaudeInstalled()) {
    if (isJsonOutputMode()) {
      console.log(JSON.stringify({ success: false, error: 'Claude Code not found' }));
    } else {
      showClaudeNotFoundMessage();
    }
    process.exit(1);
  }

  // Handle --remote mode (no local Claude needed)
  if (options.remoteAttachMode) {
    output({ success: false, error: 'Not implemented' }, () => {
      console.log(ui.warn('--remote mode not yet implemented in refactored CLI'));
      console.log(ui.dim('Session ID: ' + options.resumeSessionId));
      console.log(ui.dim('This mode will allow controlling sessions without local Claude.'));
    });
    process.exit(1);
  }

  // Check auth (manual token overrides stored token)
  let authToken: string | null = options.manualToken;
  if (!authToken && !options.agentUrl) {
    authToken = await ensureValidToken();
    if (!authToken) {
      if (isJsonOutputMode()) {
        console.log(JSON.stringify({ success: false, error: 'Not authenticated' }));
      } else {
        showWelcomeMessage();
      }
      process.exit(1);
    }
  }

  // Create context
  const sessionId = options.resumeSessionId || uuidv4();
  const ctx = createAppContext(sessionId, process.env.VIBE_SESSION_ID || sessionId, options);
  ctx.authToken = authToken;
  if (options.e2eEnabled && e2eModule) ctx.e2e = e2eModule;

  // Setup logging
  ctx.callbacks.log = (msg, color = '') => console.log(`${color}${msg}${colors.reset}`);
  ctx.callbacks.logStderr = (msg, color = '') => process.stderr.write(`${color}${msg}${colors.reset}\n`);
  ctx.callbacks.logStatus = (msg) => {
    if (options.verboseMode) {
      const ts = new Date().toISOString().slice(11, 19);
      process.stderr.write(`${colors.dim}[vibe ${ts}] ${msg}${colors.reset}\n`);
    }
  };
  ctx.callbacks.sendToBridge = (data) => sendToBridge(ctx, data);
  ctx.callbacks.sendToClaude = (content, source) => sendToClaude(ctx, content);

  // Show banner and start
  showBanner(sessionId, options, !!ctx.authToken);
  setupShutdown(ctx);
  connectToBridge(ctx);
  startClaude(ctx);
  setupTerminalInput(ctx);
}

main().catch((err) => {
  if (isJsonOutputMode()) {
    console.log(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }));
  } else {
    console.log(formatError({
      message: err instanceof Error ? err.message : 'Unknown error',
      code: 'UNEXPECTED_ERROR',
      suggestions: ['Try running with --verbose for more details'],
    }));
  }
  process.exit(1);
});
