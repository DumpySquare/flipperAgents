# F5 BIG-IP MCP Server

MCP (Model Context Protocol) server for managing F5 BIG-IP devices via Claude Desktop, Claude Code, or any MCP-compatible AI client.

## Features

- **Device Management** - Connect, disconnect, device info, health checks
- **Backup & Recovery** - UCS create/list/download/restore, Qkview diagnostics
- **System Operations** - Bash/tmsh execution, config save/merge, reboot
- **ATC Deployment** - AS3, DO, and Telemetry Streaming declarative APIs
- **HA Management** - Status, failover, config sync
- **Monitoring** - Virtual/pool stats, logs, health checks

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
    "f5-bigip": {
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
| `connect` | Connect to BIG-IP device |
| `disconnect` | Disconnect from device |
| `device_info` | Get device information |
| `check_connection` | Test connectivity |

### Backup & Recovery

| Tool | Description |
|------|-------------|
| `ucs_create` | Create UCS backup |
| `ucs_list` | List UCS files |
| `ucs_download` | Download UCS file |
| `ucs_upload` | Upload UCS file |
| `ucs_restore` | Restore from UCS |
| `ucs_delete` | Delete UCS file |
| `qkview_create` | Generate qkview diagnostic |
| `qkview_list` | List qkview files |
| `qkview_download` | Download qkview file |

### System Management

| Tool | Description |
|------|-------------|
| `bash_execute` | Execute bash command |
| `tmsh_execute` | Execute tmsh command |
| `config_save` | Save running config |
| `config_merge` | Merge config snippet |
| `reboot` | Reboot device |
| `logs_get` | Retrieve log files |
| `license_get` | View license info |

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

## License

Apache-2.0
