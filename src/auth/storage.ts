import * as fs from 'fs';
import * as path from 'path';
import { AUTH_FILE, TOKEN_FILE, VIBE_DIR } from '../utils/config';

/**
 * Stored authentication data structure
 */
export interface StoredAuth {
  idToken: string;
  refreshToken?: string | null;
  updatedAt?: string;
}

/**
 * Get stored auth data (token + refresh token)
 * Tries new JSON format first, falls back to old token-only format
 */
export function getStoredAuth(): StoredAuth | null {
  try {
    // Try new JSON format first
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      return data as StoredAuth;
    }
    // Fall back to old token-only format
    if (fs.existsSync(TOKEN_FILE)) {
      return { idToken: fs.readFileSync(TOKEN_FILE, 'utf8').trim() };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Get just the ID token from storage
 */
export function getStoredToken(): string | null {
  const auth = getStoredAuth();
  return auth?.idToken || null;
}

/**
 * Store auth data (token + refresh token)
 * Also writes to old token file for backwards compatibility
 */
export function storeAuth(idToken: string, refreshToken: string | null = null): boolean {
  try {
    // Ensure directory exists
    if (!fs.existsSync(VIBE_DIR)) {
      fs.mkdirSync(VIBE_DIR, { recursive: true });
    }

    // Write new JSON format
    const data: StoredAuth = {
      idToken,
      refreshToken,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
    fs.chmodSync(AUTH_FILE, 0o600); // Only user can read

    // Also write to old token file for backwards compatibility
    fs.writeFileSync(TOKEN_FILE, idToken, 'utf8');
    fs.chmodSync(TOKEN_FILE, 0o600);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Failed to store auth: ${message}`);
    return false;
  }
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use storeAuth instead
 */
export function storeToken(token: string): boolean {
  return storeAuth(token, null);
}

/**
 * Clear stored authentication
 */
export function clearAuth(): boolean {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
    return true;
  } catch {
    return false;
  }
}
