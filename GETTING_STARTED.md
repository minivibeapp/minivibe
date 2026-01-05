# Getting Started with MiniVibe CLI

This guide walks you through setting up MiniVibe CLI to control Claude Code from your iOS device.

## Prerequisites

Before you begin, ensure you have:

1. **Node.js 18+** installed
2. **Claude Code CLI** installed and working (`claude --version`)
3. **MiniVibe iOS app** installed on your iPhone/iPad
4. **Python 3** (macOS/Linux) or **node-pty** (Windows)

## Step 1: Install MiniVibe CLI

```bash
npm install -g minivibe
```

Verify installation:

```bash
vibe --help
vibe-agent --help
```

## Step 2: Authenticate

### On Desktop/Laptop (with browser)

```bash
vibe --login
```

This opens your browser for Google sign-in. After signing in, authentication is saved automatically.

### On Server/EC2 (headless)

```bash
vibe --login --headless
```

You'll see output like:

```
Requesting device code...
   Visit:  https://minivibeapp.com/pair
   Code:   ABC123

   Code expires in 10 minutes.
   Waiting for authentication...
```

1. On your phone or another computer, visit the URL shown
2. Enter the code
3. Sign in with Google
4. The CLI will automatically detect the login and save your token

## Step 3: Choose Your Setup

### Option A: Direct Mode (Simple)

Best for: Single session, desktop use

```bash
vibe --bridge wss://ws.minivibeapp.com
```

### Option B: Agent Mode (Recommended for Servers)

Best for: EC2, multiple sessions, persistent connection

**Terminal 1 - Start the agent:**

```bash
vibe-agent --bridge wss://ws.minivibeapp.com
```

Keep this running. The agent maintains the bridge connection and manages all sessions.

**Terminal 2+ - Create sessions:**

```bash
vibe --agent
```

## Step 4: Connect from iOS

1. Open the **MiniVibe** app on your iOS device
2. Sign in with the same Google account
3. Your sessions will appear automatically
4. Tap a session to view, send messages, and approve permissions

## Common Workflows

### Basic Development Session

```bash
# Start a named session
vibe --agent --name "Feature: User Auth"

# Claude will start, you can work locally
# Monitor and control from iOS app
```

### Automated Tasks

```bash
# Skip all permission prompts (use with caution!)
vibe --agent --dangerously-skip-permissions "Run all tests and fix failures"
```

### Resume Previous Session

```bash
# Find session ID from iOS app or previous output
vibe --agent --resume abc12345-6789-...
```

## Running Agent as a Service

### Using systemd (Linux)

Create `/etc/systemd/system/vibe-agent.service`:

```ini
[Unit]
Description=MiniVibe Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/usr/bin/vibe-agent --bridge wss://ws.minivibeapp.com
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable vibe-agent
sudo systemctl start vibe-agent
```

### Using tmux/screen

```bash
# Start in detached tmux session
tmux new-session -d -s vibe-agent "vibe-agent --bridge wss://ws.minivibeapp.com"

# Attach to view logs
tmux attach -t vibe-agent
```

### Using pm2

```bash
npm install -g pm2
pm2 start vibe-agent -- --bridge wss://ws.minivibeapp.com
pm2 save
pm2 startup
```

## Troubleshooting

### "Session file not found"

This is normal during startup. The session file is created when Claude starts processing. If it persists:

1. Check Claude Code is installed: `claude --version`
2. Check the projects directory exists: `ls ~/.claude/projects/`

### "Authentication failed"

Token may have expired. Re-authenticate:

```bash
vibe --logout
vibe --login --headless
```

### Agent not discovered

If `vibe --agent` can't find the agent:

```bash
# Specify agent URL explicitly
vibe --agent ws://localhost:9999

# Check agent is running
ps aux | grep vibe-agent
```

### Permission prompts not appearing on iOS

1. Ensure you're signed into the same Google account on both CLI and iOS
2. Check the session is "active" in the iOS app
3. Verify bridge connection: look for "Connected to bridge" in CLI output

## Architecture Overview

```
Your Mac/PC                          Cloud                    Your iPhone
┌─────────────────┐                                          ┌─────────────┐
│                 │                                          │             │
│  Terminal 1     │                                          │  MiniVibe   │
│  ┌───────────┐  │     ┌─────────────────┐                  │    App      │
│  │vibe-agent │──┼────▶│  Bridge Server  │◀─────────────────│             │
│  └───────────┘  │     │ ws.minivibeapp.com      │                  │  - View     │
│       ▲         │     └─────────────────┘                  │  - Chat     │
│       │         │                                          │  - Approve  │
│  Terminal 2     │                                          │             │
│  ┌───────────┐  │                                          └─────────────┘
│  │   vibe    │──┘
│  │ + Claude  │
│  └───────────┘
│                 │
└─────────────────┘
```

1. **vibe-agent** connects to the bridge server and stays connected
2. **vibe --agent** connects to the local agent, which spawns Claude Code
3. Messages flow: iOS ↔ Bridge ↔ Agent ↔ vibe ↔ Claude
4. Permissions appear on iOS for approval

## Optional: Enable E2E Encryption

For additional security, enable end-to-end encryption so the bridge server cannot read your message content.

### Step 1: Enable E2E on iOS

1. Open **MiniVibe** app
2. Go to **Settings** (gear icon)
3. Tap **Security** section
4. Enable **E2E Encryption** toggle

### Step 2: Start CLI with E2E Flag

```bash
vibe --e2e --bridge wss://ws.minivibeapp.com
```

### Step 3: Automatic Key Exchange

When both CLI and iOS connect to the bridge, they automatically exchange public keys:

- CLI sends its public key on auth
- iOS sends its public key on auth
- Bridge routes keys between same-user peers
- Encryption is established automatically!

Once connected, you'll see "Encryption Active" and a lock icon. All messages are now encrypted.

### How It Works

```
iOS App                         Bridge Server                    CLI
   │                                 │                            │
   │ ◄──── encrypted content ────► │ ◄──── encrypted content ──► │
   │                                 │                            │
   │     (bridge cannot read         │                            │
   │      message content)           │                            │
```

- **X25519** key exchange (same as Signal, WhatsApp)
- **AES-256-GCM** encryption
- Keys stored securely (CLI: `~/.vibe/e2e-keys.json`, iOS: Keychain)

### Re-pairing

If you need to re-establish E2E encryption:

1. Delete `~/.vibe/e2e-keys.json` on your computer
2. In iOS app: Settings > Security > Reset E2E Keys
3. Restart CLI with `--e2e` - keys will exchange automatically

## Next Steps

- Explore session management in the iOS app
- Set up multiple named sessions for different projects
- Configure auto-start on your development servers
- Check token usage in iOS Settings
- Enable E2E encryption for sensitive projects

## Getting Help

- GitHub Issues: https://github.com/python3isfun/neng/issues
- Check `vibe --help` and `vibe-agent --help` for all options
