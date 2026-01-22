/**
 * Layered configuration manager
 * Pattern inspired by OpenCode's config system
 *
 * Precedence (highest to lowest):
 * 1. Environment variables (VIBE_*)
 * 2. CLI arguments
 * 3. Project config (.vibe/config.json in cwd)
 * 4. User config (~/.vibe/config.json)
 * 5. Defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import { Flag } from '../utils/flags';

// ============================================
// Paths
// ============================================

const VIBE_DIR = path.join(os.homedir(), '.vibe');
const USER_CONFIG_FILE = path.join(VIBE_DIR, 'config.json');

// ============================================
// Config Schema (for file-based config)
// ============================================

/**
 * Schema for config files (~/.vibe/config.json)
 * All fields optional to allow partial configs
 */
export const FileConfigSchema = z.object({
  // Connection settings
  bridgeUrl: z.string().url().optional(),
  agentUrl: z.string().url().optional(),

  // Feature toggles
  e2eEnabled: z.boolean().optional(),
  verboseMode: z.boolean().optional(),

  // Timing overrides (milliseconds)
  heartbeatInterval: z.number().int().positive().optional(),
  reconnectDelay: z.number().int().positive().optional(),
  tokenRefreshBuffer: z.number().int().positive().optional(),

  // Limits
  maxMobileMessages: z.number().int().positive().optional(),
  maxCompletedTools: z.number().int().positive().optional(),
  e2ePendingTimeoutMs: z.number().int().positive().optional(),

  // Display
  theme: z.enum(['default', 'dark', 'light']).optional(),
}).strict();

export type FileConfig = z.infer<typeof FileConfigSchema>;

/**
 * Full config schema (with all required fields filled)
 */
export const ConfigSchema = z.object({
  // Connection
  bridgeUrl: z.string().url(),
  agentUrl: z.string().url().optional(),

  // Features
  e2eEnabled: z.boolean(),
  verboseMode: z.boolean(),

  // Timing (milliseconds)
  heartbeatInterval: z.number().int().positive(),
  reconnectDelay: z.number().int().positive(),
  tokenRefreshBuffer: z.number().int().positive(),

  // Limits
  maxMobileMessages: z.number().int().positive(),
  maxCompletedTools: z.number().int().positive(),
  e2ePendingTimeoutMs: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================
// Defaults
// ============================================

const DEFAULT_CONFIG: Config = {
  bridgeUrl: 'wss://ws.minivibeapp.com',
  e2eEnabled: false,
  verboseMode: false,
  heartbeatInterval: 30000,
  reconnectDelay: 2000,
  tokenRefreshBuffer: 300,
  maxMobileMessages: 100,
  maxCompletedTools: 500,
  e2ePendingTimeoutMs: 30000,
};

// ============================================
// Cache
// ============================================

let cachedConfig: Config | null = null;
let cacheKey: string | null = null;

/**
 * Generate cache key based on current state
 */
function getCacheKey(): string {
  // Include CWD and env vars that affect config
  const envPart = [
    Flag.VIBE_BRIDGE_URL,
    Flag.VIBE_AGENT_URL,
    Flag.VIBE_VERBOSE,
    Flag.VIBE_DISABLE_E2E,
    Flag.VIBE_HEARTBEAT_INTERVAL,
    Flag.VIBE_RECONNECT_DELAY,
  ].join('|');
  return `${process.cwd()}|${envPart}`;
}

// ============================================
// Config Manager
// ============================================

export namespace Config {
  /**
   * Load configuration with layered precedence
   * Results are cached until invalidate() is called or cwd/env changes
   */
  export function load(cliOptions?: Partial<Config>): Config {
    const currentKey = getCacheKey();

    // Return cached if available and no CLI options override
    if (cachedConfig && cacheKey === currentKey && !cliOptions) {
      return cachedConfig;
    }

    // Start with defaults
    let config = { ...DEFAULT_CONFIG };

    // Layer 1: User config (~/.vibe/config.json)
    const userConfig = loadFile(USER_CONFIG_FILE);
    config = mergeConfig(config, userConfig);

    // Layer 2: Project config (.vibe/config.json in cwd)
    const projectConfigPath = path.join(process.cwd(), '.vibe', 'config.json');
    const projectConfig = loadFile(projectConfigPath);
    config = mergeConfig(config, projectConfig);

    // Layer 3: CLI options (partial)
    if (cliOptions) {
      config = mergeConfig(config, cliOptions);
    }

    // Layer 4: Environment variables (highest priority)
    config = applyEnvOverrides(config);

    // Validate final config
    const result = ConfigSchema.safeParse(config);
    if (!result.success) {
      console.warn('[config] Validation warnings:', result.error.issues.map(i => i.message).join(', '));
      // Continue with best-effort config
    } else {
      config = result.data;
    }

    // Cache only if no CLI options (CLI options make caching unreliable)
    if (!cliOptions) {
      cachedConfig = config;
      cacheKey = currentKey;
    }

    return config;
  }

  /**
   * Invalidate cached config (call when config file changes)
   */
  export function invalidate(): void {
    cachedConfig = null;
    cacheKey = null;
  }

  /**
   * Save user configuration to ~/.vibe/config.json
   */
  export function save(config: Partial<FileConfig>): boolean {
    try {
      // Validate the input
      const validation = FileConfigSchema.partial().safeParse(config);
      if (!validation.success) {
        console.warn('[config] Invalid config to save:', validation.error.issues);
        return false;
      }

      // Ensure directory exists
      if (!fs.existsSync(VIBE_DIR)) {
        fs.mkdirSync(VIBE_DIR, { recursive: true });
      }

      // Load existing config and merge
      const existing = loadFile(USER_CONFIG_FILE);
      const merged = { ...existing, ...validation.data };

      // Write with pretty formatting
      fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');

      // Set restrictive permissions on Unix
      if (process.platform !== 'win32') {
        fs.chmodSync(USER_CONFIG_FILE, 0o600);
      }

      // Invalidate cache
      invalidate();

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[config] Failed to save: ${message}`);
      return false;
    }
  }

  /**
   * Get a specific config value
   */
  export function get<K extends keyof Config>(key: K): Config[K] {
    return load()[key];
  }

  /**
   * Check if a config file exists
   */
  export function exists(type: 'user' | 'project' = 'user'): boolean {
    const filePath =
      type === 'user' ? USER_CONFIG_FILE : path.join(process.cwd(), '.vibe', 'config.json');
    return fs.existsSync(filePath);
  }

  /**
   * Get the path to a config file
   */
  export function getPath(type: 'user' | 'project' = 'user'): string {
    return type === 'user' ? USER_CONFIG_FILE : path.join(process.cwd(), '.vibe', 'config.json');
  }

  /**
   * Get the default configuration values
   */
  export function getDefaults(): Config {
    return { ...DEFAULT_CONFIG };
  }
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Load and parse a config file
 */
function loadFile(filePath: string): Partial<FileConfig> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Handle empty files gracefully
      if (!content.trim()) {
        return {};
      }
      const parsed = JSON.parse(content);
      const result = FileConfigSchema.partial().safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      console.warn(`[config] Invalid config at ${filePath}:`, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
  } catch (err) {
    // Handle JSON parse errors gracefully
    if (err instanceof SyntaxError) {
      console.warn(`[config] Invalid JSON at ${filePath}: ${err.message}`);
    } else {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.warn(`[config] Failed to load ${filePath}: ${message}`);
    }
  }
  return {};
}

/**
 * Merge config objects, only overwriting with defined values
 */
function mergeConfig<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== null) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Apply environment variable overrides
 */
function applyEnvOverrides(config: Config): Config {
  const result = { ...config };

  // URL overrides
  if (Flag.VIBE_BRIDGE_URL) {
    result.bridgeUrl = Flag.VIBE_BRIDGE_URL;
  }
  if (Flag.VIBE_AGENT_URL) {
    result.agentUrl = Flag.VIBE_AGENT_URL;
  }

  // Feature toggles
  if (Flag.VIBE_VERBOSE) {
    result.verboseMode = true;
  }
  if (Flag.VIBE_DISABLE_E2E) {
    result.e2eEnabled = false;
  }

  // Timing overrides
  if (Flag.VIBE_HEARTBEAT_INTERVAL) {
    result.heartbeatInterval = Flag.VIBE_HEARTBEAT_INTERVAL;
  }
  if (Flag.VIBE_RECONNECT_DELAY) {
    result.reconnectDelay = Flag.VIBE_RECONNECT_DELAY;
  }
  if (Flag.VIBE_TOKEN_REFRESH_BUFFER) {
    result.tokenRefreshBuffer = Flag.VIBE_TOKEN_REFRESH_BUFFER;
  }

  return result;
}
