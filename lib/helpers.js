/**
 * Helper functions extracted from vibe.js for testing
 */

const path = require('path');

// Slash commands that can be used during a session
const SLASH_COMMANDS = ['/name', '/upload', '/download', '/files', '/status', '/info', '/help'];

/**
 * Check if input matches a slash command
 * @param {string} input - The input string to check
 * @returns {string|null} - The matched command or null
 */
function matchSlashCommand(input) {
  const trimmed = input.trim();
  return SLASH_COMMANDS.find(cmd =>
    trimmed === cmd || trimmed.startsWith(cmd + ' ')
  ) || null;
}

/**
 * Parse slash command into command and arguments
 * @param {string} input - The full input string
 * @returns {{ cmd: string, args: string[] }} - Parsed command and arguments
 */
function parseSlashCommand(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  return { cmd, args };
}

/**
 * Process input character for buffer management
 * Returns action to take based on character code
 * @param {number} code - Character code
 * @param {string} currentBuffer - Current buffer content
 * @returns {{ action: string, newBuffer: string }}
 */
function processInputChar(code, currentBuffer) {
  // Enter key (CR or LF)
  if (code === 13 || code === 10) {
    return { action: 'enter', newBuffer: '' };
  }
  // Backspace (0x7f) or Delete (0x08)
  if (code === 127 || code === 8) {
    return {
      action: 'backspace',
      newBuffer: currentBuffer.length > 0 ? currentBuffer.slice(0, -1) : ''
    };
  }
  // Ctrl+C (0x03) - clear buffer
  if (code === 3) {
    return { action: 'clear', newBuffer: '' };
  }
  // Ctrl+U (0x15) - clear line
  if (code === 21) {
    return { action: 'clear', newBuffer: '' };
  }
  // Escape character (0x1b) - start of escape sequence
  if (code === 27) {
    return { action: 'escape', newBuffer: '' };
  }
  // Regular printable character (space to tilde in ASCII)
  if (code >= 32 && code <= 126) {
    return { action: 'char', newBuffer: currentBuffer + String.fromCharCode(code) };
  }
  // Other control characters - pass through but don't buffer
  return { action: 'passthrough', newBuffer: currentBuffer };
}

/**
 * Format file size to human readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted size
 */
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Get MIME type from filename
 * @param {string} filename - The filename
 * @returns {string} - MIME type
 */
function getMimeType(filename) {
  if (!filename) return 'application/octet-stream';
  const ext = path.extname(filename).toLowerCase();
  const types = {
    // Text
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.md': 'text/markdown',
    '.log': 'text/plain',
    // Documents
    '.pdf': 'application/pdf',
    // Archives
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    // Code (extended)
    '.py': 'text/x-python',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript-jsx',
    '.jsx': 'text/jsx',
    '.swift': 'text/x-swift',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Subcommand groups configuration
 */
const SUBCOMMAND_GROUPS = {
  'file': ['upload', 'list', 'download', 'delete'],
  'session': ['list', 'rename', 'info'],
  'note': ['create', 'list'],
};

/**
 * Parse multi-level subcommand from args
 * @param {string[]} args - Command line arguments
 * @returns {{ mode: { group: string, action: string } | null, remaining: string[] }}
 */
function parseSubcommand(args) {
  if (args.length >= 2 && SUBCOMMAND_GROUPS[args[0]]) {
    const group = args[0];
    const action = args[1];
    if (SUBCOMMAND_GROUPS[group].includes(action)) {
      return {
        mode: { group, action },
        remaining: args.slice(2)
      };
    }
  }
  return { mode: null, remaining: args };
}

/**
 * Calculate uptime from start time
 * @param {number} startTime - Start time in milliseconds
 * @returns {string|null} - Formatted uptime or null if invalid
 */
function calculateUptime(startTime) {
  const uptimeMs = Date.now() - startTime;
  if (uptimeMs <= 0 || isNaN(startTime)) {
    return null;
  }
  const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Validate port number
 * @param {string|number} port - Port to validate
 * @returns {number|null} - Valid port number or null
 */
function validatePort(port) {
  const num = parseInt(port, 10);
  if (isNaN(num) || num <= 0 || num > 65535) {
    return null;
  }
  return num;
}

module.exports = {
  SLASH_COMMANDS,
  SUBCOMMAND_GROUPS,
  matchSlashCommand,
  parseSlashCommand,
  processInputChar,
  formatSize,
  getMimeType,
  parseSubcommand,
  calculateUptime,
  validatePort,
};
