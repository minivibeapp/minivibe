# E2E Encryption Documentation

## Overview

vibe-cli supports optional end-to-end (E2E) encryption between the CLI and iOS app. When enabled, message content is encrypted such that the bridge server cannot read it - only the CLI and iOS app can decrypt messages.

**Important:** E2E encryption is **separate from authentication**. Firebase handles user authentication. E2E is an optional privacy layer on top.

## Why E2E?

| Without E2E | With E2E |
|-------------|----------|
| Firebase authenticates users | Firebase authenticates users |
| TLS encrypts connection to bridge | TLS encrypts connection to bridge |
| Bridge can read message content | Bridge **cannot** read message content |
| Simpler setup | Automatic key exchange on connect |

## How It Works

### Cryptographic Primitives

| Component | Algorithm | Details |
|-----------|-----------|---------|
| Key Exchange | X25519 (Curve25519) | Each side generates keypair |
| Key Derivation | HKDF-SHA256 | Salt: `minivibe-e2e-v1`, Info: `aes-256-gcm` |
| Encryption | AES-256-GCM | 12-byte nonce, 16-byte auth tag |

### Key Generation

Each party generates their **own** keypair independently:

```
CLI                                    iOS
────                                   ───
privateKey_CLI (secret, stored)        privateKey_iOS (secret, stored in Keychain)
publicKey_CLI  (shared)                publicKey_iOS  (shared)
```

### Key Exchange Flow (Automatic)

Key exchange happens automatically when both CLI and iOS connect to the bridge:

```
     CLI                    Bridge                   iOS
      │                        │                      │
      │──── Firebase Auth ────>│                      │
      │<─── authenticated ─────│                      │
      │                        │                      │
      │── e2e_key_exchange ───>│                      │   (CLI sends on auth)
      │   {publicKey: "abc",   │                      │
      │    needsResponse: true}│                      │
      │                        │                      │
      │                        │<──── Firebase Auth ──│
      │                        │───── authenticated ─>│
      │                        │                      │
      │                        │<─ e2e_key_exchange ──│   (iOS sends on auth)
      │                        │   {publicKey: "xyz"} │
      │                        │                      │
      │<─ e2e_key_exchange ────│   (bridge routes)    │
      │   {publicKey: "xyz"}   │                      │
      │                        │                      │
      │                        │── e2e_key_exchange ─>│   (bridge routes)
      │                        │   {publicKey: "abc"} │
      │                        │                      │
  [Derive shared secret]       │       [Derive shared secret]
      │                        │                      │
      │════════ Encrypted Channel (E2E) ═════════════│
```

**Note:** The order doesn't matter - whichever side connects first sends its key, and when the other side connects, it sends its key back. Bridge routes keys between same-user peers.

### Shared Secret Derivation (Diffie-Hellman)

Both sides derive the **same** shared secret using their private key + peer's public key:

```
CLI:  privateKey_CLI + publicKey_iOS  →  sharedSecret
iOS:  privateKey_iOS + publicKey_CLI  →  sharedSecret (identical!)
```

The bridge only sees public keys and **cannot** derive the shared secret.

## Message Format

### Key Exchange Message

```json
{
  "type": "e2e_key_exchange",
  "publicKey": "base64-encoded-32-byte-public-key",
  "needsResponse": true,
  "deviceId": "MacBook-Pro-cli",
  "timestamp": 1704067200000
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | Always `"e2e_key_exchange"` |
| publicKey | string | Base64-encoded X25519 public key (32 bytes) |
| needsResponse | boolean | `true` if sender needs peer to send their key back |
| deviceId | string | Human-readable device identifier |
| timestamp | number | Unix timestamp in milliseconds |

### Encrypted Content

When E2E is active, the `content` field of messages is replaced with:

```json
{
  "content": {
    "e2e": true,
    "v": 1,
    "nonce": "base64-12-bytes",
    "ciphertext": "base64-encrypted-data-plus-16-byte-auth-tag"
  }
}
```

## Key Storage

### CLI (`~/.vibe/e2e-keys.json`)

```json
{
  "version": 2,
  "publicKey": "base64-public-key",
  "privateKeyDer": "base64-pkcs8-private-key",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "peers": {
    "default": {
      "publicKey": "base64-peer-public-key",
      "connectedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### iOS (Keychain)

- Service: `com.minivibe.e2e`
- Private key account: `privateKey` (raw 32 bytes)
- Peer key account: `peerPublicKey` (base64 string as UTF-8 data)

## Edge Cases

### 1. Peer Offline When Key Exchange Sent

**Scenario:** CLI sends key exchange but iOS isn't connected.

**Current Behavior:** Bridge returns `e2e_key_exchange_pending` message.

**Solution:** Retry when peer connects, or use saved peer key if available.

### 2. Key Mismatch (One Side Regenerated Keys)

**Scenario:** CLI regenerated keys but iOS has old peer key saved.

**Current Behavior:**
- Decryption fails
- After 3 consecutive failures, `keyHealthWarning` is set
- UI shows "Keys May Be Out of Sync" warning

**Solution:** User resets E2E keys on both sides.

### 3. Multiple CLIs for Same User

**Scenario:** User has 2 laptops, each running vibe-cli.

**Current Behavior:** Bridge routes key exchange to ALL providers for the user.

**Implication:** Each CLI will have different keys. iOS pairs with whichever responded last.

### 4. Multiple iOS Devices

**Scenario:** User has iPhone and iPad.

**Current Behavior:** Bridge routes key exchange to ALL viewers for the user.

**Implication:** Each device pairs independently with CLI.

### 5. Reconnection After Disconnect

**Scenario:** CLI disconnects and reconnects.

**Current Behavior:** Uses saved peer key from disk. No re-exchange needed if peer hasn't changed keys.

### 6. First-Time Setup (No Saved Peer)

**Automatic Method (Current):**
1. CLI runs with `--e2e --bridge wss://ws.minivibeapp.com`
2. CLI authenticates and sends key exchange automatically
3. iOS connects, authenticates, and sends key exchange automatically
4. Bridge routes keys between same-user peers
5. Both derive shared secret
6. Keys are saved for future sessions

**Re-pairing (if keys out of sync):**
1. CLI: Delete `~/.vibe/e2e-keys.json`
2. iOS: Settings > Security > Reset E2E Keys
3. Reconnect - keys exchange automatically

## Files Involved

### CLI (`vibe-cli/`)

| File | Purpose |
|------|---------|
| `e2e.js` | Core E2E module (key generation, encryption, decryption) |
| `vibe.js` | Integration, auto key exchange on auth |

### iOS (`MiniVibe/`)

| File | Purpose |
|------|---------|
| `Security/E2EEncryption.swift` | Core encryption (CryptoKit) |
| `Security/E2EManager.swift` | State management, Keychain storage |
| `Security/E2ESetupView.swift` | Settings UI for E2E toggle and status |
| `Services/BridgeService.swift` | Key exchange message handling |

### Bridge (`minivibe-bridge/`)

| File | Purpose |
|------|---------|
| `bridge-server.js` | Routes `e2e_key_exchange` messages between peers |

## What E2E Affects (and Doesn't Affect)

E2E encryption only affects **message content**. Other data flows remain unencrypted and fully functional.

### NOT Affected by E2E (Still Works)

| Data | Why It Still Works |
|------|-------------------|
| **Token accounting** | Sent as separate `token_usage` message (never encrypted) |
| **Rate limiting** | Based on token counts reported separately |
| **Session management** | Session IDs, timestamps not encrypted |
| **Message metadata** | Sender, timestamp, session ID visible |
| **User authentication** | Firebase auth is separate from E2E |

### Affected by E2E

| Data | Impact |
|------|--------|
| **Message content in DB** | Stored as encrypted blob |
| **Server-side search** | Cannot search encrypted messages |
| **Content moderation** | Cannot inspect message content |

### Token Usage Flow (Unaffected by E2E)

Token usage is reported via a **separate message** that is never encrypted:

```
Claude SDK                    CLI (vibe.js)                Bridge
    │                              │                          │
    │── response with usage ──────>│                          │
    │   {input_tokens: 3,          │                          │
    │    output_tokens: 1,         │── token_usage message ──>│
    │    cache_creation: 129649}   │   (NOT encrypted)        │
    │                              │                          │
    │                              │                          ├──> INSERT INTO token_usage
    │                              │                          │
    │                              │── claude_message ───────>│
    │                              │   (encrypted if E2E)     │
    │                              │                          ├──> INSERT INTO messages
```

The `token_usage` table continues to work normally:

```sql
mysql> SELECT * FROM token_usage WHERE created_at LIKE '2026-01-01%' LIMIT 1;
+-------+---------+-------------+--------------------------+--------------+---------------+-----------------------+
| id    | user_id | session_id  | model                    | input_tokens | output_tokens | cache_creation_tokens |
+-------+---------+-------------+--------------------------+--------------+---------------+-----------------------+
| 11640 | OUF...  | 8509eae6... | claude-opus-4-5-20251101 |            3 |             1 |                129649 |
+-------+---------+-------------+--------------------------+--------------+---------------+-----------------------+
```

### Message Types: Encrypted vs Not

| Message Type | Encrypted with E2E? | Purpose |
|--------------|---------------------|---------|
| `token_usage` | No | Billing, rate limiting |
| `session_status` | No | Session management |
| `e2e_key_exchange` | No | Key exchange |
| `claude_message` content | **Yes** | Claude's responses |
| `send_message` content | **Yes** | User input |

### Database Storage Comparison

**Without E2E:**
```sql
content: "Please help me fix this bug in my code..."
```

**With E2E:**
```sql
content: "{\"e2e\":true,\"v\":1,\"nonce\":\"abc123...\",\"ciphertext\":\"xyz789...\"}"
```

### Message History Still Works

Even with E2E, message history works for end users:
1. Bridge stores encrypted messages in database
2. iOS/CLI receive encrypted messages
3. iOS/CLI decrypt locally and display

The bridge acts as a "dumb pipe" - it stores and relays encrypted content but cannot read it.

## Security Considerations

1. **Private keys never leave the device** - Only public keys are exchanged
2. **Bridge is zero-knowledge** - Cannot derive shared secret from public keys
3. **Forward secrecy not implemented** - Same keypair used for all sessions (could add ephemeral keys)
4. **No key rotation** - Manual reset required to change keys

## Disabling E2E

E2E is optional. To disable:

- **CLI:** Don't use `--e2e` flag
- **iOS:** Settings > Security > Disable E2E Encryption

Without E2E, messages are still protected by:
- Firebase authentication (identity verification)
- TLS encryption (wss://) for transport

## Future Improvements

1. ~~**Automatic key exchange**~~ - ✅ Implemented! Keys exchanged automatically on connect
2. **Key rotation** - Periodic key regeneration for forward secrecy
3. **Multi-device support** - Better handling of multiple CLIs/devices
4. **Key backup** - Optional encrypted backup for key recovery
