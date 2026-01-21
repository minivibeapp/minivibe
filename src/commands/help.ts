/**
 * Help and welcome messages
 */

/**
 * Show welcome message for first-time users (no auth)
 */
export function showWelcomeMessage(): void {
  console.log(`
Welcome to MiniVibe!

MiniVibe lets you control Claude Code from your iPhone.

To get started:
  1. Download MiniVibe from the App Store
  2. Run: vibe login

For help: vibe help
`);
}

/**
 * Show error when Claude Code is not installed
 */
export function showClaudeNotFoundMessage(): void {
  console.log(`
Claude Code not found

MiniVibe requires Claude Code CLI to be installed.

Install Claude Code:
  https://claude.ai/download

After installing, run:
  vibe login
`);
}

/**
 * Show CLI help text
 */
export function showHelp(): void {
  console.log(`
MiniVibe - Control Claude Code from your iPhone

Usage:
  vibe                         Start interactive session
  vibe "your prompt here"      Start session with prompt
  vibe --resume <id>           Resume existing session

Authentication:
  vibe login                   Login with your MiniVibe account
  vibe login --headless        Login without opening browser

Options:
  --resume, -r <id>           Resume a session by ID
  --name <name>               Name this session
  --bridge <url>              Custom bridge server URL
  --agent                     Connect via local vibe-agent
  --node-pty                  Use Node.js PTY wrapper
  --e2e                       Enable end-to-end encryption
  --skip-permissions          Skip permission prompts (dangerous)
  --headless                  Headless mode (no browser for login)
  --debug                     Enable debug logging
  --help, -h                  Show this help

In-session Commands:
  /name <name>                Rename current session
  /upload <path>              Upload file to cloud
  /download <id>              Download file by ID
  /files                      List uploaded files
  /status                     Show connection status
  /info                       Show session details
  /help                       Show available commands

Examples:
  vibe                        Start new interactive session
  vibe "help me fix this bug" Start session with initial prompt
  vibe --resume abc123        Resume session abc123
  vibe --name "my-project"    Start named session
  vibe login                  Authenticate with MiniVibe

For more info: https://github.com/minivibeapp/minivibe
`);
}

/**
 * Show version information
 */
export function showVersion(version: string): void {
  console.log(`minivibe v${version}`);
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
  console.log(`
╔══════════════════════════════════════════╗
║  MiniVibe - Control Claude from iPhone   ║
╚══════════════════════════════════════════╝

Session: ${sessionId.slice(0, 8)}...${sessionName ? ` (${sessionName})` : ''}
Bridge:  ${bridgeUrl}
E2E:     ${e2eEnabled ? 'enabled' : 'disabled'}

Type /help for in-session commands.
`);
}
