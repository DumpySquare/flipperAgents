# NetScaler MCP Server (flipperagents-ns-mcp)

MCP (Model Context Protocol) server for managing NetScaler ADC via Claude Desktop or any MCP-compatible client.

## Installation

Clone and build the project:

```bash
git clone https://github.com/f5devcentral/flipperAgents.git
cd flipperAgents/mcp/netscaler
npm install
npm run build
```

## Configuration

Add to your Claude Desktop configuration file:

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

Replace `/path/to/flipperAgents` with the actual path where you cloned the repository.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NS_HOST` | Yes | NetScaler hostname or IP address |
| `NS_USER` | No | Username (default: `nsroot`) |
| `NS_PASS` | Yes | Password for NITRO API |
| `SSH_KEY` | No | Path to SSH private key (for batch deployments) |

## Available Tools

Once configured, Claude will have access to these NetScaler management tools:

### `list_vservers`
List all load balancer virtual servers with optional statistics.

### `get_vserver_status`
Get detailed status and bindings for a specific virtual server.

### `backup_config`
Create a backup of the current NetScaler configuration.

### `deploy_config`
Deploy configuration to NetScaler. Config is automatically reordered for dependency safety.

### `clear_config`
Clear all application configuration (vservers, services, servers). Preserves system settings.

### `list_certificates`
List SSL certificates with expiration status.

### `get_running_config`
Get the current running configuration.

### `save_config`
Save the running configuration to persistent storage.

## Example Usage

After configuration, you can interact with your NetScaler naturally in Claude:

```
User: "List all my virtual servers"

User: "Backup the current config before I make changes"

User: "Deploy this configuration: [paste config]"

User: "Which SSL certificates are expiring soon?"

User: "Show me the status of the 'web-frontend' virtual server"
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start
```

## Feedback & Issues

Report bugs or request features at: <https://github.com/f5devcentral/flipperAgents/issues>

Please include:

- NetScaler version
- What you were trying to do
- Any error messages

## License

Apache-2.0
