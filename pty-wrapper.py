#!/usr/bin/env python3
"""
PTY wrapper for Claude Code.
Creates a pseudo-terminal and runs Claude, allowing both terminal and piped input.
Also captures permission prompts and outputs them as JSON to a separate FD.
Optionally mirrors terminal output to FD 4 for remote forwarding.
"""
import os
import sys
import pty
import select
import signal
import termios
import tty
import struct
import fcntl
import re
import json

# Buffer for detecting permission prompts
output_buffer = ""
PROMPT_FD = 3  # File descriptor for permission prompt output
MIRROR_FD = 4  # File descriptor for mirroring terminal output (optional)

def has_mirror_fd():
    """Check if FD 4 is available for output mirroring."""
    try:
        os.fstat(MIRROR_FD)
        return True
    except OSError:
        return False

def set_winsize(fd, rows, cols):
    """Set terminal window size."""
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def strip_ansi(text):
    """Remove ANSI escape codes from text."""
    ansi_pattern = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[PX^_].*?\x1b\\')
    return ansi_pattern.sub('', text)

def detect_permission_prompt(text):
    """
    Detect Claude's permission prompt in terminal output.
    Returns parsed prompt data or None.
    """
    clean = strip_ansi(text)

    # Look for the permission prompt pattern
    # Claude shows: "Do you want to proceed?" or similar, followed by numbered options
    lines = clean.split('\n')

    options = []
    question = None

    for i, line in enumerate(lines):
        line = line.strip()

        # Detect question line
        if 'want to' in line.lower() or 'allow' in line.lower() or 'proceed' in line.lower():
            if '?' in line:
                question = line

        # Detect numbered options (1. Yes, 2. Yes and don't ask, 3. Type here)
        match = re.match(r'^[›\s]*(\d+)\.\s+(.+)$', line)
        if match:
            opt_id = int(match.group(1))
            opt_label = match.group(2).strip()
            options.append({
                'id': opt_id,
                'label': opt_label,
                'requiresInput': 'type' in opt_label.lower() or 'tell' in opt_label.lower()
            })

    # Only return if we found valid options
    if len(options) >= 2:
        return {
            'type': 'permission_prompt',
            'question': question or 'Permission required',
            'options': options
        }

    return None

def send_prompt_to_fd(prompt_data):
    """Send detected prompt to FD 3 if available."""
    try:
        # Check if FD 3 is open
        os.fstat(PROMPT_FD)
        json_line = json.dumps(prompt_data) + '\n'
        os.write(PROMPT_FD, json_line.encode('utf-8'))
        # Debug: also write to stderr so we can see it
        sys.stderr.write(f"[PTY] Detected prompt: {prompt_data.get('question', 'unknown')}, options: {len(prompt_data.get('options', []))}\n")
        sys.stderr.flush()
    except OSError:
        # FD 3 not available, skip
        pass

def main():
    # Get command to run
    if len(sys.argv) < 2:
        print("Usage: pty-wrapper.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1:]

    # Save original terminal settings if stdin is a tty
    stdin_is_tty = os.isatty(sys.stdin.fileno())
    if stdin_is_tty:
        old_settings = termios.tcgetattr(sys.stdin)

    # Create pseudo-terminal
    master_fd, slave_fd = pty.openpty()

    # Get terminal size and apply to PTY
    if stdin_is_tty:
        try:
            rows, cols = os.get_terminal_size()
            set_winsize(slave_fd, rows, cols)
        except OSError:
            set_winsize(slave_fd, 24, 80)
    else:
        set_winsize(slave_fd, 24, 80)

    # Fork process
    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)

        # Create new session and set controlling terminal
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        # Redirect stdio to slave PTY
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        if slave_fd > 2:
            os.close(slave_fd)

        # Execute command
        os.execvp(cmd[0], cmd)

    # Parent process
    os.close(slave_fd)

    # Set stdin to raw mode if it's a tty
    if stdin_is_tty:
        tty.setraw(sys.stdin.fileno())

    # Handle window resize
    def handle_sigwinch(signum, frame):
        if stdin_is_tty:
            try:
                rows, cols = os.get_terminal_size()
                set_winsize(master_fd, rows, cols)
            except OSError:
                pass

    signal.signal(signal.SIGWINCH, handle_sigwinch)

    exit_code = 0
    try:
        while True:
            # Wait for data from stdin or master PTY
            rlist = [sys.stdin.fileno(), master_fd]
            try:
                readable, _, _ = select.select(rlist, [], [], 0.1)
            except select.error:
                continue

            if sys.stdin.fileno() in readable:
                # Data from stdin -> send to PTY
                try:
                    data = os.read(sys.stdin.fileno(), 1024)
                    if not data:
                        break
                    os.write(master_fd, data)
                except OSError:
                    break

            if master_fd in readable:
                # Data from PTY -> send to stdout and check for permission prompts
                global output_buffer
                try:
                    data = os.read(master_fd, 1024)
                    if not data:
                        break
                    os.write(sys.stdout.fileno(), data)
                    sys.stdout.flush()

                    # Mirror to FD 4 if available (for remote terminal forwarding)
                    if has_mirror_fd():
                        try:
                            os.write(MIRROR_FD, data)
                        except OSError:
                            pass

                    # Buffer output for prompt detection
                    try:
                        text = data.decode('utf-8', errors='replace')
                        output_buffer += text
                        # Keep buffer reasonable size (last 2KB)
                        if len(output_buffer) > 2048:
                            output_buffer = output_buffer[-2048:]

                        # Try to detect permission prompt
                        prompt = detect_permission_prompt(output_buffer)
                        if prompt:
                            send_prompt_to_fd(prompt)
                            # Clear buffer after sending prompt
                            output_buffer = ""
                    except Exception:
                        pass
                except OSError:
                    break

            # Check if child has exited
            result = os.waitpid(pid, os.WNOHANG)
            if result[0] != 0:
                exit_code = os.WEXITSTATUS(result[1]) if os.WIFEXITED(result[1]) else 1
                break

    except KeyboardInterrupt:
        # Send SIGINT to child
        os.kill(pid, signal.SIGINT)
        os.waitpid(pid, 0)

    finally:
        # Restore terminal settings
        if stdin_is_tty:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        os.close(master_fd)

    sys.exit(exit_code)

if __name__ == '__main__':
    main()
