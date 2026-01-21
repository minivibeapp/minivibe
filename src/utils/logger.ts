/**
 * Simple logging utilities for auth module
 */

import { colors } from './colors';

let verboseMode = false;

export function setVerboseMode(verbose: boolean): void {
  verboseMode = verbose;
}

export function logStatus(msg: string): void {
  if (verboseMode) {
    console.error(`${colors.dim}[vibe] ${msg}${colors.reset}`);
  }
}

export function logSuccess(msg: string): void {
  console.log(`${colors.green}${msg}${colors.reset}`);
}
