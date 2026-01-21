import { colors } from '../utils/colors';

/**
 * Log a message with timestamp
 */
export function log(msg: string, color: string = colors.reset): void {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${msg}${colors.reset}`);
}

/**
 * Clean CLI output for logging - removes ANSI codes, TUI elements, and collapses whitespace
 */
export function cleanCliOutput(data: Buffer | string): string {
  let output = data.toString();

  // Strip all ANSI escape sequences (comprehensive pattern)
  output = output.replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, ''); // CSI with optional ?
  output = output.replace(/\x1b\][^\x07]*\x07/g, ''); // OSC sequences
  output = output.replace(/\x1b[PX^_].*?\x1b\\/g, ''); // DCS/PM/APC sequences
  output = output.replace(/\x1b[()][AB012]/g, ''); // Character set selection
  output = output.replace(/\x1b[78DEHM]/g, ''); // Other simple escapes

  // Strip other control characters except newline and tab
  output = output.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

  // Filter out TUI status bar elements (Claude's UI)
  output = output.replace(/[─│┌┐└┘├┤┬┴┼]+/g, ''); // Box drawing chars
  output = output.replace(/[✻◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, ''); // Spinner chars
  output = output.replace(/\?\s*for shortcuts.*toggle\)/gi, ''); // Status bar text
  output = output.replace(/Thinking\s+(on|off)\s*\(tab to toggle\)/gi, '');
  output = output.replace(/\(esc to interrupt\)/gi, '');
  output = output.replace(/Envisioning…/g, '');

  // Collapse multiple spaces/newlines
  output = output.replace(/[ \t]+/g, ' ');
  output = output.replace(/\n{2,}/g, '\n');

  // Trim and return (return empty string if only whitespace remains)
  output = output.trim();
  return output.length > 0 ? output : '';
}

/**
 * Show welcome message for first-time users
 */
export function showWelcomeMessage(): void {
  console.log(`
Welcome to vibe-agent!

vibe-agent lets you manage Claude Code sessions from your iPhone.

To get started:
  1. Download MiniVibe from the App Store
  2. Run: vibe-agent login
     (or 'vibe login' - auth is shared between vibe and vibe-agent)

For help: vibe-agent help
`);
}

/**
 * Print help message
 */
export function printHelp(): void {
  console.log(`
${colors.cyan}${colors.bold}vibe-agent${colors.reset} - Persistent daemon for remote Claude Code sessions

${colors.bold}Usage:${colors.reset}
  vibe-agent                Start agent daemon
  vibe-agent login          Sign in (one-time)
  vibe-agent logout         Sign out and clear credentials
  vibe-agent whoami         Show logged-in user info
  vibe-agent status         Show agent status

${colors.bold}Commands:${colors.reset}
  login             Sign in via device code flow
  logout            Sign out and clear saved credentials
  whoami            Show logged-in user info
  status            Show current status and exit
  help              Show this help

${colors.bold}Options:${colors.reset}
  --name <name>     Set host display name
  --bridge <url>    Override bridge URL (default: wss://ws.minivibeapp.com)
  --token <token>   Use specific Firebase token
  --e2e             Enable E2E encryption (disabled by default, WSS provides transport encryption)

${colors.bold}Examples:${colors.reset}
  vibe-agent login          Sign in (one-time setup)
  vibe-agent                Start agent (E2E disabled, uses WSS transport encryption)
  vibe-agent --name "EC2"   Start with custom name
  vibe-agent --e2e          Enable E2E encryption
`);
}
