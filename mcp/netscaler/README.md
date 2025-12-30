# NetScaler MCP Server (flipperagents-ns-mcp)

MCP (Model Context Protocol) server for managing NetScaler ADC via Claude Desktop or any MCP-compatible client.

## Features

- **Device Discovery** - Connection testing, system info, HA status
- **Configuration Management** - Get, backup, deploy, clear running config
- **Virtual Server Management** - List, status, bindings for LB/CS vservers
- **SSL Certificate Management** - List, upload, monitor expiration
- **System Backups** - Create, list, download, delete full system archives
- **File Operations** - Upload/download files (scripts, certs, configs)

## Installation

```bash
cd flipperAgents/mcp/netscaler
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
    "netscaler": {
      "command": "node",
      "args": ["/path/to/flipperAgents/mcp/netscaler/dist/index.js"],
      "env": {
        "NS_HOST": "10.1.1.100",
        "NS_USER": "nsroot",
        "NS_PASS": "your-password",
        "SSH_KEY": "/path/to/ssh/key.pem"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NS_HOST` | Yes | NetScaler hostname or IP address |
| `NS_USER` | No | Username (default: `nsroot`) |
| `NS_PASS` | Yes | Password for NITRO API and SSH |
| `SSH_KEY` | No | Path to SSH private key (alternative to password) |
| `HTTP_PORT` | No | Enable HTTP/SSE transport on specified port |
| `LOG_FILE` | No | Path to log file |
| `LOG_LEVEL` | No | Log level: DEBUG, INFO, WARN, ERROR (default: INFO) |

## Available Tools

### Connection & Discovery

| Tool | Description |
|------|-------------|
| `check_connection` | Test NITRO API and SSH connectivity with latency |
| `get_system_info` | Version, hardware, license, HA status, CPU/memory |

### Virtual Server Management

| Tool | Description |
|------|-------------|
| `list_vservers` | List all LB virtual servers with optional stats |
| `get_vserver_status` | Detailed vserver info: bindings, certs, policies |

### Configuration Management

| Tool | Description |
|------|-------------|
| `get_running_config` | Get ns.conf equivalent (filterable by section) |
| `backup_config` | Timestamped config snapshot with description |
| `deploy_config` | Deploy config with auto-reordering for dependencies |
| `clear_config` | Clear all application config (destructive) |
| `save_config` | Save running config to persistent storage |

### SSL Certificate Management

| Tool | Description |
|------|-------------|
| `list_certificates` | List certs with expiration monitoring |
| `upload_certificate` | Upload cert + key, create certkey binding |
| `provision_test_certs` | Generate self-signed certs for lab/dev |

### System Backups

| Tool | Description |
|------|-------------|
| `create_system_backup` | Create full .tgz backup archive |
| `list_system_backups` | List backups in /var/ns_sys_backup/ |
| `download_system_backup` | Download backup for offsite storage |
| `delete_system_backup` | Remove old backup files |

### File Operations

| Tool | Description |
|------|-------------|
| `upload_file` | Upload files (scripts, certs, templates) |
| `download_file` | Download files from NetScaler filesystem |

## Usage Examples

### Basic Operations

```
"Check connectivity to my NetScaler"
→ check_connection

"What version is my NetScaler running?"
→ get_system_info

"List all my virtual servers"
→ list_vservers

"Show me the status of vs_web_frontend"
→ get_vserver_status(name="vs_web_frontend")
```

### Configuration Workflows

```
"Backup the config before I make changes"
→ backup_config(description="pre-upgrade")

"Deploy this configuration: [paste config]"
→ deploy_config(config="...")

"Save the config so it survives reboot"
→ save_config
```

### SSL Certificate Management

```
"Which certificates expire in the next 30 days?"
→ list_certificates(expiring_within_days=30)

"Upload this new certificate"
→ upload_certificate(name="web_cert", cert_content="...", key_content="...")

"Generate test certs for my lab config"
→ provision_test_certs(config="...")
```

### System Backup Workflow

```
"Create a full backup before the upgrade"
→ create_system_backup(description="pre-upgrade", level="full")

"Download the latest backup"
→ list_system_backups → download_system_backup(filename="...")

"Clean up old backups"
→ list_system_backups → delete_system_backup(filename="...")
```

## Dual Transport: NITRO API vs SSH

The NetScaler MCP server uses two connection methods:

| Operation | Transport | Why |
|-----------|-----------|-----|
| Read operations | NITRO API | Structured JSON responses |
| Configuration deploy | SSH batch | Proper command ordering, error handling |
| File operations | SSH/SCP | Direct filesystem access |
| Backup download | SSH/SCP | Large file transfer |

Both transports use the same credentials (`NS_USER`/`NS_PASS`), or SSH can use key-based auth via `SSH_KEY`.

## HTTP Mode (Development)

For development and testing:

```bash
HTTP_PORT=3000 NS_HOST=10.1.1.100 NS_PASS=xxx npm start
```

Access:
- `http://localhost:3000/` - Usage info
- `http://localhost:3000/health` - Health check
- `http://localhost:3000/sse` - SSE connection
- `POST http://localhost:3000/api/call` - Direct tool invocation

## Troubleshooting

### Connection Issues

```bash
# Test NITRO API directly
curl -sk -u nsroot:password https://NETSCALER/nitro/v1/config/nsversion

# Test SSH
ssh nsroot@NETSCALER
```

### Config Deploy Fails

- Check for dependency issues (servers must exist before services)
- Verify no name conflicts with existing objects
- Check NetScaler version compatibility for features

### Certificate Operations Fail

- Ensure key matches certificate (modulus check)
- Verify PEM format with proper headers
- Check /nsconfig/ssl/ permissions

## Dependencies

- `nitro-client` - NetScaler NITRO API client
- `ssh2` - SSH client for batch operations
- `@modelcontextprotocol/sdk` - MCP protocol implementation

## Documentation

- [NetScaler NITRO API Reference](https://developer-docs.citrix.com/projects/netscaler-nitro-api/en/latest/)
- [NetScaler CLI Reference](https://docs.citrix.com/en-us/citrix-adc/current-release/reference/netscaler-command-reference)
- [MCP Specification](https://spec.modelcontextprotocol.io/)

## License

Apache-2.0
