import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { colors } from '../utils/colors';
import { LOCAL_SERVER_PORT } from '../utils/config';
import { agentState } from './state';
import { send } from './bridge';
import { log, cleanCliOutput } from './utils';
import type { BridgeMessage } from './types';

/**
 * Find vibe CLI executable
 */
export function findVibeCli(): string | null {
  // Try to find via which/where first (most reliable when installed via npm)
  try {
    const cmd = process.platform === 'win32' ? 'where vibe' : 'which vibe';
    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    const found = result.split('\n')[0].trim();
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {
    // Not found via which/where, try local paths
  }

  // Local development paths (dist/cli.js structure)
  const locations = [
    path.join(__dirname, '..', 'cli.js'), // Same dist/ directory
    path.join(__dirname, '..', '..', 'dist', 'cli.js'), // Parent dist/
  ];

  // Add platform-specific locations
  if (process.platform === 'win32') {
    locations.push(path.join(os.homedir(), 'AppData', 'Local', 'minivibe', 'dist', 'cli.js'));
  } else {
    locations.push('/usr/local/bin/vibe');
  }

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return null;
}

/**
 * Handle start_session command from bridge
 */
export function handleStartSession(msg: BridgeMessage): void {
  const state = agentState;
  const { sessionId, path: projectPath, name, prompt, requestId } = msg;

  log(`Starting session: ${name || projectPath || 'new'}`, colors.cyan);

  const vibeCli = findVibeCli();
  if (!vibeCli) {
    log('vibe-cli not found!', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'vibe-cli not found on this host',
    });
    return;
  }

  // Build args - use --agent to connect via local server
  const args = ['--agent', `ws://localhost:${LOCAL_SERVER_PORT}`];

  if (state.e2eEnabled) {
    args.push('--e2e');
  }

  if (name) {
    args.push('--name', name as string);
  }

  if (prompt) {
    args.push(prompt as string);
  }

  // Spawn vibe-cli - expand ~ to home directory
  let cwd = (projectPath as string) || os.homedir();
  if (cwd.startsWith('~')) {
    cwd = cwd.replace(/^~/, os.homedir());
  }

  // Validate path exists
  if (!fs.existsSync(cwd)) {
    log(`Path does not exist: ${cwd}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: `Path does not exist: ${cwd}`,
    });
    return;
  }

  log(`Spawning: node ${vibeCli} ${args.join(' ')}`, colors.dim);
  log(`Working directory: ${cwd}`, colors.dim);

  try {
    const proc = spawn('node', [vibeCli, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const newSessionId = (sessionId as string) || uuidv4();

    state.runningSessions.set(newSessionId, {
      process: proc,
      path: cwd,
      name: (name as string) || path.basename(cwd),
      startedAt: new Date().toISOString(),
      attachedClients: new Set(),
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const output = cleanCliOutput(data);
      if (output) {
        log(`[${newSessionId.slice(0, 8)}] ${output}`, colors.dim);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = cleanCliOutput(data);
      if (output) {
        log(`[${newSessionId.slice(0, 8)}] ${output}`, colors.yellow);
      }
    });

    proc.on('exit', (code) => {
      log(`Session ${newSessionId.slice(0, 8)} exited with code ${code}`, colors.dim);
      const session = state.runningSessions.get(newSessionId);
      if (session) {
        state.addToSessionHistory(newSessionId, session.path, session.name);
      }
      state.runningSessions.delete(newSessionId);

      send({
        type: 'agent_session_ended',
        sessionId: newSessionId,
        exitCode: code,
      });
    });

    proc.on('error', (err: Error) => {
      log(`Session error: ${err.message}`, colors.red);
      const session = state.runningSessions.get(newSessionId);
      if (session) {
        state.addToSessionHistory(newSessionId, session.path, session.name);
      }
      state.runningSessions.delete(newSessionId);

      send({
        type: 'agent_session_error',
        requestId,
        sessionId: newSessionId,
        error: err.message,
      });
    });

    send({
      type: 'agent_session_started',
      requestId,
      sessionId: newSessionId,
      path: cwd,
      name: (name as string) || path.basename(cwd),
    });

    log(`Session started: ${newSessionId.slice(0, 8)}`, colors.green);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to start session: ${message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: message,
    });
  }
}

/**
 * Handle resume_session command from bridge
 */
export function handleResumeSession(msg: BridgeMessage): void {
  const state = agentState;
  const { sessionId, path: projectPath, name, requestId } = msg;

  if (!sessionId) {
    log('Resume session called without sessionId', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      error: 'sessionId is required to resume a session',
    });
    return;
  }

  log(`Resuming session: ${(sessionId as string).slice(0, 8)}`, colors.cyan);

  if (state.runningSessions.has(sessionId as string)) {
    log('Session is already running', colors.yellow);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session is already running',
    });
    return;
  }

  if (state.stoppingSessions.has(sessionId as string)) {
    log('Session is currently stopping', colors.yellow);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session is currently stopping. Please wait a moment and try again.',
    });
    return;
  }

  const vibeCli = findVibeCli();
  if (!vibeCli) {
    log('vibe-cli not found!', colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'vibe-cli not found on this host',
    });
    return;
  }

  const args = ['--agent', `ws://localhost:${LOCAL_SERVER_PORT}`, '--resume', sessionId as string];

  if (state.e2eEnabled) {
    args.push('--e2e');
  }

  // Try to get session info from history if path not provided
  let effectivePath = projectPath as string | undefined;
  let effectiveName = name as string | undefined;

  if (!effectivePath) {
    const historyEntry = state.getFromSessionHistory(sessionId as string);
    if (historyEntry) {
      effectivePath = historyEntry.path;
      effectiveName = effectiveName || historyEntry.name;
      log(`Using path from session history: ${effectivePath}`, colors.dim);
    }
  }

  if (!effectivePath) {
    log(`Cannot resume session ${(sessionId as string).slice(0, 8)}: path unknown`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error:
        'Cannot resume session: working directory path unknown. The session may have been created before path tracking was enabled, or the agent was restarted.',
    });
    return;
  }

  if (effectiveName) {
    args.push('--name', effectiveName);
  }

  let cwd = effectivePath;
  if (cwd.startsWith('~')) {
    cwd = cwd.replace(/^~/, os.homedir());
  }

  if (!fs.existsSync(cwd)) {
    log(`Path does not exist: ${cwd}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: `Path does not exist: ${cwd}`,
    });
    return;
  }

  log(`Spawning: node ${vibeCli} ${args.join(' ')}`, colors.dim);

  try {
    const proc = spawn('node', [vibeCli, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    state.runningSessions.set(sessionId as string, {
      process: proc,
      path: cwd,
      name: effectiveName || path.basename(cwd),
      startedAt: new Date().toISOString(),
      attachedClients: new Set(),
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const output = cleanCliOutput(data);
      if (output) {
        log(`[${(sessionId as string).slice(0, 8)}] ${output}`, colors.dim);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = cleanCliOutput(data);
      if (output) {
        log(`[${(sessionId as string).slice(0, 8)}] ${output}`, colors.yellow);
      }
    });

    proc.on('exit', (code) => {
      log(`Session ${(sessionId as string).slice(0, 8)} exited with code ${code}`, colors.dim);
      const session = state.runningSessions.get(sessionId as string);
      if (session) {
        state.addToSessionHistory(sessionId as string, session.path, session.name);
      }
      state.runningSessions.delete(sessionId as string);

      send({
        type: 'agent_session_ended',
        sessionId,
        exitCode: code,
      });
    });

    proc.on('error', (err: Error) => {
      log(`Session error: ${err.message}`, colors.red);
      const session = state.runningSessions.get(sessionId as string);
      if (session) {
        state.addToSessionHistory(sessionId as string, session.path, session.name);
      }
      state.runningSessions.delete(sessionId as string);

      send({
        type: 'agent_session_error',
        requestId,
        sessionId,
        error: err.message,
      });
    });

    send({
      type: 'agent_session_resumed',
      requestId,
      sessionId,
      path: cwd,
      name: effectiveName || path.basename(cwd),
    });

    log(`Session resumed: ${(sessionId as string).slice(0, 8)}`, colors.green);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to resume session: ${message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: message,
    });
  }
}

/**
 * Handle stop_session command from bridge
 */
export function handleStopSession(msg: BridgeMessage): void {
  const state = agentState;
  const { sessionId, requestId } = msg;

  const session = state.runningSessions.get(sessionId as string);
  if (!session) {
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: 'Session not found',
    });
    return;
  }

  log(`Stopping session: ${(sessionId as string).slice(0, 8)}`, colors.yellow);

  try {
    if (session.process) {
      // Spawned session - kill the process
      if (process.platform === 'win32') {
        session.process.kill();
      } else {
        session.process.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (state.runningSessions.has(sessionId as string) && session.process) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } else if (session.localWs) {
      // Managed session - send stop command
      state.stoppingSessions.add(sessionId as string);
      try {
        session.localWs.send(
          JSON.stringify({
            type: 'session_stop',
            sessionId,
            reason: 'stopped_by_user',
          })
        );
      } catch {
        // Ignore send errors
      }

      setTimeout(() => {
        try {
          session.localWs?.close(1000, 'Stopped by agent');
        } catch {
          // Already closed
        }
        setTimeout(() => {
          state.stoppingSessions.delete(sessionId as string);
        }, 5000);
      }, 100);
      state.runningSessions.delete(sessionId as string);
    }

    send({
      type: 'agent_session_stopping',
      requestId,
      sessionId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log(`Failed to stop session: ${message}`, colors.red);
    send({
      type: 'agent_session_error',
      requestId,
      sessionId,
      error: message,
    });
  }
}
