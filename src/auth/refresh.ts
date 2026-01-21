import { FIREBASE_CONFIG, TOKEN_REFRESH_BUFFER } from '../utils/config';
import { logStatus, logSuccess } from '../utils/logger';
import { getStoredAuth, storeAuth } from './storage';

/**
 * Decoded JWT payload structure (partial)
 */
interface JWTPayload {
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * User info extracted from token
 */
export interface UserInfo {
  email: string | null;
  name: string | null;
  picture: string | null;
  userId: string | null;
}

/**
 * Firebase token refresh response
 */
interface TokenRefreshResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
  refresh_token: string;
  id_token: string;
  user_id: string;
  project_id: string;
}

/**
 * Firebase error response
 */
interface FirebaseErrorResponse {
  error?: {
    message?: string;
    code?: number;
  };
}

/**
 * Check if JWT token is expired or will expire within given seconds
 */
export function isTokenExpired(token: string | null | undefined, bufferSeconds = 60): boolean {
  if (!token) return true;

  try {
    // Decode JWT payload (middle part)
    const parts = token.split('.');
    if (parts.length !== 3) return true;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as JWTPayload;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp <= now + bufferSeconds;
  } catch {
    return true; // Treat invalid tokens as expired
  }
}

/**
 * Decode JWT token to get payload (without verification)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64').toString()) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Get current user info from stored token
 */
export function getUserInfo(): UserInfo | null {
  const auth = getStoredAuth();
  if (!auth?.idToken) return null;

  const payload = decodeToken(auth.idToken);
  if (!payload) return null;

  return {
    email: payload.email || null,
    name: payload.name || null,
    picture: payload.picture || null,
    userId: payload.sub || null,
  };
}

/**
 * Refresh the ID token using Firebase REST API
 */
export async function refreshIdToken(): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth?.refreshToken) {
    logStatus('No refresh token available');
    return null;
  }

  try {
    logStatus('Refreshing authentication token...');

    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${auth.refreshToken}`,
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as FirebaseErrorResponse;
      logStatus(`Token refresh failed: ${error.error?.message || response.status}`);
      return null;
    }

    const data = (await response.json()) as TokenRefreshResponse;

    // Store new tokens
    storeAuth(data.id_token, data.refresh_token);
    logSuccess('✅ Token refreshed successfully');

    return data.id_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logStatus(`Token refresh error: ${message}`);
    return null;
  }
}

/**
 * Proactively refresh token if expired or close to expiry
 * Returns the valid token or null if refresh failed
 */
export async function ensureValidToken(): Promise<string | null> {
  const auth = getStoredAuth();
  if (!auth?.idToken) return null;

  // If token is expired or will expire within buffer time, refresh it
  if (isTokenExpired(auth.idToken, TOKEN_REFRESH_BUFFER)) {
    if (auth.refreshToken) {
      logStatus('Token expired or expiring soon, refreshing...');
      return await refreshIdToken();
    }
    return null;
  }

  return auth.idToken;
}
