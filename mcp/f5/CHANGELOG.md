# Changelog

All notable changes to the F5 TMOS MCP server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Progress reporting for long-running operations**
  - New `src/lib/progress.ts` module with `ProgressTracker` class
  - Emits MCP `notifications/progress` during extraction and dry-run
  - Step-by-step progress: Connecting → Creating mini-UCS → Downloading → Parsing → Filtering → Complete
  - Includes operation IDs and duration tracking
- **Enhanced dry-run response parsing**
  - Field-level change detection with impact assessment (high/medium/low)
  - Impact levels: HIGH (traffic routing), MEDIUM (session handling), LOW (metadata)
  - Structured `PlannedChange` objects with object paths and summaries
  - Raw response included for debugging
- AS3 Drift Detection tool group
  - `extract_tenant_config` - Extract live config via mini-UCS + corkscrew
  - `convert_to_as3` - Convert extracted config to AS3 declaration
  - `parse_as3_declaration` - Validate AS3 declaration structure
  - `validate_as3` - Schema validation
  - `dry_run_as3` - Test declaration without applying
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
- New `src/tools/as3-drift.ts` module using f5-corkscrew
- REFERENCE.md with external references, API patterns, and gotchas
- MCP Resources section in SPEC.md for AI agent documentation

### Fixed

- `extract_tenant_config` partition filter now correctly uses `app.partition` property instead of parsing partition from app name (2025-12-29)
- `dry_run_as3` now uses correct AS3 3.30+ parameter `controls.dryRun=true` instead of deprecated `dry-run=true` (2025-12-29)

### Tested

- AS3 Drift Detection complete end-to-end testing on bigip-tparty05.benlab.io (2025-12-29)
  - All 5 tools validated: `extract_tenant_config`, `convert_to_as3`, `parse_as3_declaration`, `validate_as3`, `dry_run_as3`
  - Both "no changes" and "with changes" scenarios verified
  - TESTING.md updated to use `tmsh_execute` instead of non-existent `config_get` tool

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