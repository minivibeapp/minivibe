#!/usr/bin/env node
/**
 * Node.js PTY wrapper for Claude Code (Windows compatible)
 *
 * Alternative to pty-wrapper.py for Windows users.
 * Uses node-pty for cross-platform pseudo-terminal support.
 *
 * Usage: node pty-wrapper-node.js <command> [args...]
 */

const os = require('os');
const path = require('path');

// Try to load node-pty (optional dependency)
let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('Error: node-pty is not installed.');
  console.error('Install it with: npm install node-pty');
  console.error('');
  console.error('On Windows, you may also need:');
  console.error('  - Python 3.x');
  console.error('  - Visual Studio Build Tools');
  console.error('  npm install --global windows-build-tools');
  process.exit(1);
}

// Get command to run
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: pty-wrapper-node.js <command> [args...]');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// Get terminal size
const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

// Buffer for detecting permission prompts
let outputBuffer = '';
const MAX_BUFFER = 2048;

// Check if FD 4 is available for output mirroring
let hasMirrorFd = false;
try {
  require('fs').fstatSync(4);
  hasMirrorFd = true;
} catch (err) {
  // FD 4 not available
}

// ANSI escape code pattern
const ansiPattern = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[PX^_].*?\x1b\\/g;

function stripAnsi(text) {
  return text.replace(ansiPattern, '');
}

function detectPermissionPrompt(text) {
  const clean = stripAnsi(text);
  const lines = clean.split('\n');

  const options = [];
  let question = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect question line
    if (/want to|allow|proceed/i.test(trimmed) && trimmed.includes('?')) {
      question = trimmed;
    }

    // Detect numbered options (1. Yes, 2. Yes and don't ask, 3. Type here)
    const match = trimmed.match(/^[›\s]*(\d+)\.\s+(.+)$/);
    if (match) {
      options.push({
        id: parseInt(match[1]),
        label: match[2].trim(),
        requiresInput: /type|tell/i.test(match[2])
      });
    }
  }

  // Only return if we found valid options
  if (options.length >= 2) {
    return {
      type: 'permission_prompt',
      question: question || 'Permission required',
      options
    };
  }

  return null;
}

// Spawn the PTY process
const ptyProcess = pty.spawn(command, commandArgs, {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: process.cwd(),
  env: process.env
});

// Handle terminal resize
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
});

// Forward PTY output to stdout
ptyProcess.onData((data) => {
  process.stdout.write(data);

  // Mirror to FD 4 if available (for remote terminal forwarding)
  if (hasMirrorFd) {
    try {
      require('fs').writeSync(4, data);
    } catch (err) {
      // Ignore write errors
    }
  }

  // Buffer output for prompt detection
  outputBuffer += data;
  if (outputBuffer.length > MAX_BUFFER) {
    outputBuffer = outputBuffer.slice(-MAX_BUFFER);
  }

  // Try to detect permission prompt
  const prompt = detectPermissionPrompt(outputBuffer);
  if (prompt) {
    // Write to fd 3 if available (for vibe-cli to read)
    try {
      const fs = require('fs');
      const jsonLine = JSON.stringify(prompt) + '\n';
      fs.writeSync(3, jsonLine);
    } catch (err) {
      // FD 3 not available, skip
    }
    outputBuffer = '';
  }
});

// Forward stdin to PTY
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on('data', (data) => {
  ptyProcess.write(data.toString());
});

// Handle PTY exit
ptyProcess.onExit(({ exitCode, signal }) => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.exit(exitCode);
});

// Handle signals (Unix only - Windows doesn't have these)
if (os.platform() !== 'win32') {
  process.on('SIGINT', () => {
    ptyProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    ptyProcess.kill('SIGTERM');
  });
}
