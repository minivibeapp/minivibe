#!/usr/bin/env python3
"""Simple PTY wrapper using pty.spawn()"""
import os
import sys
import pty

if len(sys.argv) < 2:
    print("Usage: pty-wrapper-simple.py <command> [args...]", file=sys.stderr)
    sys.exit(1)

# Run command in a PTY using the simple spawn method
exit_code = pty.spawn(sys.argv[1:])
sys.exit(exit_code)
