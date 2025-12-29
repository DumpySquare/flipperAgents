# Changelog

All notable changes to the F5 TMOS MCP server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- SSH session support for real-time log streaming
  - `ssh_connect` - Establish SSH session (separate from REST)
  - `ssh_disconnect` - Close SSH session
  - `ssh_execute` - Run shell commands via SSH
  - `ssh_tail_start` - Start background log tailing
  - `ssh_tail_read` - Get buffered log output
  - `ssh_tail_stop` - Stop tail session
  - `ssh_tail_list` - List active sessions
- Offline/air-gapped licensing support
  - `license_activate_airgapped` - One-step orchestrated tool (recommended)
  - `license_get_dossier` - Get dossier from BIG-IP
  - `license_activate_offline` - MCP proxies to activate.f5.com SOAP API
  - `license_install_text` - Install license from text
- `license_install` with automatic proxy detection
- New `src/lib/ssh-client.ts` module using ssh2 library
- New `src/lib/licensing.ts` module for SOAP activation
- REFERENCE.md with external references, API patterns, and gotchas
- MCP Resources section in SPEC.md for AI agent documentation

### Changed

- Enhanced tool descriptions with use cases, related tools, and workflow context
- Destructive operations now include pre-requisite checklists
- README updated with SSH and licensing documentation

## [0.1.0] - 2024-12-24

### Added

- Initial release
- Connection management (`connect`, `disconnect`, `device_info`, `check_connection`)
- Backup tools (`ucs_create`, `ucs_list`, `ucs_download`, `ucs_upload`, `ucs_restore`, `ucs_delete`)
- Qkview diagnostics (`qkview_create`, `qkview_list`, `qkview_download`)
- System tools (`bash_execute`, `tmsh_execute`, `config_save`, `config_merge`, `reboot`, `logs_get`, `license_get`)
- ATC deployment (`as3_get`, `as3_deploy`, `as3_delete`, `do_get`, `do_deploy`, `ts_get`, `ts_deploy`, `atc_versions`)
- HA management (`ha_status`, `ha_failover`, `ha_sync`)
- Monitoring (`stats_virtual`, `stats_pool`, `health_check`)
- Telemetry integration with F5 TEEM
- HTTP/SSE transport for development