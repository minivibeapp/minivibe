/**
 * Help and welcome messages
 */

import { ui, box, formatError, ErrorSuggestions } from '../utils/terminal';

/**
 * Show welcome message for first-time users (no auth)
 */
export function showWelcomeMessage(): void {
  console.log('');
  console.log(ui.brand('Welcome to MiniVibe!'));
  console.log('');
  console.log('MiniVibe lets you control Claude Code from your iPhone.');
  console.log('');
  console.log(ui.highlight('To get started:'));
  console.log('  1. Download MiniVibe from the App Store');
  console.log(`  2. Run: ${ui.accent('vibe login')}`);
  console.log('');
  console.log(ui.dim(`For help: vibe help`));
  console.log('');
}

/**
 * Show error when Claude Code is not installed
 */
export function showClaudeNotFoundMessage(): void {
  console.log('');
  console.log(formatError({
    message: 'Claude Code not found',
    code: 'CLAUDE_NOT_INSTALLED',
    details: 'MiniVibe requires Claude Code CLI to be installed.',
    suggestions: ErrorSuggestions.CLAUDE_NOT_FOUND,
  }));
  console.log('');
}

/**
 * Show CLI help text
 */
export function showHelp(): void {
  console.log('');
  console.log(ui.brand('MiniVibe') + ui.dim(' - Control Claude Code from your iPhone'));
  console.log('');

  // Usage section
  console.log(ui.highlight('Usage:'));
  console.log(`  ${ui.accent('vibe')}                         Start interactive session`);
  console.log(`  ${ui.accent('vibe "prompt"')}                Start session with prompt`);
  console.log(`  ${ui.accent('vibe --resume <id>')}          Resume existing session`);
  console.log('');

  // Authentication section
  console.log(ui.highlight('Authentication:'));
  console.log(`  ${ui.accent('vibe login')}                   Login with your MiniVibe account`);
  console.log(`  ${ui.accent('vibe login --headless')}        Login without opening browser`);
  console.log(`  ${ui.accent('vibe whoami')}                  Show logged-in user info`);
  console.log(`  ${ui.accent('vibe logout')}                  Log out and clear credentials`);
  console.log('');

  // Options section
  console.log(ui.highlight('Options:'));
  console.log(`  ${ui.dim('--resume, -r <id>')}           Resume a session by ID`);
  console.log(`  ${ui.dim('--name <name>')}               Name this session`);
  console.log(`  ${ui.dim('--bridge <url>')}              Custom bridge server URL`);
  console.log(`  ${ui.dim('--agent')}                     Connect via local vibe-agent`);
  console.log(`  ${ui.dim('--node-pty')}                  Use Node.js PTY wrapper`);
  console.log(`  ${ui.dim('--e2e')}                       Enable end-to-end encryption`);
  console.log(`  ${ui.dim('--json')}                      Output in JSON format`);
  console.log(`  ${ui.dim('--verbose, -v')}               Enable verbose logging`);
  console.log(`  ${ui.dim('-y, --yolo')}                  Skip all permission prompts`);
  console.log(`  ${ui.dim('--help, -h')}                  Show this help`);
  console.log('');

  // In-session commands
  console.log(ui.highlight('In-session Commands:'));
  console.log(`  ${ui.accent('/whoami')}                     Show logged-in user`);
  console.log(`  ${ui.accent('/name <name>')}                Rename current session`);
  console.log(`  ${ui.accent('/info')}                       Show session details`);
  console.log(`  ${ui.accent('/upload <path>')}              Upload file to cloud storage`);
  console.log(`  ${ui.accent('/download <id>')}              Download file by ID`);
  console.log(`  ${ui.accent('/files')}                      List uploaded files`);
  console.log(`  ${ui.accent('/help')}                       Show available commands`);
  console.log('');

  // Examples section
  console.log(ui.highlight('Examples:'));
  console.log(`  ${ui.dim('$')} vibe`);
  console.log(`  ${ui.dim('$')} vibe "help me fix this bug"`);
  console.log(`  ${ui.dim('$')} vibe --resume abc123`);
  console.log(`  ${ui.dim('$')} vibe --name "my-project"`);
  console.log('');

  console.log(ui.dim('For more info: https://github.com/minivibeapp/minivibe'));
  console.log('');
}

/**
 * Show version information
 */
export function showVersion(version: string): void {
  console.log(`${ui.brand('minivibe')} ${ui.dim(`v${version}`)}`);
}

/**
 * Show session banner
 */
export function showSessionBanner(
  sessionId: string,
  sessionName: string | null,
  bridgeUrl: string,
  e2eEnabled: boolean
): void {
  console.log('');
  console.log(box('MiniVibe - Control Claude from iPhone', { title: 'Session', padding: 0 }));
  console.log('');
  console.log(`  ${ui.dim('Session:')}  ${sessionId.slice(0, 8)}...${sessionName ? ` ${ui.accent(`(${sessionName})`)}` : ''}`);
  console.log(`  ${ui.dim('Bridge:')}   ${bridgeUrl}`);
  console.log(`  ${ui.dim('E2E:')}      ${e2eEnabled ? ui.success('enabled') : ui.dim('disabled')}`);
  console.log('');
  console.log(ui.dim('Type /help for in-session commands.'));
  console.log('');
}
