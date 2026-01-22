import { exec } from 'child_process';
import { DEFAULT_BRIDGE_URL, WEB_APP_URL, AUTH_FILE } from '../utils/config';
import { createSpinner, ui, formatError, ErrorSuggestions, box } from '../utils/terminal';
import { storeAuth } from './storage';

/**
 * Device code response from bridge server
 */
interface DeviceCodeResponse {
  deviceId: string;
  code: string;
  expiresIn: number;
}

/**
 * Poll response from bridge server
 */
interface PollResponse {
  status?: 'pending' | 'complete';
  token?: string;
  refreshToken?: string;
  email?: string;
  error?: string;
}

/**
 * Convert WebSocket URL to HTTP URL
 */
function wsToHttpUrl(wsUrl: string): string {
  return wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
}

/**
 * Open URL in default browser
 */
function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  } else {
    const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} ${url}`);
  }
}

/**
 * Device code login flow
 * @param openBrowserWindow Whether to automatically open browser
 */
export async function startLoginFlow(openBrowserWindow = true): Promise<void> {
  const bridgeHttpUrl = wsToHttpUrl(DEFAULT_BRIDGE_URL);

  console.log('');
  console.log(ui.brand('MiniVibe Login'));
  console.log(ui.dim('═'.repeat(38)));
  console.log('');

  // Step 1: Request device code
  const codeSpinner = createSpinner('Requesting device code...');

  try {
    const codeRes = await fetch(`${bridgeHttpUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!codeRes.ok) {
      codeSpinner.fail('Failed to get device code');
      console.log('');
      console.log(formatError({
        message: `Server returned ${codeRes.status}`,
        code: 'AUTH_CODE_FAILED',
        suggestions: ErrorSuggestions.CONNECTION_FAILED,
      }));
      process.exit(1);
    }

    const { deviceId, code, expiresIn } = (await codeRes.json()) as DeviceCodeResponse;
    codeSpinner.success('Device code received');

    // Display the code in a box
    const pairUrl = `${WEB_APP_URL}/pair`;
    console.log('');
    console.log(box(`Visit:  ${pairUrl}\nCode:   ${ui.highlight(code)}`, { title: 'Pair Device', padding: 1 }));
    console.log('');
    console.log(ui.dim(`Code expires in ${Math.floor(expiresIn / 60)} minutes`));

    // Open browser if requested
    if (openBrowserWindow) {
      openBrowser(pairUrl);
      console.log(ui.dim('Browser opened automatically'));
    }
    console.log('');

    // Step 2: Poll for authentication
    const authSpinner = createSpinner('Waiting for authentication...');

    const pollInterval = 3000; // 3 seconds
    const maxAttempts = Math.ceil((expiresIn * 1000) / pollInterval);
    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempts++;

      try {
        const pollRes = await fetch(`${bridgeHttpUrl}/device/poll/${deviceId}`);

        // Handle non-JSON responses gracefully
        const contentType = pollRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            authSpinner.fail('Server error');
            console.log('');
            console.log(formatError({
              message: 'Invalid response format from server',
              code: 'AUTH_INVALID_RESPONSE',
              suggestions: ErrorSuggestions.CONNECTION_FAILED,
            }));
            process.exit(1);
          }
          authSpinner.update(`Waiting for authentication... (retry ${consecutiveErrors})`);
          continue;
        }

        const pollData = (await pollRes.json()) as PollResponse;
        consecutiveErrors = 0; // Reset on successful response

        if (pollData.status === 'complete' && pollData.token) {
          authSpinner.success('Authentication complete');
          storeAuth(pollData.token, pollData.refreshToken || null);
          console.log('');
          console.log(ui.success(`Logged in as ${pollData.email || 'user'}`));
          console.log(ui.dim(`Auth saved to ${AUTH_FILE}`));
          if (pollData.refreshToken) {
            console.log(ui.dim('Token auto-refresh enabled'));
          }
          console.log('');
          process.exit(0);
        } else if (pollRes.status === 404 || pollData.error === 'Device not found or expired') {
          authSpinner.fail('Code expired');
          console.log('');
          console.log(formatError({
            message: 'The pairing code has expired',
            code: 'AUTH_CODE_EXPIRED',
            suggestions: ['Run: vibe login to get a new code'],
          }));
          process.exit(1);
        } else if (pollData.error) {
          authSpinner.fail('Authentication failed');
          console.log('');
          console.log(formatError({
            message: pollData.error,
            code: 'AUTH_ERROR',
            suggestions: ErrorSuggestions.AUTH_FAILED,
          }));
          process.exit(1);
        }

        // Update spinner with remaining time
        const remainingMins = Math.ceil((maxAttempts - attempts) * pollInterval / 60000);
        authSpinner.update(`Waiting for authentication... (${remainingMins}m remaining)`);
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          authSpinner.fail('Network error');
          console.log('');
          console.log(formatError({
            message: message,
            code: 'AUTH_NETWORK_ERROR',
            suggestions: ErrorSuggestions.CONNECTION_FAILED,
          }));
          process.exit(1);
        }
        authSpinner.update(`Waiting for authentication... (retrying connection)`);
      }
    }

    authSpinner.fail('Login timed out');
    console.log('');
    console.log(formatError({
      message: 'Login request timed out',
      code: 'AUTH_TIMEOUT',
      suggestions: ['Run: vibe login to try again'],
    }));
    process.exit(1);
  } catch (err) {
    // Stop spinner if still running (safe to call multiple times)
    codeSpinner.stop();
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log('');
    console.log(formatError({
      message: `Failed to start login: ${message}`,
      code: 'AUTH_INIT_FAILED',
      suggestions: ErrorSuggestions.CONNECTION_FAILED,
    }));
    process.exit(1);
  }
}

/**
 * Headless device code login flow (no browser auto-open)
 * Useful for SSH sessions or headless environments
 */
export async function startHeadlessLogin(): Promise<void> {
  await startLoginFlow(false);
}
