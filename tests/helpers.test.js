import { describe, it, expect, beforeEach, vi } from 'vitest';
const {
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
} = require('../lib/helpers');

describe('Slash Commands', () => {
  describe('SLASH_COMMANDS', () => {
    it('should contain all expected commands', () => {
      expect(SLASH_COMMANDS).toContain('/name');
      expect(SLASH_COMMANDS).toContain('/upload');
      expect(SLASH_COMMANDS).toContain('/download');
      expect(SLASH_COMMANDS).toContain('/files');
      expect(SLASH_COMMANDS).toContain('/status');
      expect(SLASH_COMMANDS).toContain('/info');
      expect(SLASH_COMMANDS).toContain('/help');
    });
  });

  describe('matchSlashCommand', () => {
    it('should match exact command', () => {
      expect(matchSlashCommand('/help')).toBe('/help');
      expect(matchSlashCommand('/files')).toBe('/files');
      expect(matchSlashCommand('/status')).toBe('/status');
    });

    it('should match command with arguments', () => {
      expect(matchSlashCommand('/name My Session')).toBe('/name');
      expect(matchSlashCommand('/upload ./file.txt')).toBe('/upload');
      expect(matchSlashCommand('/download abc123 -o ./out.txt')).toBe('/download');
    });

    it('should handle whitespace', () => {
      expect(matchSlashCommand('  /help  ')).toBe('/help');
      expect(matchSlashCommand('/name   test  ')).toBe('/name');
    });

    it('should return null for non-matching input', () => {
      expect(matchSlashCommand('hello')).toBeNull();
      expect(matchSlashCommand('/unknown')).toBeNull();
      expect(matchSlashCommand('name test')).toBeNull();
    });

    it('should not match partial commands', () => {
      expect(matchSlashCommand('/helpme')).toBeNull();
      expect(matchSlashCommand('/nam')).toBeNull();
    });

    it('should handle empty input', () => {
      expect(matchSlashCommand('')).toBeNull();
      expect(matchSlashCommand('   ')).toBeNull();
    });
  });

  describe('parseSlashCommand', () => {
    it('should parse command without arguments', () => {
      const result = parseSlashCommand('/help');
      expect(result.cmd).toBe('/help');
      expect(result.args).toEqual([]);
    });

    it('should parse command with single argument', () => {
      const result = parseSlashCommand('/name MySession');
      expect(result.cmd).toBe('/name');
      expect(result.args).toEqual(['MySession']);
    });

    it('should parse command with multiple arguments', () => {
      const result = parseSlashCommand('/download abc123 -o ./output.txt');
      expect(result.cmd).toBe('/download');
      expect(result.args).toEqual(['abc123', '-o', './output.txt']);
    });

    it('should handle extra whitespace', () => {
      const result = parseSlashCommand('  /upload   ./file.txt  ');
      expect(result.cmd).toBe('/upload');
      expect(result.args).toEqual(['./file.txt']);
    });
  });
});

describe('Input Buffer Processing', () => {
  describe('processInputChar', () => {
    it('should handle Enter key (CR)', () => {
      const result = processInputChar(13, '/help');
      expect(result.action).toBe('enter');
      expect(result.newBuffer).toBe('');
    });

    it('should handle Enter key (LF)', () => {
      const result = processInputChar(10, '/help');
      expect(result.action).toBe('enter');
      expect(result.newBuffer).toBe('');
    });

    it('should handle Backspace (0x7f)', () => {
      const result = processInputChar(127, 'hello');
      expect(result.action).toBe('backspace');
      expect(result.newBuffer).toBe('hell');
    });

    it('should handle Backspace on empty buffer', () => {
      const result = processInputChar(127, '');
      expect(result.action).toBe('backspace');
      expect(result.newBuffer).toBe('');
    });

    it('should handle Delete (0x08)', () => {
      const result = processInputChar(8, 'test');
      expect(result.action).toBe('backspace');
      expect(result.newBuffer).toBe('tes');
    });

    it('should handle Ctrl+C (0x03)', () => {
      const result = processInputChar(3, '/upload file.txt');
      expect(result.action).toBe('clear');
      expect(result.newBuffer).toBe('');
    });

    it('should handle Ctrl+U (0x15)', () => {
      const result = processInputChar(21, '/name test');
      expect(result.action).toBe('clear');
      expect(result.newBuffer).toBe('');
    });

    it('should handle Escape (0x1b)', () => {
      const result = processInputChar(27, '/help');
      expect(result.action).toBe('escape');
      expect(result.newBuffer).toBe('');
    });

    it('should buffer printable characters', () => {
      let buffer = '';
      for (const char of '/help') {
        const result = processInputChar(char.charCodeAt(0), buffer);
        expect(result.action).toBe('char');
        buffer = result.newBuffer;
      }
      expect(buffer).toBe('/help');
    });

    it('should handle space character', () => {
      const result = processInputChar(32, '/name');
      expect(result.action).toBe('char');
      expect(result.newBuffer).toBe('/name ');
    });

    it('should pass through control characters without buffering', () => {
      // Tab character (0x09)
      const result = processInputChar(9, 'test');
      expect(result.action).toBe('passthrough');
      expect(result.newBuffer).toBe('test');
    });

    it('should handle all printable ASCII range', () => {
      // Test space (32) to tilde (126)
      expect(processInputChar(32, '').action).toBe('char'); // space
      expect(processInputChar(126, '').action).toBe('char'); // tilde
      expect(processInputChar(31, '').action).toBe('passthrough'); // below range
    });

    it('should handle null byte', () => {
      const result = processInputChar(0, 'test');
      expect(result.action).toBe('passthrough');
      expect(result.newBuffer).toBe('test');
    });

    it('should handle high ASCII (above 126)', () => {
      // Characters above 126 are not printable ASCII
      const result = processInputChar(200, 'test');
      expect(result.action).toBe('passthrough');
      expect(result.newBuffer).toBe('test');
    });

    it('should preserve buffer on passthrough', () => {
      // Tab (0x09) should pass through without modifying buffer
      const result = processInputChar(9, '/hel');
      expect(result.newBuffer).toBe('/hel');
    });
  });
});

describe('Slash Command Edge Cases', () => {
  it('should handle slash command at start of line only', () => {
    // Command should match at start
    expect(matchSlashCommand('/help')).toBe('/help');
    // But not if there's text before
    expect(matchSlashCommand('test /help')).toBeNull();
  });

  it('should handle command with tab character', () => {
    // Tab should be treated as whitespace in trimming
    const result = parseSlashCommand('/name\tMySession');
    expect(result.cmd).toBe('/name');
  });

  it('should handle multiline input (should not happen but test anyway)', () => {
    const result = parseSlashCommand('/name test\nmore');
    expect(result.cmd).toBe('/name');
    expect(result.args).toContain('test');
  });
});

describe('Subcommand Parsing', () => {
  describe('SUBCOMMAND_GROUPS', () => {
    it('should have file subcommands', () => {
      expect(SUBCOMMAND_GROUPS.file).toContain('upload');
      expect(SUBCOMMAND_GROUPS.file).toContain('list');
      expect(SUBCOMMAND_GROUPS.file).toContain('download');
      expect(SUBCOMMAND_GROUPS.file).toContain('delete');
    });

    it('should have session subcommands', () => {
      expect(SUBCOMMAND_GROUPS.session).toContain('list');
      expect(SUBCOMMAND_GROUPS.session).toContain('rename');
      expect(SUBCOMMAND_GROUPS.session).toContain('info');
    });

    it('should have note subcommands', () => {
      expect(SUBCOMMAND_GROUPS.note).toContain('create');
      expect(SUBCOMMAND_GROUPS.note).toContain('list');
    });
  });

  describe('parseSubcommand', () => {
    it('should parse file upload command', () => {
      const result = parseSubcommand(['file', 'upload', './test.txt']);
      expect(result.mode).toEqual({ group: 'file', action: 'upload' });
      expect(result.remaining).toEqual(['./test.txt']);
    });

    it('should parse file list command', () => {
      const result = parseSubcommand(['file', 'list', '--json']);
      expect(result.mode).toEqual({ group: 'file', action: 'list' });
      expect(result.remaining).toEqual(['--json']);
    });

    it('should parse session list command', () => {
      const result = parseSubcommand(['session', 'list', '--running']);
      expect(result.mode).toEqual({ group: 'session', action: 'list' });
      expect(result.remaining).toEqual(['--running']);
    });

    it('should parse session rename command', () => {
      const result = parseSubcommand(['session', 'rename', 'abc123', 'New Name']);
      expect(result.mode).toEqual({ group: 'session', action: 'rename' });
      expect(result.remaining).toEqual(['abc123', 'New Name']);
    });

    it('should return null for unknown group', () => {
      const result = parseSubcommand(['unknown', 'action']);
      expect(result.mode).toBeNull();
      expect(result.remaining).toEqual(['unknown', 'action']);
    });

    it('should return null for unknown action', () => {
      const result = parseSubcommand(['file', 'unknown']);
      expect(result.mode).toBeNull();
      expect(result.remaining).toEqual(['file', 'unknown']);
    });

    it('should return null for insufficient args', () => {
      const result = parseSubcommand(['file']);
      expect(result.mode).toBeNull();
      expect(result.remaining).toEqual(['file']);
    });

    it('should return null for empty args', () => {
      const result = parseSubcommand([]);
      expect(result.mode).toBeNull();
      expect(result.remaining).toEqual([]);
    });
  });
});

describe('Helper Functions', () => {
  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(100)).toBe('100 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('should format kilobytes', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(10240)).toBe('10.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
      expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });

    it('should handle null/undefined', () => {
      expect(formatSize(null)).toBe('0 B');
      expect(formatSize(undefined)).toBe('0 B');
    });

    it('should handle negative numbers', () => {
      // Negative numbers are technically invalid but should not crash
      expect(formatSize(-100)).toBe('-100 B');
    });

    it('should handle very large numbers', () => {
      // 10 TB should still show as GB (capped at GB unit)
      expect(formatSize(10 * 1024 * 1024 * 1024 * 1024)).toContain('GB');
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for common extensions', () => {
      expect(getMimeType('file.txt')).toBe('text/plain');
      expect(getMimeType('file.json')).toBe('application/json');
      expect(getMimeType('file.html')).toBe('text/html');
      expect(getMimeType('file.css')).toBe('text/css');
      expect(getMimeType('file.js')).toBe('application/javascript');
    });

    it('should return correct MIME type for images', () => {
      expect(getMimeType('photo.png')).toBe('image/png');
      expect(getMimeType('photo.jpg')).toBe('image/jpeg');
      expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
      expect(getMimeType('photo.gif')).toBe('image/gif');
      expect(getMimeType('icon.svg')).toBe('image/svg+xml');
    });

    it('should return correct MIME type for media', () => {
      expect(getMimeType('audio.mp3')).toBe('audio/mpeg');
      expect(getMimeType('audio.wav')).toBe('audio/wav');
      expect(getMimeType('video.mp4')).toBe('video/mp4');
      expect(getMimeType('video.webm')).toBe('video/webm');
      expect(getMimeType('video.mov')).toBe('video/quicktime');
    });

    it('should return correct MIME type for webp images', () => {
      expect(getMimeType('photo.webp')).toBe('image/webp');
    });

    it('should return correct MIME type for code files', () => {
      expect(getMimeType('script.py')).toBe('text/x-python');
      expect(getMimeType('code.ts')).toBe('text/typescript');
      expect(getMimeType('component.tsx')).toBe('text/typescript-jsx');
      expect(getMimeType('app.swift')).toBe('text/x-swift');
      expect(getMimeType('main.go')).toBe('text/x-go');
      expect(getMimeType('lib.rs')).toBe('text/x-rust');
    });

    it('should return correct MIME type for archives', () => {
      expect(getMimeType('archive.zip')).toBe('application/zip');
      expect(getMimeType('archive.gz')).toBe('application/gzip');
      expect(getMimeType('archive.tar')).toBe('application/x-tar');
    });

    it('should handle case insensitivity', () => {
      expect(getMimeType('FILE.TXT')).toBe('text/plain');
      expect(getMimeType('Photo.PNG')).toBe('image/png');
      expect(getMimeType('Doc.PDF')).toBe('application/pdf');
    });

    it('should return octet-stream for unknown extensions', () => {
      expect(getMimeType('file.unknown')).toBe('application/octet-stream');
      expect(getMimeType('file.xyz')).toBe('application/octet-stream');
      expect(getMimeType('noextension')).toBe('application/octet-stream');
    });

    it('should handle files with multiple dots', () => {
      expect(getMimeType('archive.tar.gz')).toBe('application/gzip');
      expect(getMimeType('file.test.json')).toBe('application/json');
    });

    it('should handle null/undefined/empty filename', () => {
      expect(getMimeType(null)).toBe('application/octet-stream');
      expect(getMimeType(undefined)).toBe('application/octet-stream');
      expect(getMimeType('')).toBe('application/octet-stream');
    });

    it('should handle paths with special characters', () => {
      expect(getMimeType('/path/to/my file.txt')).toBe('text/plain');
      expect(getMimeType('file-name_v2.json')).toBe('application/json');
      expect(getMimeType('file (1).png')).toBe('image/png');
    });
  });
});

describe('Agent Status Helpers', () => {
  describe('calculateUptime', () => {
    it('should calculate uptime in minutes', () => {
      const startTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
      const result = calculateUptime(startTime);
      expect(result).toBe('5m');
    });

    it('should calculate uptime in hours and minutes', () => {
      const startTime = Date.now() - (2 * 60 * 60 * 1000 + 30 * 60 * 1000); // 2h 30m ago
      const result = calculateUptime(startTime);
      expect(result).toBe('2h 30m');
    });

    it('should return null for future start time', () => {
      const startTime = Date.now() + (60 * 1000); // 1 minute in future
      const result = calculateUptime(startTime);
      expect(result).toBeNull();
    });

    it('should return null for NaN start time', () => {
      expect(calculateUptime(NaN)).toBeNull();
      expect(calculateUptime(undefined)).toBeNull();
    });

    it('should handle zero uptime', () => {
      const startTime = Date.now();
      const result = calculateUptime(startTime);
      // Should be 0m or null depending on timing
      expect(result === '0m' || result === null).toBe(true);
    });
  });

  describe('validatePort', () => {
    it('should validate valid port numbers', () => {
      expect(validatePort(80)).toBe(80);
      expect(validatePort(443)).toBe(443);
      expect(validatePort(8080)).toBe(8080);
      expect(validatePort(9999)).toBe(9999);
    });

    it('should validate string port numbers', () => {
      expect(validatePort('80')).toBe(80);
      expect(validatePort('9999')).toBe(9999);
    });

    it('should return null for invalid ports', () => {
      expect(validatePort(0)).toBeNull();
      expect(validatePort(-1)).toBeNull();
      expect(validatePort(65536)).toBeNull();
      expect(validatePort('invalid')).toBeNull();
      expect(validatePort(NaN)).toBeNull();
    });

    it('should handle edge cases', () => {
      expect(validatePort(1)).toBe(1);
      expect(validatePort(65535)).toBe(65535);
    });
  });
});
