import { exec } from 'child_process';
import { DEFAULT_BRIDGE_URL, WEB_APP_URL, AUTH_FILE } from '../utils/config';
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

  console.log(`
🔐 Login
══════════════════════════════════════
`);

  try {
    // Request a device code from the bridge server
    console.log('Requesting device code...');
    const codeRes = await fetch(`${bridgeHttpUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!codeRes.ok) {
      console.error(`Failed to get device code: ${codeRes.status}`);
      process.exit(1);
    }

    const { deviceId, code, expiresIn } = (await codeRes.json()) as DeviceCodeResponse;
    const pairUrl = `${WEB_APP_URL}/pair`;

    console.log(`   Visit:  ${pairUrl}`);
    console.log(`   Code:   ${code}`);
    console.log('');
    console.log(`   Code expires in ${Math.floor(expiresIn / 60)} minutes.`);

    // Open browser if requested
    if (openBrowserWindow) {
      console.log('   Opening browser...');
      openBrowser(pairUrl);
    }

    console.log('   Waiting for authentication...');
    console.log('');
    console.log('   Press Ctrl+C to cancel.');
    console.log('');

    // Poll for token
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
            console.error(`\nServer error: Invalid response format`);
            process.exit(1);
          }
          process.stdout.write('!');
          continue;
        }

        const pollData = (await pollRes.json()) as PollResponse;
        consecutiveErrors = 0; // Reset on successful response

        if (pollData.status === 'complete' && pollData.token) {
          console.log(''); // New line after dots
          storeAuth(pollData.token, pollData.refreshToken || null);
          console.log(`✅ Logged in as ${pollData.email}`);
          console.log(`   Auth saved to ${AUTH_FILE}`);
          if (pollData.refreshToken) {
            console.log(`   Token auto-refresh enabled`);
          }
          process.exit(0);
        } else if (pollRes.status === 404 || pollData.error === 'Device not found or expired') {
          console.log('\n\nCode expired. Please try again.');
          process.exit(1);
        } else if (pollData.error) {
          console.error(`\nError: ${pollData.error}`);
          process.exit(1);
        }

        // Still pending, continue polling
        process.stdout.write('.');
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error(`\nNetwork error: ${message}`);
          console.error('Please check your internet connection and try again.');
          process.exit(1);
        }
        // Temporary network error - show warning but continue
        process.stdout.write('!');
      }
    }

    console.log('\n\nLogin timed out. Please try again.');
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Failed to start login: ${message}`);
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
