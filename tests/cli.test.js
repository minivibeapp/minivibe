import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const VIBE_PATH = path.join(__dirname, '..', 'dist', 'cli.js');
const AGENT_PATH = path.join(__dirname, '..', 'dist', 'agent', 'cli.js');

// Set shorter timeout for network tests
const NETWORK_TIMEOUT = 5000;

describe('CLI Integration Tests', () => {
  describe('vibe --help', () => {
    it('should display help message', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('MiniVibe - Control Claude Code from your iPhone');
      expect(output).toContain('Usage:');
    });

    it('should include authentication commands in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('Authentication:');
      expect(output).toContain('vibe login');
    });

    it('should include options in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('Options:');
      expect(output).toContain('--resume');
      expect(output).toContain('--name');
      expect(output).toContain('--bridge');
    });

    it('should include in-session commands in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('In-session Commands');
      expect(output).toContain('/whoami');
      expect(output).toContain('/name');
      expect(output).toContain('/info');
      expect(output).toContain('/upload');
      expect(output).toContain('/download');
      expect(output).toContain('/files');
      expect(output).toContain('/help');
    });
  });

  describe('vibe-agent --help', () => {
    it('should display help message', () => {
      const output = execSync(`node ${AGENT_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('vibe-agent');
      expect(output).toContain('Usage:');
    });
  });

  // Note: The CLI no longer has file/session subcommands
  // Those features were part of the old monolithic vibe.js
  // and have been removed in the TypeScript refactor
});

describe('Agent Status', () => {
  describe('vibe-agent status', () => {
    it('should show status without running agent', () => {
      const output = execSync(`node ${AGENT_PATH} status 2>&1`, { encoding: 'utf8' });

      expect(output).toContain('vibe-agent');
      expect(output).toContain('Status:');
      expect(output).toContain('Host:');
      expect(output).toContain('Bridge:');
    });

    it('should show "not running" when agent is not running', () => {
      // Clean up any stale PID file
      const pidFile = path.join(os.homedir(), '.vibe-agent', 'pid');
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      const output = execSync(`node ${AGENT_PATH} status 2>&1`, { encoding: 'utf8' });
      expect(output).toContain('not running');
    });
  });
});

describe('Build Validation', () => {
  it('dist/cli.js should exist', () => {
    expect(fs.existsSync(VIBE_PATH)).toBe(true);
  });

  it('dist/agent/cli.js should exist', () => {
    expect(fs.existsSync(AGENT_PATH)).toBe(true);
  });
});
