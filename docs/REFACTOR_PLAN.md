# vibe.js Modularization Plan

## Current State

- **Single file**: `vibe.js` at ~3,800 lines
- **No TypeScript**: Pure JavaScript with no type safety
- **Mixed concerns**: Auth, WebSocket, Claude process, E2E, CLI parsing all intertwined
- **Hard to test**: Can't unit test individual components
- **Difficult to maintain**: Large PRs, hard to review, difficult onboarding

## Target Architecture

```
minivibe/
├── src/
│   ├── index.ts                 # Entry point, CLI argument parsing
│   ├── main.ts                  # Main execution flow
│   │
│   ├── auth/
│   │   ├── index.ts             # Auth exports
│   │   ├── storage.ts           # Token storage (read/write auth.json)
│   │   ├── refresh.ts           # Token refresh via Firebase API
│   │   └── login.ts             # Device code login flow
│   │
│   ├── bridge/
│   │   ├── index.ts             # Bridge exports
│   │   ├── connection.ts        # WebSocket connection management
│   │   ├── handlers.ts          # Message type handlers
│   │   └── reconnect.ts         # Reconnection logic
│   │
│   ├── claude/
│   │   ├── index.ts             # Claude exports
│   │   ├── process.ts           # Claude process spawn/management
│   │   ├── terminal.ts          # PTY/terminal handling
│   │   ├── permissions.ts       # Permission request handling
│   │   └── output-parser.ts     # Parse Claude output for tool calls
│   │
│   ├── e2e/
│   │   ├── index.ts             # E2E exports
│   │   ├── encryption.ts        # Encrypt/decrypt messages
│   │   ├── key-exchange.ts      # Key exchange protocol
│   │   └── peer-storage.ts      # Save/load peer keys
│   │
│   ├── commands/
│   │   ├── index.ts             # Command exports
│   │   ├── file-list.ts         # vibe file list
│   │   ├── file-upload.ts       # vibe file upload
│   │   ├── session-list.ts      # vibe session list
│   │   ├── session-rename.ts    # vibe session rename
│   │   └── remote-attach.ts     # vibe --remote
│   │
│   ├── agent/
│   │   └── client.ts            # Agent connection (for --agent mode)
│   │
│   └── utils/
│       ├── config.ts            # Constants, URLs, Firebase config
│       ├── logger.ts            # Logging with colors, stderr handling
│       ├── colors.ts            # ANSI color codes
│       └── platform.ts          # OS-specific utilities
│
├── tests/
│   ├── auth/
│   │   ├── storage.test.ts
│   │   └── refresh.test.ts
│   ├── bridge/
│   │   └── handlers.test.ts
│   └── claude/
│       └── output-parser.test.ts
│
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Module Breakdown

### Phase 1: Foundation (Week 1)

#### 1.1 Setup TypeScript
- Add `tsconfig.json`
- Add build script to `package.json`
- Keep `vibe.js` as build output for backwards compatibility

#### 1.2 Extract `src/utils/`
- `config.ts` - All constants, URLs, Firebase config (~50 lines)
- `colors.ts` - ANSI color codes (~30 lines)
- `logger.ts` - log(), logStatus(), logStderr() (~50 lines)

### Phase 2: Auth Module (Week 2)

#### 2.1 Extract `src/auth/`
- `storage.ts` - getStoredAuth(), storeAuth(), getStoredToken() (~80 lines)
- `refresh.ts` - refreshIdToken(), isTokenExpired(), ensureValidToken() (~100 lines)
- `login.ts` - startLoginFlow(), startHeadlessLogin(), device code polling (~250 lines)

**Testing**: Unit test token refresh with mocked fetch

### Phase 3: Bridge Module (Week 3)

#### 3.1 Extract `src/bridge/`
- `connection.ts` - connectToBridge(), reconnection, heartbeat (~150 lines)
- `handlers.ts` - handleBridgeMessage() switch cases (~500 lines)
- `reconnect.ts` - Reconnection timer, backoff logic (~50 lines)

**Testing**: Mock WebSocket, test message handlers

### Phase 4: Claude Module (Week 4)

#### 4.1 Extract `src/claude/`
- `process.ts` - startClaude(), Claude process management (~200 lines)
- `terminal.ts` - PTY setup, terminal I/O (~200 lines)
- `permissions.ts` - Permission detection, approval flow (~150 lines)
- `output-parser.ts` - Parse tool calls from Claude output (~100 lines)

**Testing**: Test output parsing with sample Claude outputs

### Phase 5: Commands (Week 5)

#### 5.1 Extract `src/commands/`
- `file-list.ts` - fileListMode() (~100 lines)
- `file-upload.ts` - fileUploadMode() (~150 lines)
- `session-list.ts` - sessionListMode(), listSessionsMode() (~150 lines)
- `session-rename.ts` - sessionRenameMode() (~100 lines)
- `remote-attach.ts` - remoteAttachMain() (~300 lines)

### Phase 6: E2E Module (Week 6)

#### 6.1 Refactor existing `e2e.js`
- Already somewhat modular
- Convert to TypeScript
- Split into encryption, key-exchange, peer-storage

### Phase 7: Integration (Week 7)

#### 7.1 Wire everything together
- `src/index.ts` - CLI parsing, route to correct command
- `src/main.ts` - Main vibe flow orchestration
- Update imports throughout

#### 7.2 Final cleanup
- Remove old `vibe.js` (generate from TypeScript)
- Update README with new architecture
- Add CONTRIBUTING.md

## Migration Strategy

### Keep Backwards Compatibility
```json
{
  "main": "dist/index.js",
  "bin": {
    "vibe": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

### Gradual Migration
1. New code in `src/` with TypeScript
2. Build outputs to `dist/`
3. Old `vibe.js` deprecated but kept until migration complete
4. Each phase is a separate PR, reviewable independently

## Success Metrics

- [ ] Each module < 400 lines
- [ ] > 80% test coverage on auth, bridge handlers, output parser
- [ ] TypeScript strict mode enabled
- [ ] Build time < 5 seconds
- [ ] No functionality regression (manual QA checklist)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking changes | Keep integration tests, manual QA before each release |
| Increased complexity | Clear module boundaries, good documentation |
| Build step overhead | Fast TypeScript compilation, watch mode for dev |
| Contributor friction | Good CONTRIBUTING.md, clear module ownership |

## Open Questions

1. Should we use a bundler (esbuild/rollup) or just tsc?
2. Do we want to support ESM and CJS, or just one?
3. Should agent/ also be TypeScript, or keep separate?

## References

- [TypeScript Node Starter](https://github.com/microsoft/TypeScript-Node-Starter)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
