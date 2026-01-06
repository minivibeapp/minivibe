# MiniVibe CLI

CLI wrapper for Claude Code with mobile remote control via MiniVibe iOS app.

## Features

- Remote control Claude Code from your iOS device
- Agent mode for managing multiple sessions
- Session management with resume capability
- Permission handling from mobile
- Token usage tracking
- Headless authentication for servers (EC2, etc.)
- Skip permissions mode for automation
- **End-to-end encryption** - Optional E2E encryption so bridge server cannot read message content

## Quick Start

```bash
# Install
npm install -g minivibe

# Login (one-time)
vibe --login

# Start coding with remote control!
vibe
vibe "Fix the bug in main.js"
```

> **Note:** For local-only use without remote control, just run `claude` directly.

## Installation

### From npm (Recommended)

```bash
npm install -g minivibe
```

This installs two commands:
- `vibe` - Start Claude Code sessions
- `vibe-agent` - Background agent for managing sessions

### From Source

```bash
git clone https://github.com/minivibeapp/minivibe.git
cd minivibe
npm install
npm link
```

## Authentication

### Browser Login (Desktop)

```bash
vibe --login
```

Opens browser for Google sign-in. Token is saved to `~/.vibe/auth.json`.

### Headless Login (Servers/EC2)

```bash
vibe --login --headless
```

Displays a device code. Visit the URL on any device to authenticate.

### Manual Token

```bash
vibe --token <firebase-token>
```

Get token from MiniVibe iOS app: Settings > Copy Token for CLI.

## Usage Modes

### Direct Mode (Default)

Just run `vibe` after logging in:

```bash
vibe                      # Start session
vibe "Fix the bug"        # With initial prompt
vibe --e2e                # With end-to-end encryption
```

### Agent Mode (Recommended for Servers)

Use a local agent to manage multiple sessions:

```bash
# Terminal 1: Start the agent (runs continuously)
vibe-agent --bridge wss://ws.minivibeapp.com

# Terminal 2+: Create sessions via agent
vibe --agent
vibe --agent "Deploy the application"
vibe --agent --name "Backend Work"
```

**Benefits of Agent Mode:**
- Single bridge connection for multiple sessions
- Start/stop sessions remotely from iOS app
- Sessions survive network hiccups
- Cleaner process management

## Options

### vibe

| Option | Description |
|--------|-------------|
| `--login` | Sign in with Google |
| `--headless` | Use device code flow for headless environments |
| `--agent [url]` | Connect via local vibe-agent (default: auto-discover) |
| `--name <name>` | Name this session (shown in mobile app) |
| `--resume <id>` | Resume a previous session (auto-detects directory) |
| `--attach <id>` | Attach to running session via local agent |
| `--remote <id>` | Remote control session via bridge (no local Claude needed) |
| `--list` | List running sessions on local agent |
| `--e2e` | Enable end-to-end encryption (auto key exchange with iOS) |
| `--dangerously-skip-permissions` | Auto-approve all tool executions |
| `--bridge <url>` | Override bridge URL (default: wss://ws.minivibeapp.com) |
| `--token <token>` | Set Firebase auth token manually |
| `--logout` | Remove stored auth token |
| `--node-pty` | Use Node.js PTY wrapper (required for Windows) |
| `--help, -h` | Show help message |

### vibe-agent

| Option | Description |
|--------|-------------|
| `--bridge <url>` | Bridge server URL (required) |
| `--login` | Start device code login flow |
| `--token <token>` | Use specific Firebase token |
| `--name <name>` | Set host display name |
| `--status` | Show current status and exit |
| `--help, -h` | Show help message |

## Skip Permissions Mode

For automated/headless environments where you trust the execution context:

```bash
vibe --dangerously-skip-permissions
vibe --dangerously-skip-permissions --agent
```

**Warning:** This mode auto-approves ALL tool executions (commands, file writes, etc.) without prompting. Only use in trusted/sandboxed environments.

## End-to-End Encryption

Enable E2E encryption to ensure the bridge server cannot read your message content:

```bash
# Start with E2E encryption enabled
vibe --e2e
```

Key exchange happens automatically when both CLI and iOS connect to the bridge:

1. Enable E2E in MiniVibe iOS app: **Settings > Security > E2E Encryption**
2. Start CLI with `--e2e` flag
3. Both sides exchange public keys automatically on connect
4. Encryption is established - no QR scanning needed!

### How It Works

- Uses **X25519** key exchange (same as Signal, WhatsApp)
- Messages encrypted with **AES-256-GCM**
- Keys derived using **HKDF-SHA256**
- Bridge server sees message routing info but cannot read content

### Key Storage

| Location | Description |
|----------|-------------|
| `~/.vibe/e2e-keys.json` | CLI keypair and peer info |
| iOS Keychain | iOS keypair and peer info |

### Security Notes

- E2E is optional and backward compatible
- Once paired, encryption persists across sessions
- To re-pair: delete `~/.vibe/e2e-keys.json` and reset in iOS Settings

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MiniVibe   │────▶│   Bridge    │◀────│ vibe-agent  │◀────│    vibe     │
│  iOS App    │     │   Server    │     │  (daemon)   │     │  (session)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

**Direct mode:** `vibe` connects directly to bridge server

**Agent mode:** `vibe --agent` connects to local `vibe-agent`, which manages bridge connection

## Requirements

- Node.js >= 18.0.0
- Claude Code CLI installed and in PATH
- Python 3 (for Unix PTY wrapper) or node-pty (for Windows)

## Platform Notes

### macOS/Linux

Uses Python PTY wrapper by default. Requires `python3`.

### Windows

Requires `node-pty`:

```bash
npm install node-pty
```

May also need Visual Studio Build Tools and Python for native compilation.

## Files

| Path | Description |
|------|-------------|
| `~/.vibe/auth.json` | Stored authentication (token + refresh token) |
| `~/.vibe/e2e-keys.json` | E2E encryption keypair and peer info |
| `~/.vibe-agent/port` | Agent port file for auto-discovery |

## License

MIT
