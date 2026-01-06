# CLI Onboarding Simplification Plan

## Goal

Simplify the CLI experience by making remote control the default and requiring authentication upfront.

## Current State

```
vibe                    → Local Claude only (no remote)
vibe --bridge URL       → Remote, but needs auth
vibe --agent            → Via agent
vibe --login            → Authenticate then exit
```

**Problems:**
- `vibe` without flags is useless (just use `claude`)
- `--bridge URL` required every time
- No auth = warning then fail at connection
- Confusing for new users

## Proposed State

```
vibe                    → Auto-connect to bridge (requires auth)
vibe --login            → Authenticate
vibe --agent            → Via local agent
vibe --e2e              → With encryption
```

**Changes:**
- Remove `--bridge` flag (use default URL)
- Remove local-only mode (use `claude` instead)
- Block on no auth (don't warn and continue)
- Show welcome message for first-time users

---

## Implementation Plan

### Phase 1: Simplify Auth Check

**File:** `vibe.js`

1. **Remove bridge URL flag requirement**
   - Keep `--bridge` for override but make it optional
   - Default to `wss://ws.minivibeapp.com`

2. **Block on missing auth (not warn)**
   ```javascript
   // Before (lines ~697-703)
   if (!isAgentMode && !authToken) {
     log('⚠️  No authentication token found.', colors.yellow);
     // ... continues anyway
   }

   // After
   if (!isAgentMode && !authToken) {
     showWelcomeMessage();
     process.exit(1);
   }
   ```

3. **Add welcome message for first-time users**
   ```javascript
   function showWelcomeMessage() {
     console.log(`
   Welcome to MiniVibe! 🎉

   MiniVibe lets you control Claude Code from your iPhone.

   To get started:
     1. Download MiniVibe from the App Store
     2. Run: vibe --login

   For help: vibe --help
   `);
   }
   ```

### Phase 2: Simplify Command Parsing

**File:** `vibe.js`

1. **Make bridge connection default**
   - If no `--agent` flag and authenticated → connect to bridge
   - Remove requirement for explicit `--bridge` flag

2. **Update help text**
   ```
   Usage:
     vibe                    Start session (connects to bridge)
     vibe "prompt"           Start with initial prompt
     vibe --login            Sign in with Google
     vibe --agent            Connect via local vibe-agent
     vibe --e2e              Enable end-to-end encryption

   Options:
     --bridge <url>          Override bridge URL (default: wss://ws.minivibeapp.com)
     --name <name>           Name this session
     --resume <id>           Resume previous session
     --dangerously-skip-permissions  Auto-approve all tools
   ```

### Phase 3: Update README

**File:** `README.md`

1. **Simplify Quick Start**
   ```markdown
   ## Quick Start

   # Install
   npm install -g minivibe

   # Login (one-time)
   vibe --login

   # Start coding with remote control
   vibe
   vibe "Fix the bug in main.js"
   ```

2. **Remove local-only documentation**

3. **Clarify: "For local-only use, just run `claude` directly"**

---

## Files to Modify

| File | Changes |
|------|---------|
| `vibe.js` | Auth check, welcome message, default bridge |
| `README.md` | Simplified quick start, updated options |

## Lines to Change (vibe.js)

| Line | Current | New |
|------|---------|-----|
| ~697-703 | Warn on no auth | Block + welcome message |
| ~420-470 | Help text | Simplified help |
| ~680-690 | Bridge URL logic | Default to bridge if authenticated |

---

## Edge Cases

### 0. Claude Code Not Installed

**Current behavior:** Falls back to hardcoded path, fails on spawn with confusing error.

**Proposed:** Check early and show helpful message:

```javascript
function checkClaudeInstalled() {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// In main flow, before anything else:
if (!checkClaudeInstalled()) {
  console.log(`
❌ Claude Code not found

MiniVibe requires Claude Code CLI to be installed.

Install Claude Code:
  https://claude.ai/download

After installing, run:
  vibe --login
`);
  process.exit(1);
}
```

**Exception:** `--remote` mode doesn't need Claude locally (controls remote session).

### 1. Agent Modes (No Local Auth Required)

These modes inherit auth from the agent:

| Command | Auth Required | Notes |
|---------|---------------|-------|
| `vibe --agent` | No (agent has auth) | Agent must be authenticated |
| `vibe --attach <id>` | No (agent has auth) | Attaches via agent |
| `vibe --list` | No (agent has auth) | Lists via agent |

**No change needed** - keep current behavior.

### 2. `--remote` Without `--bridge`

```bash
# Current: requires --bridge
vibe --remote <id> --bridge URL

# Proposed: use default bridge
vibe --remote <id>
```

**Change:** If `--remote` and no `--bridge`, use default bridge URL.

### 3. `--resume` Without `--bridge` or `--agent`

```bash
# Current: resumes locally (no remote)
vibe --resume <id>

# Proposed: use default bridge (if authenticated)
vibe --resume <id>
```

**Change:** If authenticated and no `--agent`, use default bridge.

### 4. Token Expired

Current behavior (keep):
- Bridge returns `auth_error`
- CLI auto-refreshes token using refresh token
- Retries authentication

### 5. Agent Not Running

```bash
vibe --agent
# Agent connection fails
```

**Current behavior (keep):** Shows error "Connecting to local agent... failed"

**Improvement:** Better error message:
```
❌ Cannot connect to vibe-agent at ws://localhost:9999

Make sure vibe-agent is running:
  vibe-agent --login --bridge wss://ws.minivibeapp.com
  vibe-agent --bridge wss://ws.minivibeapp.com
```

### 6. Decision Matrix

**Startup checks (in order):**
1. `--login`, `--logout`, `--help` → handle immediately (no Claude check)
2. `--remote` mode → skip Claude check (no local Claude needed)
3. Check Claude installed → error if not
4. Check auth (unless agent mode) → welcome if not

| Flags | Claude? | Auth? | Behavior |
|-------|---------|-------|----------|
| `--login` | Skip | Skip | Login flow |
| `--help` | Skip | Skip | Show help |
| `--remote <id>` | Skip | Required | Connect to bridge |
| (none) | Required | Required | Connect to default bridge |
| `--agent` | Required | Skip | Connect to agent |
| `--bridge URL` | Required | Required | Connect to specified bridge |

---

## Testing Checklist

### Basic Flow
- [ ] `vibe` without auth → shows welcome, exits
- [ ] `vibe --login` → device code flow works
- [ ] `vibe` after login → connects to default bridge
- [ ] `vibe "prompt"` → starts with prompt
- [ ] `vibe --help` → shows updated help

### Agent Modes (no local auth needed)
- [ ] `vibe --agent` → connects to local agent
- [ ] `vibe --attach <id>` → attaches via agent
- [ ] `vibe --list` → lists sessions via agent
- [ ] `vibe --agent` (agent not running) → helpful error

### Bridge Override
- [ ] `vibe --bridge custom-url` (no auth) → welcome, exits
- [ ] `vibe --bridge custom-url` (with auth) → connects to custom URL

### Special Modes
- [ ] `vibe --remote <id>` (no auth) → welcome, exits
- [ ] `vibe --remote <id>` (with auth) → connects to default bridge
- [ ] `vibe --resume <id>` (with auth) → connects to default bridge
- [ ] `vibe --e2e` → enables encryption

### Error Handling
- [ ] Claude not installed → helpful install message
- [ ] Expired token → auto-refreshes
- [ ] Invalid token → prompts re-login
- [ ] Bridge connection fails → retry with backoff

### Remote Mode (no local Claude)
- [ ] `vibe --remote <id>` (no Claude installed) → works (no local Claude needed)

---

## Rollout

1. Implement changes
2. Test all scenarios
3. Update version to 0.2.1
4. Commit and push
5. Publish to npm

---

## Future Considerations

- `vibe status` - show auth status, agent status
- `vibe logout` - clear auth (already exists)
- Auto-detect agent and use it if running
