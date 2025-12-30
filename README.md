# flipperAgents

MCP (Model Context Protocol) servers for managing network load balancers via Claude Desktop, Claude Code, or any MCP-compatible AI client.

## Overview

flipperAgents provides MCP servers that expose management tools for network load balancers. Users bring their own AI client (Claude Desktop, Claude Code, etc.) which provides the reasoning — our MCP servers just expose the tools.

## Current Status

| Server | Status | Tools | Description |
|--------|--------|-------|-------------|
| **NetScaler MCP** | ✅ Production | 18 | Full NITRO API + SSH support |
| **F5 TMOS MCP** | ✅ Production | 54 | iControl REST + SSH + AS3 drift detection |
| **F5 BIG-IQ MCP** | 📋 Spec Complete | - | Fleet management, licensing |
| **F5 XC MCP** | 🟡 Planned | - | Distributed Cloud |

### Recent Achievements

- ✅ **AS3 Drift Detection** — Complete toolchain to detect when live BIG-IP config diverges from AS3 source of truth
- ✅ **Offline Licensing** — Air-gapped BIG-IP activation via SOAP proxy
- ✅ **Real-time Log Streaming** — SSH-based tail sessions with buffered output
- ✅ **Progress Reporting** — MCP notifications for long-running operations

---

## Quick Start

### NetScaler MCP Server

```bash
cd mcp/netscaler
npm install
npm run build
```

### F5 TMOS MCP Server

```bash
cd mcp/f5
npm install
npm run build
```

### Claude Desktop Configuration

Add to `~/.config/claude/claude_desktop_config.json` (Linux) or equivalent:

```json
{
  "mcpServers": {
    "netscaler": {
      "command": "node",
      "args": ["/path/to/flipperAgents/mcp/netscaler/dist/index.js"],
      "env": {
        "NS_HOST": "10.1.1.100",
        "NS_USER": "nsroot",
        "NS_PASS": "your-password"
      }
    },
    "tmos": {
      "command": "node",
      "args": ["/path/to/flipperAgents/mcp/f5/dist/index.js"],
      "env": {
        "F5_HOST": "10.1.1.200",
        "F5_USER": "admin",
        "F5_PASS": "your-password"
      }
    }
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code / Any MCP Client                  │
│  (Provides AI reasoning - we don't bundle an LLM)               │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ MCP Protocol (stdio/SSE)
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│  flipperagents-ns-mcp         │ │  flipperagents-tmos-mcp       │
│  ┌──────────────────────────┐ │ │  ┌──────────────────────────┐ │
│  │ 18 Tools:                │ │ │  │ 54 Tools:                │ │
│  │ • Config management      │ │ │  │ • AS3/DO/TS deployment   │ │
│  │ • VServer operations     │ │ │  │ • AS3 drift detection    │ │
│  │ • SSL certificates       │ │ │  │ • Backup/restore         │ │
│  │ • System backups         │ │ │  │ • HA management          │ │
│  └──────────────────────────┘ │ │  │ • SSH log streaming      │ │
│        │            │         │ │  │ • Offline licensing      │ │
│        ▼            ▼         │ │  └──────────────────────────┘ │
│   NitroClient   SSHClient     │ │        │            │         │
│   (HTTPS)       (batch)       │ │        ▼            ▼         │
└────────┬────────────┬─────────┘ │   F5Client      SSHClient     │
         │            │           │   (iControl)    (streaming)   │
         ▼            ▼           └────────┬────────────┬─────────┘
      NetScaler ADC                        │            │
                                           ▼            ▼
                                        F5 BIG-IP
```

---

## Repository Structure

```
flipperAgents/
├── mcp/
│   ├── netscaler/              # NetScaler MCP server (18 tools)
│   │   ├── src/
│   │   ├── README.md           # Full documentation
│   │   └── CHANGELOG.md
│   └── f5/                     # F5 TMOS MCP server (54 tools)
│       ├── src/
│       │   ├── tools/
│       │   │   ├── as3-drift.ts    # AS3 drift detection (5 tools)
│       │   │   ├── ssh.ts          # SSH streaming (7 tools)
│       │   │   └── ...
│       │   └── lib/
│       │       ├── progress.ts     # Progress reporting
│       │       ├── licensing.ts    # SOAP activation
│       │       └── ...
│       ├── README.md
│       ├── SPEC.md             # Detailed specification
│       ├── REFERENCE.md        # External API references
│       ├── TESTING.md          # Test procedures
│       └── CHANGELOG.md
├── docs/                       # Specifications & planning
│   └── [see Documentation Index below]
├── tests/
│   └── ns-configs/             # Test NetScaler configurations
├── CLAUDE.md                   # AI assistant context
└── README.md                   # This file
```

---

## Documentation Index

### MCP Server Documentation

| Document | Description |
|----------|-------------|
| [mcp/netscaler/README.md](mcp/netscaler/README.md) | NetScaler MCP server - installation, tools, examples |
| [mcp/f5/README.md](mcp/f5/README.md) | F5 TMOS MCP server - installation, tools, examples |
| [mcp/f5/SPEC.md](mcp/f5/SPEC.md) | F5 MCP detailed specification |
| [mcp/f5/REFERENCE.md](mcp/f5/REFERENCE.md) | External API patterns and gotchas |
| [mcp/f5/TESTING.md](mcp/f5/TESTING.md) | Test procedures and validation |
| [mcp/f5/CHANGELOG.md](mcp/f5/CHANGELOG.md) | F5 MCP change history |

### Specifications (Complete)

| Document | Status | Description |
|----------|--------|-------------|
| [docs/as3-drift-detection-spec.md](docs/as3-drift-detection-spec.md) | ✅ Complete | AS3 drift detection toolchain |
| [docs/bigiq-mcp-spec.md](docs/bigiq-mcp-spec.md) | 📋 Spec Complete | BIG-IQ fleet management server |
| [docs/audit-logging-spec.md](docs/audit-logging-spec.md) | 📋 Spec Complete | Customer audit logging for SIEM |
| [docs/integration-testing-spec.md](docs/integration-testing-spec.md) | 📋 Spec Complete | Testing strategy with fixtures |

### Planning & Proposals

| Document | Description |
|----------|-------------|
| [docs/future-mcp-servers.md](docs/future-mcp-servers.md) | Roadmap: XC, BIG-IQ, NGINX, advanced MCP features |
| [docs/corkscrew-converter-merge-spec.md](docs/corkscrew-converter-merge-spec.md) | Proposal to merge corkscrew + tmos-converter |
| [docs/MCP_ENHANCEMENTS.md](docs/MCP_ENHANCEMENTS.md) | NetScaler MCP enhancement tracker |
| [docs/TELEMETRY_SPEC.md](docs/TELEMETRY_SPEC.md) | Internal telemetry specification |

### Reference

| Document | Description |
|----------|-------------|
| [docs/FLIPPER_INTEGRATION_NOTES.md](docs/FLIPPER_INTEGRATION_NOTES.md) | Patterns for vscode-f5-flipper integration |
| [CLAUDE.md](CLAUDE.md) | AI assistant project context |

---

## Tool Summary

### NetScaler MCP (18 tools)

| Category | Tools |
|----------|-------|
| Connection | `check_connection`, `get_system_info` |
| Config | `get_running_config`, `backup_config`, `deploy_config`, `clear_config`, `save_config` |
| VServers | `list_vservers`, `get_vserver_status` |
| SSL | `list_certificates`, `upload_certificate`, `provision_test_certs` |
| Backups | `create_system_backup`, `list_system_backups`, `download_system_backup`, `delete_system_backup` |
| Files | `upload_file`, `download_file` |

### F5 TMOS MCP (54 tools)

| Category | Tools |
|----------|-------|
| Connection | `connect`, `disconnect`, `device_info`, `check_connection` |
| AS3 Drift | `extract_tenant_config`, `convert_to_as3`, `parse_as3_declaration`, `validate_as3`, `dry_run_as3` |
| ATC Deploy | `as3_get`, `as3_deploy`, `as3_delete`, `do_get`, `do_deploy`, `ts_get`, `ts_deploy`, `atc_versions` |
| Backup | `ucs_create`, `ucs_list`, `ucs_download`, `ucs_upload`, `ucs_restore`, `ucs_delete`, `qkview_create`, `qkview_list`, `qkview_download` |
| System | `bash_execute`, `tmsh_execute`, `config_save`, `config_merge`, `reboot` |
| SSH | `ssh_connect`, `ssh_disconnect`, `ssh_execute`, `ssh_tail_start`, `ssh_tail_read`, `ssh_tail_stop`, `ssh_tail_list` |
| HA | `ha_status`, `ha_failover`, `ha_sync` |
| Monitoring | `stats_virtual`, `stats_pool`, `logs_get`, `health_check` |
| Licensing | `license_get`, `license_install`, `license_activate_airgapped`, `license_get_dossier`, `license_activate_offline`, `license_install_text` |

---

## Development

```bash
# Build all servers
cd mcp/netscaler && npm install && npm run build
cd ../f5 && npm install && npm run build

# Development mode (auto-rebuild)
npm run dev

# Run tests
npm test

# HTTP transport for debugging
HTTP_PORT=3000 npm start
```

---

## Related Projects

- [f5-corkscrew](https://github.com/f5devcentral/f5-corkscrew) — BIG-IP config parser used by AS3 drift detection
- [vscode-f5-flipper](https://github.com/f5devcentral/vscode-f5-flipper) — VS Code extension for NetScaler → F5 conversion
- [f5-conx-core](https://github.com/f5devcentral/f5-conx-core) — F5 connectivity library (iControl REST)

---

## License

Apache-2.0
