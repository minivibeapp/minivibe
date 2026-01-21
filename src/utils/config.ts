import * as path from 'path';
import * as os from 'os';

/**
 * Bridge server URLs
 */
export const DEFAULT_BRIDGE_URL = 'wss://ws.minivibeapp.com';
export const DEFAULT_AGENT_URL = 'ws://localhost:9999';
export const WEB_APP_URL = 'https://minivibeapp.com';

/**
 * Local file paths
 */
export const VIBE_DIR = path.join(os.homedir(), '.vibe');
export const TOKEN_FILE = path.join(VIBE_DIR, 'token');
export const AUTH_FILE = path.join(VIBE_DIR, 'auth.json');
export const E2E_KEYS_FILE = path.join(VIBE_DIR, 'e2e-keys.json');

// Agent uses separate directory
export const AGENT_DIR = path.join(os.homedir(), '.vibe-agent');
export const AGENT_PORT_FILE = path.join(AGENT_DIR, 'port');
export const AGENT_CONFIG_FILE = path.join(AGENT_DIR, 'config.json');
export const AGENT_SESSION_HISTORY_FILE = path.join(AGENT_DIR, 'session-history.json');
export const AGENT_PID_FILE = path.join(AGENT_DIR, 'pid');
export const AGENT_START_TIME_FILE = path.join(AGENT_DIR, 'start_time');

/**
 * Agent-specific settings
 */
export const LOCAL_SERVER_PORT = 9999;
export const PAIRING_URL = 'https://minivibeapp.com/pair';
export const MAX_SESSION_HISTORY = 100;
export const MAX_SESSION_HISTORY_AGE_DAYS = 30;

/**
 * Firebase configuration (public - safe to embed in client code)
 * Update from: Firebase Console → Project Settings → Web App
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAJKYavMidKYxRpfhP2IHUiy8dafc3ISqc',
  authDomain: 'minivibe-adaf4.firebaseapp.com',
  projectId: 'minivibe-adaf4',
  storageBucket: 'minivibe-adaf4.firebasestorage.app',
  messagingSenderId: '11868121436',
  appId: '1:11868121436:web:fa1a4941e6b222bc59b999',
  measurementId: 'G-29YEJLRVDS',
} as const;

/**
 * Timeouts and intervals (in milliseconds)
 */
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const RECONNECT_DELAY = 3000; // 3 seconds
export const TOKEN_REFRESH_BUFFER = 300; // 5 minutes before expiry

/**
 * Limits
 */
export const MAX_E2E_PENDING_MESSAGES = 10;
export const MAX_COMPLETED_TOOLS = 500;
export const MAX_MOBILE_MESSAGES = 100;
export const E2E_PENDING_TIMEOUT_MS = 30000; // 30 seconds
