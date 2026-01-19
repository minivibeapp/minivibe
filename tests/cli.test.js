import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const VIBE_PATH = path.join(__dirname, '..', 'vibe.js');
const AGENT_PATH = path.join(__dirname, '..', 'agent', 'agent.js');

// Set shorter timeout for network tests
const NETWORK_TIMEOUT = 5000;

describe('CLI Integration Tests', () => {
  describe('vibe --help', () => {
    it('should display help message', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('vibe - Claude Code with mobile remote control');
      expect(output).toContain('Usage:');
      expect(output).toContain('Commands:');
    });

    it('should include file commands in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('File Commands:');
      expect(output).toContain('vibe file list');
      expect(output).toContain('vibe file upload');
    });

    it('should include session commands in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('Session Commands:');
      expect(output).toContain('vibe session list');
      expect(output).toContain('vibe session rename');
    });

    it('should include in-session commands in help', () => {
      const output = execSync(`node ${VIBE_PATH} --help`, { encoding: 'utf8' });

      expect(output).toContain('In-Session Commands');
      expect(output).toContain('/name');
      expect(output).toContain('/upload');
      expect(output).toContain('/download');
      expect(output).toContain('/files');
      expect(output).toContain('/status');
      expect(output).toContain('/info');
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

  describe('vibe subcommand parsing', () => {
    it('should show error for unknown subcommand', () => {
      try {
        execSync(`node ${VIBE_PATH} file unknown 2>&1`, { encoding: 'utf8' });
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err.status).not.toBe(0);
      }
    });
  });

  // Note: Network-dependent tests are skipped as they require a running bridge server
  // and valid authentication. These would be covered by E2E tests.
  describe.skip('vibe file commands (auth validation)', () => {
    it('should fail for file list without valid auth', () => {
      try {
        execSync(`node ${VIBE_PATH} file list 2>&1`, { encoding: 'utf8', timeout: NETWORK_TIMEOUT });
        expect(true).toBe(false);
      } catch (err) {
        const output = err.stdout || err.stderr || err.message;
        expect(output).toMatch(/authenticated|login|auth|token|error|timeout/i);
      }
    });

    it('should fail for file upload without valid auth', () => {
      const testFile = path.join(os.tmpdir(), 'vibe-test.txt');
      fs.writeFileSync(testFile, 'test content');

      try {
        execSync(`node ${VIBE_PATH} file upload ${testFile} 2>&1`, { encoding: 'utf8', timeout: NETWORK_TIMEOUT });
        expect(true).toBe(false);
      } catch (err) {
        const output = err.stdout || err.stderr || err.message;
        expect(output).toMatch(/authenticated|login|auth|token|error|timeout/i);
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });

  describe.skip('vibe session commands (auth validation)', () => {
    it('should fail for session list without valid auth', () => {
      try {
        execSync(`node ${VIBE_PATH} session list 2>&1`, { encoding: 'utf8', timeout: NETWORK_TIMEOUT });
        expect(true).toBe(false);
      } catch (err) {
        const output = err.stdout || err.stderr || err.message;
        expect(output).toMatch(/authenticated|login|auth|token|error|timeout/i);
      }
    });

    it('should fail for session rename without valid auth', () => {
      try {
        execSync(`node ${VIBE_PATH} session rename abc123 "New Name" 2>&1`, { encoding: 'utf8', timeout: NETWORK_TIMEOUT });
        expect(true).toBe(false);
      } catch (err) {
        const output = err.stdout || err.stderr || err.message;
        expect(output).toMatch(/authenticated|login|auth|token|error|timeout/i);
      }
    });
  });

  describe('vibe file upload validation', () => {
    it('should show error for missing file path', () => {
      // Create a mock auth file temporarily
      const authDir = path.join(os.homedir(), '.vibe');
      const authFile = path.join(authDir, 'auth.json');
      const hadAuth = fs.existsSync(authFile);
      let originalAuth = null;

      try {
        if (hadAuth) {
          originalAuth = fs.readFileSync(authFile, 'utf8');
        } else {
          if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
          }
          fs.writeFileSync(authFile, JSON.stringify({ idToken: 'test' }));
        }

        const output = execSync(`node ${VIBE_PATH} file upload 2>&1`, { encoding: 'utf8' });
        expect(output).toContain('No file path');
      } catch (err) {
        // Command may exit with error, check output
        const output = err.stdout || err.stderr || '';
        expect(output).toMatch(/file path|usage/i);
      } finally {
        if (!hadAuth && fs.existsSync(authFile)) {
          fs.unlinkSync(authFile);
        } else if (originalAuth) {
          fs.writeFileSync(authFile, originalAuth);
        }
      }
    });
  });
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

describe('Syntax Validation', () => {
  it('vibe.js should have valid syntax', () => {
    expect(() => {
      execSync(`node --check ${VIBE_PATH}`, { encoding: 'utf8' });
    }).not.toThrow();
  });

  it('agent.js should have valid syntax', () => {
    expect(() => {
      execSync(`node --check ${AGENT_PATH}`, { encoding: 'utf8' });
    }).not.toThrow();
  });
});
