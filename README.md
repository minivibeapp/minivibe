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
# Install globally from npm
npm install -g minivibe

# Authenticate (one-time)
vibe --login              # Desktop (opens browser)
vibe --login --headless   # Server/EC2 (device code)

# Option 1: Direct bridge connection
vibe --bridge wss://ws.minivibeapp.com

# Option 2: Agent mode (recommended for servers)
vibe-agent --bridge wss://ws.minivibeapp.com &   # Start agent
vibe --agent                              # Create sessions
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for detailed setup instructions.

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
git clone https://github.com/python3isfun/neng.git
cd neng/vibe-cli
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

### Direct Bridge Mode

Connect directly to the bridge server:

```bash
vibe --bridge wss://ws.minivibeapp.com
vibe --bridge wss://ws.minivibeapp.com "Fix the bug in main.js"
```

### Agent Mode (Recommended for Servers)

Use a local agent to manage sessions:

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

### Local Mode (No Bridge)

Run without remote control:

```bash
vibe                          # Interactive
vibe "Explain this code"      # With prompt
```

## Options

### vibe

| Option | Description |
|--------|-------------|
| `--bridge <url>` | Connect to bridge server |
| `--agent [url]` | Connect via local vibe-agent (default: auto-discover) |
| `--name <name>` | Name this session (shown in mobile app) |
| `--resume <id>` | Resume a previous session (auto-detects directory) |
| `--attach <id>` | Shortcut for `--agent --resume <id>` |
| `--login` | Sign in with Google |
| `--headless` | Use device code flow for headless environments |
| `--token <token>` | Set Firebase auth token manually |
| `--logout` | Remove stored auth token |
| `--dangerously-skip-permissions` | Auto-approve all tool executions |
| `--e2e` | Enable end-to-end encryption (auto key exchange with iOS) |
| `--node-pty` | Use Node.js PTY wrapper (required for Windows) |
| `--help, -h` | Show help message |

### vibe-agent

| Option | Description |
|--------|-------------|
| `--bridge <url>` | Bridge server URL (required) |
| `--port <port>` | Local WebSocket port (default: 9999) |
| `--help, -h` | Show help message |

## Skip Permissions Mode

For automated/headless environments where you trust the execution context:

```bash
vibe --dangerously-skip-permissions --bridge wss://ws.minivibeapp.com
vibe --dangerously-skip-permissions --agent
```

**Warning:** This mode auto-approves ALL tool executions (commands, file writes, etc.) without prompting. Only use in trusted/sandboxed environments.

## End-to-End Encryption

Enable E2E encryption to ensure the bridge server cannot read your message content:

```bash
# Start with E2E encryption enabled
vibe --e2e --bridge wss://ws.minivibeapp.com
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

**Direct mode:** `vibe --bridge` connects directly to bridge server

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
| `~/.vibe/token` | Legacy token file |
| `~/.vibe/e2e-keys.json` | E2E encryption keypair and peer info |
| `~/.vibe-agent/port` | Agent port file for auto-discovery |

## License

MIT
