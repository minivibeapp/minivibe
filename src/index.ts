/**
 * MiniVibe - Claude Code wrapper with mobile remote control
 *
 * This is the main library entry point.
 * For CLI usage, see ./cli.ts
 */

// Context (shared state)
export * from './context';

// Core orchestration (CLI-specific, not re-exported to avoid conflicts)
// Use: import { ... } from 'minivibe/dist/core'

// Utils module
export * from './utils';

// Auth module
export * from './auth';

// Bridge module
export * from './bridge';

// Claude module
export * from './claude';

// Commands module
export * from './commands';
