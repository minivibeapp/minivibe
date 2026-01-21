/**
 * Claude process utilities
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Check if Claude Code CLI is installed
 */
export function checkClaudeInstalled(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the path to claude executable
 */
export function findClaudePath(): string {
  try {
    const cmd = os.platform() === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    return result.split('\n')[0].trim();
  } catch {
    if (os.platform() === 'win32') {
      const userPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe');
      if (fs.existsSync(userPath)) return userPath;
      return 'claude';
    }
    return '/opt/homebrew/bin/claude';
  }
}

/**
 * Get the session file path
 * Tries multiple naming strategies and scans directories to find the file
 */
export function getSessionFilePath(sessionId: string): string {
  const cwd = process.cwd();
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  // Normalize path separators (handle both Windows \ and Unix /)
  // Strategy 1: Direct replacement (e.g., /home/ubuntu -> -home-ubuntu, C:\Users -> C--Users)
  const directHash = cwd.replace(/[\\/]/g, '-');
  // Strategy 2: Without leading dash (e.g., home-ubuntu)
  const noLeadingDash = directHash.replace(/^-/, '');
  // Strategy 3: Windows drive letter normalization (e.g., C:-Users -> C-Users)
  const normalizedWindows = noLeadingDash.replace(/^([A-Za-z]):-/, '$1-');

  const candidates = [noLeadingDash, directHash, normalizedWindows];

  // Try to find existing directory that matches
  if (fs.existsSync(projectsDir)) {
    for (const candidate of candidates) {
      const candidateDir = path.join(projectsDir, candidate);
      if (fs.existsSync(candidateDir)) {
        return path.join(candidateDir, `${sessionId}.jsonl`);
      }
    }

    // Scan for session file in any project directory
    try {
      const dirs = fs.readdirSync(projectsDir);
      for (const dir of dirs) {
        const sessionFile = path.join(projectsDir, dir, `${sessionId}.jsonl`);
        if (fs.existsSync(sessionFile)) {
          return sessionFile;
        }
      }
    } catch {
      // Ignore scan errors
    }
  }

  // Fall back to noLeadingDash (will be created by Claude)
  return path.join(projectsDir, noLeadingDash, `${sessionId}.jsonl`);
}
