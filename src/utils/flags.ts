/**
 * Feature flags and environment variable configuration
 * Pattern inspired by OpenCode's flag system
 *
 * All flags are evaluated dynamically at access time, not at module load time.
 * This allows changing environment variables during runtime.
 *
 * Usage:
 *   import { Flag } from './utils/flags';
 *   const heartbeat = Flag.VIBE_HEARTBEAT_INTERVAL ?? HEARTBEAT_INTERVAL;
 *   if (Flag.VIBE_DEBUG_MESSAGES) { ... }
 */

/**
 * Parse environment variable as boolean
 * Accepts: true, false, 1, 0 (case-insensitive)
 */
function truthy(key: string): boolean {
  const value = process.env[key]?.toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Parse environment variable as positive number
 * Returns undefined if not set or invalid
 */
function number(key: string): number | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Get environment variable as string
 * Returns undefined if not set or empty
 */
function string(key: string): string | undefined {
  return process.env[key] || undefined;
}

/**
 * Feature flags namespace
 * All flags are evaluated at access time via getters for consistency
 */
export namespace Flag {
  // ============================================
  // Connection Settings (override defaults)
  // ============================================

  /** Override initial reconnect delay in milliseconds */
  export declare const VIBE_RECONNECT_DELAY: number | undefined;

  /** Override heartbeat interval in milliseconds */
  export declare const VIBE_HEARTBEAT_INTERVAL: number | undefined;

  /** Maximum reconnect attempts before giving up (0 = infinite) */
  export declare const VIBE_MAX_RECONNECT_ATTEMPTS: number | undefined;

  /** Override token refresh buffer in seconds */
  export declare const VIBE_TOKEN_REFRESH_BUFFER: number | undefined;

  // ============================================
  // Feature Toggles
  // ============================================

  /** Disable E2E encryption even if requested */
  export declare const VIBE_DISABLE_E2E: boolean;

  /** Enable experimental features */
  export declare const VIBE_EXPERIMENTAL: boolean;

  /** Enable experimental event bus architecture */
  export declare const VIBE_EXPERIMENTAL_EVENT_BUS: boolean;

  // ============================================
  // Debug Flags
  // ============================================

  /** Enable verbose logging (alternative to --verbose flag) */
  export declare const VIBE_VERBOSE: boolean;

  /** Log all bridge messages (very verbose) */
  export declare const VIBE_DEBUG_MESSAGES: boolean;

  /** Log permission handling details */
  export declare const VIBE_DEBUG_PERMISSIONS: boolean;

  /** Log session file processing details */
  export declare const VIBE_DEBUG_SESSION_FILE: boolean;

  /** Log E2E encryption details */
  export declare const VIBE_DEBUG_E2E: boolean;

  // ============================================
  // URL Overrides
  // ============================================

  /** Override bridge URL */
  export declare const VIBE_BRIDGE_URL: string | undefined;

  /** Override agent URL */
  export declare const VIBE_AGENT_URL: string | undefined;

  /** Override web app URL */
  export declare const VIBE_WEB_APP_URL: string | undefined;
}

// Define all flags as dynamic getters for consistent runtime evaluation
// Connection settings
Object.defineProperty(Flag, 'VIBE_RECONNECT_DELAY', {
  get: () => number('VIBE_RECONNECT_DELAY'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_HEARTBEAT_INTERVAL', {
  get: () => number('VIBE_HEARTBEAT_INTERVAL'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_MAX_RECONNECT_ATTEMPTS', {
  get: () => number('VIBE_MAX_RECONNECT_ATTEMPTS'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_TOKEN_REFRESH_BUFFER', {
  get: () => number('VIBE_TOKEN_REFRESH_BUFFER'),
  enumerable: true,
});

// Feature toggles
Object.defineProperty(Flag, 'VIBE_DISABLE_E2E', {
  get: () => truthy('VIBE_DISABLE_E2E'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_EXPERIMENTAL', {
  get: () => truthy('VIBE_EXPERIMENTAL'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_EXPERIMENTAL_EVENT_BUS', {
  get: () => truthy('VIBE_EXPERIMENTAL_EVENT_BUS'),
  enumerable: true,
});

// Debug flags
Object.defineProperty(Flag, 'VIBE_VERBOSE', {
  get: () => truthy('VIBE_VERBOSE'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_DEBUG_MESSAGES', {
  get: () => truthy('VIBE_DEBUG_MESSAGES'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_DEBUG_PERMISSIONS', {
  get: () => truthy('VIBE_DEBUG_PERMISSIONS'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_DEBUG_SESSION_FILE', {
  get: () => truthy('VIBE_DEBUG_SESSION_FILE'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_DEBUG_E2E', {
  get: () => truthy('VIBE_DEBUG_E2E'),
  enumerable: true,
});

// URL overrides
Object.defineProperty(Flag, 'VIBE_BRIDGE_URL', {
  get: () => string('VIBE_BRIDGE_URL'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_AGENT_URL', {
  get: () => string('VIBE_AGENT_URL'),
  enumerable: true,
});
Object.defineProperty(Flag, 'VIBE_WEB_APP_URL', {
  get: () => string('VIBE_WEB_APP_URL'),
  enumerable: true,
});

/**
 * Get all currently set flags (useful for debugging)
 */
export function getActiveFlags(): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  const envPrefix = 'VIBE_';

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(envPrefix) && value) {
      flags[key] = value;
    }
  }

  return flags;
}
