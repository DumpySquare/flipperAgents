# TMOS MCP Server (flipperagents-tmos-mcp)

MCP (Model Context Protocol) server for managing F5 BIG-IP/TMOS devices via Claude Desktop, Claude Code, or any MCP-compatible AI client.

## Features

- **Device Management** - Connect, disconnect, device info, health checks
- **Backup & Recovery** - UCS create/list/download/restore, Qkview diagnostics
- **System Operations** - Bash/tmsh execution, config save/merge, reboot
- **ATC Deployment** - AS3, DO, and Telemetry Streaming declarative APIs
- **HA Management** - Status, failover, config sync
- **Monitoring** - Virtual/pool stats, logs, health checks
- **Licensing** - Online and offline (air-gapped) license activation
- **SSH Sessions** - Real-time log streaming, shell access for troubleshooting

## Installation

```bash
cd mcp/f5
npm install
npm run build
```

## Claude Desktop Configuration

Add to your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tmos": {
      "command": "node",
      "args": ["/path/to/flipperAgents/mcp/f5/dist/index.js"],
      "env": {
        "F5_HOST": "10.1.1.100",
        "F5_USER": "admin",
        "F5_PASS": "your-password"
      }
    }
  }
}
```

Replace `/path/to/flipperAgents` with your actual installation path.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `F5_HOST` | No | BIG-IP hostname/IP (can use `connect` tool instead) |
| `F5_USER` | No | Username (default: admin) |
| `F5_PASS` | No | Password (required if F5_HOST is set) |
| `F5_PORT` | No | Management port (default: 443) |
| `F5_PROVIDER` | No | Auth provider (default: tmos) |
| `HTTP_PORT` | No | Enable HTTP/SSE transport on specified port |
| `LOG_FILE` | No | Path to log file |
| `LOG_LEVEL` | No | Log level: DEBUG, INFO, WARN, ERROR (default: INFO) |

## Available Tools

### Connection & Discovery

| Tool | Description |
|------|-------------|
| `connect` | Connect to BIG-IP device (REST API) |
| `disconnect` | Disconnect from device |
| `device_info` | Get device information |
| `check_connection` | Test connectivity |

### SSH Sessions (Real-time Streaming)

| Tool | Description |
|------|-------------|
| `ssh_connect` | Establish SSH session (separate from REST) |
| `ssh_disconnect` | Close SSH session |
| `ssh_execute` | Run shell command via SSH |
| `ssh_tail_start` | Start tailing a log file (background) |
| `ssh_tail_read` | Get buffered log output |
| `ssh_tail_stop` | Stop a tail session |
| `ssh_tail_list` | List active tail sessions |

### Backup & Recovery

| Tool | Description |
|------|-------------|
| `ucs_create` | Create UCS backup (full system) |
| `ucs_list` | List UCS files |
| `ucs_download` | Download UCS file |
| `ucs_upload` | Upload UCS file |
| `ucs_restore` | Restore from UCS (destructive) |
| `ucs_delete` | Delete UCS file |
| `qkview_create` | Generate qkview diagnostic |
| `qkview_list` | List qkview files |
| `qkview_download` | Download qkview file |

### System Management

| Tool | Description |
|------|-------------|
| `bash_execute` | Execute bash command (REST API) |
| `tmsh_execute` | Execute tmsh command |
| `config_save` | Save running config |
| `config_merge` | Merge config snippet |
| `reboot` | Reboot device (causes interruption) |
| `logs_get` | Retrieve log files (one-shot) |

### Licensing

| Tool | Description |
|------|-------------|
| `license_get` | View current license info |
| `license_install` | Install license (device has internet or proxy) |
| `license_activate_airgapped` | **One-step offline activation** (device has no internet) |
| `license_get_dossier` | Get dossier (manual offline step 1/3) |
| `license_activate_offline` | Exchange dossier for license (manual step 2/3) |
| `license_install_text` | Install license from text (manual step 3/3) |

### ATC Deployment

| Tool | Description |
|------|-------------|
| `as3_get` | Get AS3 declaration |
| `as3_deploy` | Deploy AS3 declaration |
| `as3_delete` | Delete AS3 tenant |
| `do_get` | Get DO declaration |
| `do_deploy` | Deploy DO declaration |
| `ts_get` | Get TS declaration |
| `ts_deploy` | Deploy TS declaration |
| `ts_delete` | Delete TS configuration |
| `atc_versions` | List installed ATC versions |

### HA Management

| Tool | Description |
|------|-------------|
| `ha_status` | Get HA status |
| `ha_failover` | Trigger failover |
| `ha_sync` | Sync config to device group |

### Monitoring

| Tool | Description |
|------|-------------|
| `stats_virtual` | Virtual server statistics |
| `stats_pool` | Pool statistics |
| `health_check` | Comprehensive health check |
| `image_list` | List software images |
| `volume_list` | List software volumes |

## Usage Examples

### With Claude Desktop

Once configured, you can ask Claude to manage your BIG-IP:

- "Connect to my BIG-IP at 10.1.1.100"
- "Create a UCS backup called pre-change"
- "Show me the health status of my BIG-IP"
- "Deploy this AS3 declaration..."
- "What's the HA sync status?"

### Real-time Log Monitoring

For operations where you need to watch logs in real-time (licensing, upgrades, HA failover):

```
"Start tailing /var/log/ltm while I do a license update"
[agent: ssh_connect → ssh_tail_start /var/log/ltm]

"Activate my license"
[agent: license_activate_airgapped]

"What do the logs show?"
[agent: ssh_tail_read → shows licensing messages]

"Stop monitoring"
[agent: ssh_tail_stop]
```

**Common log files to monitor:**
- `/var/log/ltm` - General LTM events, licensing, mcpd
- `/var/log/audit` - Configuration changes, logins
- `/var/log/liveinstall` - Software installation progress
- `/var/log/ts/bd.log` - ASM/WAF events

### Offline Licensing (Air-Gapped BIG-IP)

For BIG-IP devices without internet access, use the **one-step** orchestrated tool:

```
"Activate license XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX on my air-gapped BIG-IP"
```

The `license_activate_airgapped` tool handles everything:
1. Gets dossier from BIG-IP
2. Fetches EULA from activate.f5.com (via MCP server)
3. Submits dossier + EULA to get license
4. Installs license on BIG-IP
5. Verifies activation

The MCP server (running on a machine with internet) proxies the SOAP call to F5's license server.

### HTTP Mode (Development)

For development and testing, run with HTTP transport:

```bash
HTTP_PORT=3000 F5_HOST=10.1.1.100 F5_PASS=xxx npm start
```

Then access:
- `http://localhost:3000/` - Usage info
- `http://localhost:3000/health` - Health check
- `http://localhost:3000/sse` - SSE connection
- `POST http://localhost:3000/api/call` - Direct tool invocation

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK
- `f5-conx-core` - F5 device connectivity library
- `ssh2` - SSH client for shell access

## Documentation

- [SPEC.md](SPEC.md) - Design document and implementation phases
- [REFERENCE.md](REFERENCE.md) - External references, API patterns, and gotchas

### External References

- [F5 Ansible Collection](https://github.com/F5Networks/f5-ansible) - Reference implementation for iControl REST patterns
- [F5 CloudDocs](https://clouddocs.f5.com/) - Official API and CLI documentation
- [TMSH Reference](https://clouddocs.f5.com/cli/tmsh-reference/latest/) - CLI command reference

## License

Apache-2.0
