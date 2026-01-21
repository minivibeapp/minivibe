#!/usr/bin/env node

/**
 * vibe-cli - Claude Code with mobile remote control
 * Thin CLI entry point: argument parsing + module wiring
 */

import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { DEFAULT_BRIDGE_URL, DEFAULT_AGENT_URL, AGENT_PORT_FILE } from './utils/config';
import { colors } from './utils/colors';
import { clearAuth, ensureValidToken, startLoginFlow, startHeadlessLogin } from './auth';
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
  const shortcuts: Record<string, string> = { login: '--login', logout: '--logout', status: '--status', help: '--help' };
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
    else if (a === '--help' || a === '-h') options.helpMode = true;
    else if (a === '--headless') options.headlessMode = true;
    else if (a === '--verbose' || a === '-v') options.verboseMode = true;
    else if (a === '--e2e') options.e2eEnabled = true;
    else if (a === '--node-pty') options.useNodePty = true;
    else if (a === '--dangerously-skip-permissions') options.skipPermissions = true;
    else if (a === '--list') options.listSessions = true;
    else if (a === '--bridge') options.bridgeUrl = args[++i] || null;
    else if (a === '--agent') options.agentUrl = args[++i] || discoverAgent();
    else if (a === '--resume' || a === '-r') options.resumeSessionId = args[++i] || null;
    else if (a === '--name') options.sessionName = args[++i] || null;
    else if (a === '--remote') { options.remoteAttachMode = true; options.resumeSessionId = args[++i] || null; }
    else if (a === '--token') i++; // skip token value
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

  // Simple modes
  if (options.helpMode) { showHelp(); process.exit(0); }
  if (options.loginMode) { await (options.headlessMode ? startHeadlessLogin() : startLoginFlow()); return; }
  if (options.logoutMode) { clearAuth(); console.log('Logged out'); process.exit(0); }

  // TODO: Handle subcommands (file upload, session list, etc.)
  if (subcommand) {
    console.log(`Subcommand ${subcommand.group} ${subcommand.action} not yet implemented in new CLI`);
    process.exit(1);
  }

  // Check Claude installed
  if (!checkClaudeInstalled()) { showClaudeNotFoundMessage(); process.exit(1); }

  // Check auth
  if (!options.agentUrl) {
    const token = await ensureValidToken();
    if (!token) { showWelcomeMessage(); process.exit(1); }
  }

  // Create context
  const sessionId = options.resumeSessionId || uuidv4();
  const ctx = createAppContext(sessionId, process.env.VIBE_SESSION_ID || sessionId, options);
  ctx.authToken = await ensureValidToken();
  if (options.e2eEnabled && e2eModule) ctx.e2e = e2eModule;

  // Setup logging
  ctx.callbacks.log = (msg, color = '') => console.log(`${color}${msg}${colors.reset}`);
  ctx.callbacks.logStderr = (msg, color = '') => process.stderr.write(`${color}${msg}${colors.reset}\n`);
  ctx.callbacks.logStatus = (msg) => {
    if (options.verboseMode) {
      const ts = new Date().toISOString().substr(11, 8);
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

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
