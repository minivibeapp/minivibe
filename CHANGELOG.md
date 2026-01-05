# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-01-05

### Added
- Device code authentication flow (RFC 8628) - same as GitHub CLI, Azure CLI
- Session history persistence for vibe-agent (survives restarts)
- End-to-end encryption support with automatic key exchange
- Terminal attachment mode (`--attach`) for session mirroring
- Remote control mode (`--remote`) for controlling sessions on other hosts
- `--list` flag to list running sessions on local agent
- Cross-platform Windows support with node-pty

### Changed
- Authentication now uses public URL (minivibeapp.com/pair) instead of localhost
- Bridge server URL updated to ws.minivibeapp.com
- Improved error handling and reconnection logic

### Fixed
- CORS issues with bridge server
- Token refresh handling for long-running sessions
- Session resume with correct working directory

## [0.1.4] - 2024-12-28

### Added
- Initial npm release
- Basic bridge server connectivity
- iOS remote control support
- Session management (start, resume, stop)
- Permission approval from mobile

## [0.1.0] - 2024-12-20

### Added
- Initial development release
- Claude Code PTY wrapper
- WebSocket bridge integration
- Firebase authentication
