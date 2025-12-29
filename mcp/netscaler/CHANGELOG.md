# Changelog

All notable changes to the NetScaler MCP server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed

- Refactored tools to separate `src/tools.ts` module for better maintainability

## [0.1.0] - 2024-12-24

### Added

- Initial release
- Connection tools (`get_system_info`, `check_connection`)
- Virtual server management (`list_vservers`, `get_vserver_status`)
- Configuration management (`get_running_config`, `deploy_config`, `clear_config`, `save_config`, `backup_config`)
- Certificate management (`list_certificates`, `upload_certificate`, `provision_test_certs`)
- System backups (`create_system_backup`, `list_system_backups`, `download_system_backup`, `delete_system_backup`)
- File operations (`upload_file`, `download_file`)
- Automatic config reordering for dependency safety
- NITRO API client with session management
- SSH client for batch command execution
- HTTP/SSE transport for development
- Telemetry integration with F5 TEEM