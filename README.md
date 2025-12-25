# flipperAgents

MCP (Model Context Protocol) servers for managing network load balancers via Claude Desktop or any MCP-compatible AI client.

## Overview

flipperAgents provides MCP servers that expose management tools for network load balancers. Users bring their own AI client (Claude Desktop, Claude Code, etc.) which provides the reasoning - our MCP servers just expose the tools.

**Currently Implemented:**

- **NetScaler MCP Server** (`flipperagents-ns-mcp`) - Full NITRO API and SSH support

**Planned:**

- F5 BIG-IP/TMOS MCP Server (`flipperagents-tmos-mcp`)
- F5 XC MCP Server
- NGINX MCP Server

## Quick Start

### NetScaler MCP Server

```bash
# From the mcp/netscaler directory
cd mcp/netscaler
npm install
npm run build
```

Configure Claude Desktop (`~/.config/claude/claude_desktop_config.json`):

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

See [mcp/netscaler/README.md](mcp/netscaler/README.md) for full documentation.

## Repository Structure

```text
flipperAgents/
├── mcp/                              # MCP Servers (active development)
│   ├── netscaler/                   # NetScaler MCP server
│   │   ├── src/
│   │   │   ├── index.ts             # MCP server entry point
│   │   │   ├── lib/                 # Core logic
│   │   │   │   ├── nitro-client.ts  # NITRO API client
│   │   │   │   ├── ssh-client.ts    # SSH operations
│   │   │   │   └── config-reorder.ts # Config dependency ordering
│   │   │   └── transports/          # Transport implementations
│   │   └── README.md
│   └── f5/                          # F5 BIG-IP/TMOS MCP server
├── tests/
│   └── ns-configs/                  # Test NetScaler configurations
├── docs/                            # Documentation
├── CLAUDE.md                        # AI assistant instructions
└── README.md                        # This file
```

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code / Any MCP Client                   │
│  (Provides AI reasoning - we don't bundle an LLM)               │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ stdio (JSON-RPC)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  flipperagents-ns-mcp (MCP Server)                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Tools exposed:                                              ││
│  │  • list_vservers        • deploy_config                     ││
│  │  • get_vserver_status   • clear_config                      ││
│  │  • list_certificates    • save_config                       ││
│  │  • get_running_config   • backup_config                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                    ┌─────────┴─────────┐                        │
│                    ▼                   ▼                        │
│              NitroClient          SSHClient                     │
│              (HTTPS API)          (batch cmds)                  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                           NetScaler ADC
```

## Available Tools (NetScaler)

| Tool | Description |
|------|-------------|
| `list_vservers` | List LB virtual servers with status |
| `get_vserver_status` | Detailed status for a specific vserver |
| `list_certificates` | List SSL certs with expiration info |
| `get_running_config` | Get current running configuration |
| `backup_config` | Create configuration backup |
| `deploy_config` | Deploy config (auto-reorders for dependencies) |
| `clear_config` | Clear app config, preserve system settings |
| `save_config` | Save running config to persistent storage |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Project overview, architecture, build commands |
| [mcp/netscaler/README.md](mcp/netscaler/README.md) | NetScaler MCP server documentation |
| [docs/CONFIG_FIX_PLAN.md](docs/CONFIG_FIX_PLAN.md) | Test config status and MCP toolchain |
| [docs/MCP_ENHANCEMENTS.md](docs/MCP_ENHANCEMENTS.md) | Proposed MCP server enhancements |
| [docs/FLIPPER_INTEGRATION_NOTES.md](docs/FLIPPER_INTEGRATION_NOTES.md) | Patterns for Flipper integration |

## Development

```bash
# Build NetScaler MCP server
cd mcp/netscaler
npm install
npm run build

# Run in development mode
npm run dev

# Run for production
npm start
```

## Related Projects

- [vscode-f5-flipper](https://github.com/f5devcentral/vscode-f5-flipper) - VS Code extension for NetScaler config analysis and F5 conversion

## License

Apache-2.0
