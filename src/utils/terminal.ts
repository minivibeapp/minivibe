/**
 * Terminal UI utilities
 * Provides spinners, progress bars, semantic colors, and output formatting
 * Pattern inspired by OpenCode's terminal module
 */

import { colors } from './colors';

// ============================================
// Terminal Detection
// ============================================

/**
 * Check if stdout supports colors
 */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR || process.env.TERM === 'dumb') {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  return process.stdout.isTTY === true;
}

/**
 * Get terminal width (default 80 if not available)
 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Check if running in interactive mode
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

// ============================================
// Semantic Color System
// ============================================

const noColor = !supportsColor();

/**
 * Semantic color functions for consistent UI
 */
export const ui = {
  /** Success messages (green) */
  success: (text: string): string => noColor ? text : `${colors.green}${text}${colors.reset}`,

  /** Error messages (red) */
  error: (text: string): string => noColor ? text : `${colors.red}${text}${colors.reset}`,

  /** Warning messages (yellow) */
  warn: (text: string): string => noColor ? text : `${colors.yellow}${text}${colors.reset}`,

  /** Info messages (blue) */
  info: (text: string): string => noColor ? text : `${colors.blue}${text}${colors.reset}`,

  /** Muted/secondary text (dim) */
  dim: (text: string): string => noColor ? text : `${colors.dim}${text}${colors.reset}`,

  /** Highlighted text (bright/bold) */
  highlight: (text: string): string => noColor ? text : `${colors.bright}${text}${colors.reset}`,

  /** Cyan accent (for special items) */
  accent: (text: string): string => noColor ? text : `${colors.cyan}${text}${colors.reset}`,

  /** Magenta brand color */
  brand: (text: string): string => noColor ? text : `${colors.magenta}${text}${colors.reset}`,
};

// ============================================
// Spinner
// ============================================

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

export interface Spinner {
  /** Update the spinner message */
  update: (message: string) => void;
  /** Stop with success state */
  success: (message?: string) => void;
  /** Stop with error state */
  fail: (message?: string) => void;
  /** Stop with warning state */
  warn: (message?: string) => void;
  /** Stop without status indicator */
  stop: () => void;
  /** Check if spinner is running */
  isSpinning: () => boolean;
}

/**
 * Create an animated spinner for long operations
 * Falls back to simple logging in non-TTY environments
 */
export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let currentMessage = message;
  let timer: NodeJS.Timeout | null = null;
  let spinning = false;

  const clearLine = () => {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
  };

  const render = () => {
    if (!process.stdout.isTTY) return;
    const frame = noColor ? '-' : ui.accent(SPINNER_FRAMES[frameIndex]);
    clearLine();
    process.stdout.write(`${frame} ${currentMessage}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  const start = () => {
    if (!process.stdout.isTTY) {
      // Non-TTY: just print the message once
      console.log(`- ${message}`);
      spinning = true;
      return;
    }
    spinning = true;
    render();
    timer = setInterval(render, SPINNER_INTERVAL);
  };

  const stopWithSymbol = (symbol: string, finalMessage?: string) => {
    spinning = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    clearLine();
    const msg = finalMessage ?? currentMessage;
    console.log(`${symbol} ${msg}`);
  };

  // Auto-start
  start();

  return {
    update: (msg: string) => {
      currentMessage = msg;
      if (!process.stdout.isTTY && spinning) {
        console.log(`- ${msg}`);
      }
    },
    success: (msg?: string) => stopWithSymbol(ui.success('✓'), msg),
    fail: (msg?: string) => stopWithSymbol(ui.error('✗'), msg),
    warn: (msg?: string) => stopWithSymbol(ui.warn('!'), msg),
    stop: () => {
      spinning = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clearLine();
    },
    isSpinning: () => spinning,
  };
}

// ============================================
// Progress Bar
// ============================================

export interface ProgressBar {
  /** Update progress (0-100) */
  update: (percent: number, message?: string) => void;
  /** Complete the progress bar */
  complete: (message?: string) => void;
  /** Fail the progress bar */
  fail: (message?: string) => void;
  /** Get current progress */
  getProgress: () => number;
}

export interface ProgressBarOptions {
  /** Width of the progress bar (default: 30) */
  width?: number;
  /** Show percentage (default: true) */
  showPercent?: boolean;
  /** Completed character (default: █) */
  completeChar?: string;
  /** Incomplete character (default: ░) */
  incompleteChar?: string;
}

/**
 * Create a progress bar for tracking completion
 */
export function createProgressBar(
  message: string,
  options: ProgressBarOptions = {}
): ProgressBar {
  const {
    width = 30,
    showPercent = true,
    completeChar = '█',
    incompleteChar = '░',
  } = options;

  let currentPercent = 0;
  let currentMessage = message;

  const clearLine = () => {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
  };

  const render = () => {
    if (!process.stdout.isTTY) return;

    const filledWidth = Math.round((currentPercent / 100) * width);
    const emptyWidth = width - filledWidth;
    const bar = ui.accent(completeChar.repeat(filledWidth)) +
                ui.dim(incompleteChar.repeat(emptyWidth));
    const percent = showPercent ? ` ${currentPercent.toString().padStart(3)}%` : '';

    clearLine();
    process.stdout.write(`${bar}${percent} ${currentMessage}`);
  };

  return {
    update: (percent: number, msg?: string) => {
      currentPercent = Math.max(0, Math.min(100, Math.round(percent)));
      if (msg) currentMessage = msg;
      render();
    },
    complete: (msg?: string) => {
      currentPercent = 100;
      if (msg) currentMessage = msg;
      clearLine();
      const bar = ui.success(completeChar.repeat(width));
      console.log(`${bar} 100% ${currentMessage}`);
    },
    fail: (msg?: string) => {
      if (msg) currentMessage = msg;
      clearLine();
      const filledWidth = Math.round((currentPercent / 100) * width);
      const emptyWidth = width - filledWidth;
      const bar = ui.error(completeChar.repeat(filledWidth)) +
                  ui.dim(incompleteChar.repeat(emptyWidth));
      console.log(`${bar} ${currentPercent}% ${ui.error(currentMessage)}`);
    },
    getProgress: () => currentPercent,
  };
}

// ============================================
// JSON Output Mode
// ============================================

let jsonOutputMode = false;

/**
 * Enable JSON output mode (for scripting)
 */
export function setJsonOutputMode(enabled: boolean): void {
  jsonOutputMode = enabled;
}

/**
 * Check if JSON output mode is enabled
 */
export function isJsonOutputMode(): boolean {
  return jsonOutputMode;
}

/**
 * Output data in appropriate format (JSON or human-readable)
 */
export function output<T>(data: T, humanReadable?: () => void): void {
  if (jsonOutputMode) {
    console.log(JSON.stringify(data, null, 2));
  } else if (humanReadable) {
    humanReadable();
  } else {
    console.log(data);
  }
}

// ============================================
// Table Formatting
// ============================================

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Create a simple terminal table
 */
export function table<T extends Record<string, unknown>>(
  columns: TableColumn[],
  rows: T[]
): string {
  if (rows.length === 0) {
    return ui.dim('(no data)');
  }

  const termWidth = getTerminalWidth();

  // Calculate column widths
  const colWidths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...rows.map((row) => String(row[col.key] ?? '').length)
    );
    return Math.max(headerLen, maxDataLen);
  });

  // Adjust widths to fit terminal
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (columns.length - 1) * 3;
  if (totalWidth > termWidth) {
    const scale = (termWidth - (columns.length - 1) * 3) / colWidths.reduce((a, b) => a + b, 0);
    colWidths.forEach((_, i) => {
      colWidths[i] = Math.max(5, Math.floor(colWidths[i] * scale));
    });
  }

  const pad = (str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string => {
    const s = str.slice(0, width);
    const padding = width - s.length;
    if (align === 'right') return ' '.repeat(padding) + s;
    if (align === 'center') return ' '.repeat(Math.floor(padding / 2)) + s + ' '.repeat(Math.ceil(padding / 2));
    return s + ' '.repeat(padding);
  };

  // Build table
  const lines: string[] = [];

  // Header
  const headerRow = columns
    .map((col, i) => ui.highlight(pad(col.header, colWidths[i], col.align)))
    .join(ui.dim(' │ '));
  lines.push(headerRow);

  // Separator
  const separator = colWidths.map((w) => '─'.repeat(w)).join('─┼─');
  lines.push(ui.dim(separator));

  // Data rows
  for (const row of rows) {
    const dataRow = columns
      .map((col, i) => pad(String(row[col.key] ?? ''), colWidths[i], col.align))
      .join(ui.dim(' │ '));
    lines.push(dataRow);
  }

  return lines.join('\n');
}

// ============================================
// Box Drawing
// ============================================

export interface BoxOptions {
  title?: string;
  padding?: number;
  borderColor?: keyof typeof colors;
}

/**
 * Draw a box around text
 */
export function box(content: string, options: BoxOptions = {}): string {
  const { title, padding = 1, borderColor = 'dim' } = options;
  const termWidth = getTerminalWidth();
  const maxContentWidth = termWidth - 4 - padding * 2;

  // Split content into lines and wrap
  const contentLines = content.split('\n').flatMap((line) => {
    if (line.length <= maxContentWidth) return [line];
    const wrapped: string[] = [];
    for (let i = 0; i < line.length; i += maxContentWidth) {
      wrapped.push(line.slice(i, i + maxContentWidth));
    }
    return wrapped;
  });

  const contentWidth = Math.min(
    maxContentWidth,
    Math.max(...contentLines.map((l) => l.length), title?.length ?? 0)
  );
  const boxWidth = contentWidth + padding * 2 + 2;

  const colorFn = (s: string) => noColor ? s : `${colors[borderColor]}${s}${colors.reset}`;
  const padStr = ' '.repeat(padding);

  const lines: string[] = [];

  // Top border
  if (title) {
    const titlePart = ` ${title} `;
    const remaining = boxWidth - 2 - titlePart.length;
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    lines.push(colorFn('╭' + '─'.repeat(left) + titlePart + '─'.repeat(right) + '╮'));
  } else {
    lines.push(colorFn('╭' + '─'.repeat(boxWidth - 2) + '╮'));
  }

  // Padding lines
  for (let i = 0; i < padding; i++) {
    lines.push(colorFn('│') + ' '.repeat(boxWidth - 2) + colorFn('│'));
  }

  // Content lines
  for (const line of contentLines) {
    const paddedLine = padStr + line.padEnd(contentWidth) + padStr;
    lines.push(colorFn('│') + paddedLine + colorFn('│'));
  }

  // Padding lines
  for (let i = 0; i < padding; i++) {
    lines.push(colorFn('│') + ' '.repeat(boxWidth - 2) + colorFn('│'));
  }

  // Bottom border
  lines.push(colorFn('╰' + '─'.repeat(boxWidth - 2) + '╯'));

  return lines.join('\n');
}

// ============================================
// Error Formatting with Suggestions
// ============================================

export interface FormattedError {
  message: string;
  code?: string;
  suggestions?: string[];
  details?: string;
}

/**
 * Format an error with helpful suggestions
 */
export function formatError(error: FormattedError): string {
  const lines: string[] = [];

  // Error header
  const codePrefix = error.code ? `[${error.code}] ` : '';
  lines.push(ui.error(`✗ ${codePrefix}${error.message}`));

  // Details
  if (error.details) {
    lines.push('');
    lines.push(ui.dim(error.details));
  }

  // Suggestions
  if (error.suggestions && error.suggestions.length > 0) {
    lines.push('');
    lines.push(ui.highlight('Suggestions:'));
    for (const suggestion of error.suggestions) {
      lines.push(`  ${ui.dim('→')} ${suggestion}`);
    }
  }

  return lines.join('\n');
}

// ============================================
// Common Error Suggestions
// ============================================

export const ErrorSuggestions = {
  AUTH_FAILED: [
    'Run: vibe login',
    'Check your internet connection',
    'Try: vibe logout && vibe login',
  ],
  CLAUDE_NOT_FOUND: [
    'Install Claude Code: https://claude.ai/download',
    'Ensure claude is in your PATH',
    'Try reinstalling Claude Code',
  ],
  CONNECTION_FAILED: [
    'Check your internet connection',
    'The bridge server may be temporarily unavailable',
    'Try again in a few moments',
  ],
  AGENT_NOT_RUNNING: [
    'Start the agent: vibe-agent',
    'Check if port 7865 is available',
    'Try: vibe-agent --port <other-port>',
  ],
  SESSION_NOT_FOUND: [
    'Run: vibe --list to see available sessions',
    'The session may have expired',
    'Start a new session: vibe',
  ],
  FILE_NOT_FOUND: [
    'Check the file path is correct',
    'Use absolute paths for reliability',
    'Run: ls to verify the file exists',
  ],
};
