/**
 * E2E Encryption Module for vibe-cli
 *
 * Uses X25519 for key exchange and AES-256-GCM for symmetric encryption.
 * Compatible with CryptoKit (iOS) and WebCrypto (Web).
 *
 * Key Exchange: X25519 (Curve25519) via Node.js native crypto
 * Key Derivation: HKDF-SHA256
 * Encryption: AES-256-GCM with 12-byte nonce
 *
 * V2: Multi-peer encryption - encrypts for ALL connected peers
 */

const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// E2E encryption state - now supports multiple peers
let e2eState = {
  enabled: false,
  privateKey: null,      // Node.js KeyObject
  publicKeyRaw: null,    // Raw 32-byte public key for sharing
  peers: new Map(),      // peerId -> { publicKey, sharedSecret }
  decryptionFailures: 0  // Track consecutive failures for key mismatch detection
};

// Max consecutive decryption failures before assuming key mismatch
const MAX_DECRYPTION_FAILURES = 3;

// Logger function - can be overridden to avoid stdout corruption during PTY
let logFn = (msg) => process.stderr.write(`${msg}\n`);

/**
 * Set custom logger function (e.g., to suppress or redirect logs)
 */
function setLogger(fn) {
  logFn = fn || (() => {});
}

/**
 * Internal log helper
 */
function log(msg) {
  if (logFn) logFn(msg);
}

// Path to store E2E keys
const E2E_DIR = path.join(os.homedir(), '.vibe');
const E2E_KEYS_FILE = path.join(E2E_DIR, 'e2e-keys.json');

/**
 * Initialize E2E encryption
 * Generates keypair if not exists
 */
function initE2E(options = {}) {
  // Ensure directory exists
  if (!fs.existsSync(E2E_DIR)) {
    fs.mkdirSync(E2E_DIR, { recursive: true });
  }

  // Load or generate keypair
  if (fs.existsSync(E2E_KEYS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(E2E_KEYS_FILE, 'utf8'));

      // Check if it's the new format (version 2) with DER key
      if (saved.version === 2 && saved.privateKeyDer) {
        // New format: load PKCS8 DER private key
        const privateKeyDer = Buffer.from(saved.privateKeyDer, 'base64');
        e2eState.privateKey = nodeCrypto.createPrivateKey({
          key: privateKeyDer,
          format: 'der',
          type: 'pkcs8'
        });
        e2eState.publicKeyRaw = Buffer.from(saved.publicKey, 'base64');
        log('[E2E] Loaded existing keypair (v2)');

        // Load saved peers
        if (saved.peers) {
          for (const [peerId, peerData] of Object.entries(saved.peers)) {
            try {
              // Re-derive shared secret from saved public key
              addPeerFromPublicKey(peerData.publicKey, peerId, false);
              log(`[E2E] Restored peer: ${peerId}`);
            } catch (err) {
              log(`[E2E] Failed to restore peer ${peerId}: ${err.message}`);
            }
          }
        }
      } else {
        // Old format or corrupted - regenerate
        log('[E2E] Old key format detected, generating new pair');
        generateNewKeypair();
      }
    } catch (err) {
      log('[E2E] Failed to load keys, generating new pair: ' + err.message);
      generateNewKeypair();
    }
  } else {
    generateNewKeypair();
    log('[E2E] Generated new keypair');
  }

  e2eState.enabled = true;
  return e2eState;
}

/**
 * Generate a new X25519 keypair using Node.js native crypto
 */
function generateNewKeypair() {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('x25519');

  e2eState.privateKey = privateKey;

  // Export public key as raw bytes for sharing
  e2eState.publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);

  saveKeypair();
}

/**
 * Save keypair to disk
 */
function saveKeypair() {
  // Export private key in PKCS8 DER format for proper storage
  const privateKeyDer = e2eState.privateKey.export({ type: 'pkcs8', format: 'der' });

  // Convert peers Map to object for JSON storage
  const peersObj = {};
  for (const [peerId, peer] of e2eState.peers) {
    peersObj[peerId] = {
      publicKey: peer.publicKey.toString('base64'),
      connectedAt: peer.connectedAt || new Date().toISOString()
    };
  }

  const data = {
    version: 2,
    publicKey: e2eState.publicKeyRaw.toString('base64'),
    privateKeyDer: privateKeyDer.toString('base64'),
    peers: peersObj,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(E2E_KEYS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Derive AES-256 key from X25519 shared secret using HKDF
 */
function deriveAESKey(sharedSecret) {
  const salt = Buffer.from('minivibe-e2e-v1', 'utf8');
  const info = Buffer.from('aes-256-gcm', 'utf8');
  return nodeCrypto.hkdfSync('sha256', sharedSecret, salt, info, 32);
}

/**
 * Convert raw X25519 public key to Node.js KeyObject
 */
function rawToPublicKey(peerPublicKeyRaw) {
  // Construct proper SPKI format for X25519
  const spkiPrefix = Buffer.from([
    0x30, 0x2a,  // SEQUENCE, 42 bytes
    0x30, 0x05,  // SEQUENCE, 5 bytes (algorithm identifier)
    0x06, 0x03, 0x2b, 0x65, 0x6e,  // OID 1.3.101.110 (X25519)
    0x03, 0x21, 0x00  // BIT STRING, 33 bytes (with leading 0)
  ]);
  const spkiKey = Buffer.concat([spkiPrefix, peerPublicKeyRaw]);

  return nodeCrypto.createPublicKey({
    key: spkiKey,
    format: 'der',
    type: 'spki'
  });
}

/**
 * Add a peer from their public key
 * Internal function used by setPeerPublicKey and loadSavedPeer
 */
function addPeerFromPublicKey(peerPublicKeyBase64, peerId, save = true) {
  if (!e2eState.privateKey) {
    throw new Error('E2E not initialized');
  }

  // Validate base64 format
  if (!peerPublicKeyBase64 || typeof peerPublicKeyBase64 !== 'string') {
    throw new Error('Invalid public key: must be a base64 string');
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(peerPublicKeyBase64)) {
    throw new Error('Invalid public key: not valid base64');
  }

  const peerPublicKeyRaw = Buffer.from(peerPublicKeyBase64, 'base64');

  if (peerPublicKeyRaw.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${peerPublicKeyRaw.length}`);
  }

  const peerPublicKey = rawToPublicKey(peerPublicKeyRaw);

  // Compute X25519 shared secret
  const sharedSecret = nodeCrypto.diffieHellman({
    privateKey: e2eState.privateKey,
    publicKey: peerPublicKey
  });

  // Derive AES-256 key from shared secret using HKDF
  const aesKey = deriveAESKey(sharedSecret);

  // Add to peers map
  e2eState.peers.set(peerId, {
    publicKey: peerPublicKeyRaw,
    sharedSecret: aesKey,
    connectedAt: new Date().toISOString()
  });

  if (save) {
    saveKeypair();
  }

  return true;
}

/**
 * Process peer's public key (received from iOS/Web)
 * Adds peer to the multi-peer map
 */
function setPeerPublicKey(peerPublicKeyBase64, peerId = null) {
  const effectivePeerId = peerId || 'default';

  addPeerFromPublicKey(peerPublicKeyBase64, effectivePeerId, true);

  log(`[E2E] Peer connected: ${effectivePeerId} (total: ${e2eState.peers.size})`);

  return true;
}

/**
 * Remove a peer (on disconnect)
 */
function removePeer(peerId) {
  if (e2eState.peers.has(peerId)) {
    e2eState.peers.delete(peerId);
    saveKeypair();
    log(`[E2E] Peer removed: ${peerId} (remaining: ${e2eState.peers.size})`);
    return true;
  }
  return false;
}

/**
 * Get list of connected peer IDs
 */
function getConnectedPeers() {
  return Array.from(e2eState.peers.keys());
}

/**
 * Load saved peer and restore shared secret
 */
function loadSavedPeer(peerId = 'default') {
  if (!e2eState.privateKey) {
    return false;
  }

  // Peers are now loaded during initE2E
  return e2eState.peers.has(peerId);
}

/**
 * Encrypt a message for ALL connected peers using AES-256-GCM
 * Returns v2 format with recipients map
 */
function encrypt(plaintext) {
  if (e2eState.peers.size === 0) {
    throw new Error('E2E not ready - no peers connected');
  }

  const plaintextBuffer = Buffer.from(
    typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext),
    'utf8'
  );

  const recipients = {};

  // Encrypt for each connected peer
  for (const [peerId, peer] of e2eState.peers) {
    // Each recipient gets unique nonce (critical for security)
    const nonce = nodeCrypto.randomBytes(12);

    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', peer.sharedSecret, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertextWithTag = Buffer.concat([encrypted, authTag]);

    recipients[peerId] = {
      nonce: nonce.toString('base64'),
      ciphertext: ciphertextWithTag.toString('base64')
    };
  }

  return {
    e2e: true,
    v: 2,
    recipients
  };
}

/**
 * Decrypt a message - handles both v1 (single peer) and v2 (multi-peer) formats
 * For v2, tries to decrypt using any available peer's key
 */
function decrypt(encrypted, myPeerId = null) {
  if (e2eState.peers.size === 0) {
    throw new Error('E2E not ready - no peers connected');
  }

  if (!encrypted.e2e) {
    throw new Error('Invalid encrypted message format');
  }

  // V2 format: multi-peer with recipients map
  if (encrypted.v === 2 && encrypted.recipients) {
    // If myPeerId specified, only try that one
    if (myPeerId && encrypted.recipients[myPeerId]) {
      return decryptWithPeer(encrypted.recipients[myPeerId], myPeerId);
    }

    // Try each peer we know about (by matching recipientId to our peerId)
    for (const [peerId, peer] of e2eState.peers) {
      if (encrypted.recipients[peerId]) {
        try {
          return decryptWithPeer(encrypted.recipients[peerId], peerId);
        } catch (err) {
          // Try next peer
          continue;
        }
      }
    }

    // Try partial match or fallback IDs
    const recipientKeys = Object.keys(encrypted.recipients);
    for (const recipientId of recipientKeys) {
      const shouldTry = recipientId.startsWith('peer-') ||
                        recipientKeys.length === 1;

      if (shouldTry) {
        for (const [peerId, peer] of e2eState.peers) {
          try {
            return decryptSingle(encrypted.recipients[recipientId], peer.sharedSecret);
          } catch (err) {
            continue;
          }
        }
      }
    }

    // Last resort: brute force ALL recipients with ALL peers
    // This handles cross-platform encryption where deviceId doesn't match
    log(`[E2E] Trying brute force: ${recipientKeys.length} recipients x ${e2eState.peers.size} peers`);
    log(`[E2E] Recipients: ${recipientKeys.join(', ')}`);
    log(`[E2E] Our peers: ${Array.from(e2eState.peers.keys()).join(', ')}`);
    for (const recipientId of recipientKeys) {
      for (const [peerId, peer] of e2eState.peers) {
        try {
          const result = decryptSingle(encrypted.recipients[recipientId], peer.sharedSecret);
          log(`[E2E] Brute force success: recipient=${recipientId.slice(0,8)}, peer=${peerId.slice(0,8)}`);
          return result;
        } catch (err) {
          // Log first failure for debugging
          if (recipientId === recipientKeys[0] && peerId === Array.from(e2eState.peers.keys())[0]) {
            log(`[E2E] First attempt failed: ${err.message}`);
          }
          continue;
        }
      }
    }

    // All attempts failed - increment failure counter (per-message, not per-attempt)
    e2eState.decryptionFailures++;
    if (e2eState.decryptionFailures >= MAX_DECRYPTION_FAILURES) {
      log(`[E2E] WARNING: ${e2eState.decryptionFailures} consecutive message decryption failures`);
    }
    throw new Error('No matching recipient found for decryption');
  }

  // V1 format: single peer (backwards compatibility)
  // Try all peers since we don't know which one sent the message
  if (encrypted.v === 1 || (!encrypted.v && encrypted.nonce && encrypted.ciphertext)) {
    for (const [peerId, peer] of e2eState.peers) {
      try {
        return decryptSingle(encrypted, peer.sharedSecret);
      } catch (err) {
        // Try next peer
        continue;
      }
    }
    // All attempts failed - increment failure counter
    e2eState.decryptionFailures++;
    if (e2eState.decryptionFailures >= MAX_DECRYPTION_FAILURES) {
      log(`[E2E] WARNING: ${e2eState.decryptionFailures} consecutive message decryption failures`);
    }
    throw new Error('V1 decryption failed with all known peers');
  }

  throw new Error(`Unsupported E2E version: ${encrypted.v}`);
}

/**
 * Decrypt with specific peer's data (v2 format)
 */
function decryptWithPeer(recipientData, peerId) {
  const peer = e2eState.peers.get(peerId);
  if (!peer) {
    throw new Error(`Unknown peer: ${peerId}`);
  }
  return decryptSingle(recipientData, peer.sharedSecret);
}

/**
 * Decrypt single ciphertext with given shared secret
 */
function decryptSingle(encrypted, sharedSecret) {
  if (!encrypted.nonce || !encrypted.ciphertext) {
    throw new Error('Invalid encrypted message format');
  }

  const nonce = Buffer.from(encrypted.nonce, 'base64');
  const ciphertextWithTag = Buffer.from(encrypted.ciphertext, 'base64');

  if (nonce.length !== 12) {
    throw new Error(`Invalid nonce length: expected 12 bytes, got ${nonce.length}`);
  }

  const authTagLength = 16;
  if (ciphertextWithTag.length < authTagLength) {
    throw new Error('Ciphertext too short');
  }

  const ciphertext = ciphertextWithTag.slice(0, -authTagLength);
  const authTag = ciphertextWithTag.slice(-authTagLength);

  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', sharedSecret, nonce);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    // Success - reset failure counter (any successful decrypt clears the counter)
    e2eState.decryptionFailures = 0;
    return decrypted.toString('utf8');
  } catch (err) {
    // Don't increment here - let the caller track per-message failures
    throw new Error('Decryption failed - invalid ciphertext or wrong key');
  }
}

/**
 * Check if E2E keys appear to be healthy
 */
function isKeyHealthy() {
  return e2eState.decryptionFailures < MAX_DECRYPTION_FAILURES;
}

/**
 * Check if key re-exchange is needed due to repeated failures
 */
function needsKeyReExchange() {
  return e2eState.decryptionFailures >= MAX_DECRYPTION_FAILURES;
}

/**
 * Reset peers and prepare for fresh key exchange
 * Call this when decryption repeatedly fails
 */
function resetForKeyReExchange() {
  log('[E2E] Resetting peers for fresh key exchange...');
  e2eState.peers.clear();
  e2eState.decryptionFailures = 0;
  saveKeypair();
  log('[E2E] Peers cleared. Ready for fresh key exchange.');
  return true;
}

/**
 * Encrypt message content for WebSocket send
 */
function encryptContent(message) {
  if (!isReady()) {
    return message;
  }

  if (typeof message === 'string') {
    try {
      message = JSON.parse(message);
    } catch {
      return message;
    }
  }

  if (message.content !== undefined) {
    const encrypted = { ...message };
    encrypted.content = encrypt(message.content);
    return JSON.stringify(encrypted);
  }

  return JSON.stringify(message);
}

/**
 * Decrypt message content from WebSocket receive
 */
function decryptContent(message) {
  if (!isReady()) {
    return message;
  }

  let parsed = message;
  if (typeof message === 'string') {
    try {
      parsed = JSON.parse(message);
    } catch {
      return message;
    }
  }

  // Check if whole message is encrypted
  if (parsed.e2e && (parsed.recipients || (parsed.nonce && parsed.ciphertext))) {
    try {
      const decrypted = decrypt(parsed);
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (err) {
      return parsed;
    }
  }

  // Fields that may contain encrypted content
  const sensitiveFields = ['content', 'fullText', 'displayText', 'question', 'data'];
  let decrypted = { ...parsed };
  let didDecrypt = false;

  for (const field of sensitiveFields) {
    if (parsed[field]?.e2e && (parsed[field]?.recipients || (parsed[field]?.nonce && parsed[field]?.ciphertext))) {
      try {
        const decryptedValue = decrypt(parsed[field]);
        try {
          decrypted[field] = JSON.parse(decryptedValue);
        } catch {
          decrypted[field] = decryptedValue;
        }
        didDecrypt = true;
      } catch (err) {
        log(`[E2E] Failed to decrypt field '${field}': ${err.message}`);
      }
    }
  }

  // Check nested message.content
  if (parsed.message?.content?.e2e) {
    try {
      decrypted.message = { ...parsed.message };
      const decryptedContent = decrypt(parsed.message.content);
      try {
        decrypted.message.content = JSON.parse(decryptedContent);
      } catch {
        decrypted.message.content = decryptedContent;
      }
      didDecrypt = true;
    } catch (err) {
      log(`[E2E] Failed to decrypt message.content: ${err.message}`);
    }
  }

  return didDecrypt ? decrypted : parsed;
}

/**
 * Check if E2E is enabled
 */
function isEnabled() {
  return e2eState.enabled;
}

/**
 * Check if E2E is ready (has at least one peer connected)
 */
function isReady() {
  return e2eState.enabled && e2eState.peers.size > 0;
}

/**
 * Get current E2E status
 */
function getStatus() {
  return {
    enabled: e2eState.enabled,
    ready: isReady(),
    hasKeypair: e2eState.privateKey !== null,
    peerCount: e2eState.peers.size,
    peers: Array.from(e2eState.peers.keys()),
    publicKey: e2eState.publicKeyRaw ? e2eState.publicKeyRaw.toString('base64') : null
  };
}

/**
 * Reset E2E state
 */
function reset() {
  e2eState = {
    enabled: false,
    privateKey: null,
    publicKeyRaw: null,
    peers: new Map(),
    decryptionFailures: 0
  };
}

/**
 * Handle E2E key exchange message from peer
 */
function handleKeyExchange(msg) {
  if (msg.type === 'e2e_key_exchange' && msg.publicKey) {
    setPeerPublicKey(msg.publicKey, msg.deviceId || msg.peerId);
    return true;
  }
  return false;
}

/**
 * Create key exchange message to send to peer
 */
function createKeyExchangeMessage(needsResponse = true) {
  if (!e2eState.publicKeyRaw) {
    throw new Error('E2E not initialized');
  }

  return {
    type: 'e2e_key_exchange',
    publicKey: e2eState.publicKeyRaw.toString('base64'),
    needsResponse,
    deviceId: `${os.hostname()}-cli`,
    timestamp: Date.now()
  };
}

// Backwards compatibility aliases
const sharedSecret = null;  // Deprecated
const peerPublicKey = null; // Deprecated
const peerId = null;        // Deprecated

module.exports = {
  initE2E,
  setPeerPublicKey,
  removePeer,
  getConnectedPeers,
  loadSavedPeer,
  encrypt,
  decrypt,
  encryptContent,
  decryptContent,
  isEnabled,
  isReady,
  isKeyHealthy,
  needsKeyReExchange,
  resetForKeyReExchange,
  getStatus,
  reset,
  handleKeyExchange,
  createKeyExchangeMessage,
  setLogger
};
