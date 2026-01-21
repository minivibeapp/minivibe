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
 * Get the expected session file path
 */
export function getSessionFilePath(sessionId: string): string {
  const projectPath = process.cwd().replace(/\//g, '-').replace(/^-/, '');
  return path.join(os.homedir(), '.claude', 'projects', projectPath, `${sessionId}.jsonl`);
}
