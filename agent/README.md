# vibe-agent

Persistent daemon for remote Claude Code session management.

## Overview

`vibe-agent` runs on a host machine (EC2, local Mac, etc.) and accepts commands from the MiniVibe iOS app to:

- Start new Claude Code sessions
- Resume existing sessions
- Stop running sessions
- List active sessions

## Usage

```bash
# First time: authenticate
vibe-agent --login --bridge wss://ws.minivibeapp.com

# Start the agent daemon
vibe-agent --bridge wss://ws.minivibeapp.com

# With custom host name
vibe-agent --bridge wss://ws.minivibeapp.com --name "AWS Dev Server"

# Check status
vibe-agent --status
```

## Options

| Option | Description |
|--------|-------------|
| `--bridge <url>` | Bridge server URL (required) |
| `--login` | Start device code login flow |
| `--name <name>` | Set host display name |
| `--token <token>` | Use specific Firebase token |
| `--status` | Show current status and exit |
| `--help, -h` | Show help |

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MiniVibe   │────▶│   Bridge    │◀────│ vibe-agent  │
│  iOS App    │     │   Server    │     │  (daemon)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │    vibe     │
                                        │  sessions   │
                                        └─────────────┘
```

1. Agent connects to bridge server and registers itself
2. iOS app sees available agents and their sessions
3. User starts/stops sessions from iOS app
4. Agent spawns `vibe` processes to handle sessions
5. Session output is relayed to iOS app in real-time

## Session History

The agent persists session history to disk (`~/.vibe-agent/session-history.json`), allowing sessions to be resumed even after agent restarts.

## Files

| Path | Description |
|------|-------------|
| `~/.vibe-agent/config.json` | Agent configuration |
| `~/.vibe-agent/auth.json` | Authentication tokens |
| `~/.vibe-agent/session-history.json` | Session history for resume |
| `~/.vibe-agent/port` | Port file for auto-discovery |

## Local Server

The agent runs a local WebSocket server on port 9999 for `vibe` sessions to connect to. This allows:

- Sessions to inherit agent's authentication
- Multiple sessions to share single bridge connection
- Terminal mirroring with `--attach` mode

## License

MIT
