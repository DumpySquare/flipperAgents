# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

flipperAgents provides MCP (Model Context Protocol) servers for managing network load balancers (NetScaler, F5 BIG-IP, F5 XC, NGINX) via Claude Desktop or any MCP-compatible AI client.

**Key Concept:** We build MCP servers (tool providers), not AI agents. Users bring their own AI (Claude Desktop, Claude Code, etc.) which provides the reasoning - our MCP servers just expose the management tools.

## Repository Structure

```text
flipperAgents/
├── mcp/                              # MCP Servers (main focus)
│   ├── netscaler/                   # NetScaler MCP server
│   │   ├── src/
│   │   │   ├── index.ts             # MCP server entry point
│   │   │   ├── lib/                 # Core logic
│   │   │   │   ├── nitro-client.ts  # NITRO API client
│   │   │   │   ├── ssh-client.ts    # SSH operations
│   │   │   │   └── config-reorder.ts # Config dependency ordering
│   │   │   └── transports/          # Transport implementations
│   │   │       └── http.ts          # HTTP/SSE transport
│   │   ├── package.json             # @flipper/netscaler-mcp
│   │   └── README.md
│   └── f5/                          # F5 BIG-IP MCP server (future)
├── tests/
│   └── ns-configs/                  # Test NetScaler configurations
└── docs/                            # Documentation
```

## Build & Development Commands

```bash
# Build NetScaler MCP server
cd mcp/netscaler
npm install
npm run build

# Run MCP server (for testing)
npm start

# Development mode
npm run dev
```

## MCP Server Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  User's Claude Desktop / Claude Code                             │
│  (Provides the AI reasoning - we don't bundle an LLM)           │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ stdio (JSON-RPC)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  @flipper/netscaler-mcp (Our MCP Server)                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Tools exposed:                                              ││
│  │  • list_vservers        • backup_config                     ││
│  │  • get_vserver_status   • deploy_config                     ││
│  │  • list_certificates    • clear_config                      ││
│  │  • get_running_config   • save_config                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    ▼                   ▼                        │
│              NitroClient          SSHClient                     │
│              (HTTPS API)          (batch cmds)                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
                           NetScaler ADC
```

## User Installation

Users install our MCP server and configure Claude Desktop:

```bash
npm install -g @flipper/netscaler-mcp
```

Then add to Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "netscaler": {
      "command": "npx",
      "args": ["@flipper/netscaler-mcp"],
      "env": {
        "NS_HOST": "10.1.1.100",
        "NS_USER": "nsroot",
        "NS_PASS": "password",
        "SSH_KEY": "/path/to/key.pem"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NS_HOST` | Yes | NetScaler hostname/IP |
| `NS_USER` | No | Username (default: nsroot) |
| `NS_PASS` | Yes | Password for NITRO API and SSH (if no key) |
| `SSH_KEY` | No | Path to SSH private key (preferred over password) |
| `HTTP_PORT` | No | Enable HTTP/SSE transport on specified port |

## Key Dependencies

- **@modelcontextprotocol/sdk**: Official MCP SDK
- **ssh2**: SSH client for batch command execution
- **f5-conx-core**: F5 BIG-IP SDK (for f5 MCP server)

## Safety Conventions

- Write operations require explicit confirmation parameter
- Config deployment auto-reorders for dependency safety
- Clear config preserves system settings (SSH keys, management IP, etc.)
- Tool descriptions are explicit for LLM understanding

## Development Workflow

All NetScaler operations should go through the MCP server, not standalone scripts. If troubleshooting reveals missing functionality, discuss adding it to the MCP server rather than creating one-off scripts.

### Transport Modes

The MCP server supports two transport modes:

**Stdio (default)** - For Claude Desktop integration:

```bash
NS_HOST=10.1.1.100 NS_PASS=xxx npm start
```

**HTTP/SSE** - For development and direct API access:

```bash
HTTP_PORT=3000 NS_HOST=10.1.1.100 NS_PASS=xxx npm start
```

HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Usage info |
| `/sse` | GET | Establish SSE connection (returns sessionId) |
| `/message?sessionId=xxx` | POST | Send JSON-RPC messages |
| `/health` | GET | Health check |

## Development Notes

### Adding New Tools

1. Define tool in `src/index.ts` tools array with JSON Schema
2. Add handler in `handleToolCall()` function
3. Implement core logic in `src/lib/` if needed

### Config Reordering

NetScaler configs must be deployed in dependency order:

Servers → Monitors → Service Groups → Services → Bindings → Virtual Servers → VServer Bindings → SSL → Policies

The `config-reorder.ts` module handles this automatically.

### Future: Separate Repos

Each MCP server is designed to be self-contained for eventual separation:

- `mcp/netscaler/` → `github.com/f5devcentral/netscaler-mcp`
- `mcp/f5/` → `github.com/f5devcentral/f5-mcp`

---

## Claude Interaction Rules

### General

- Keep responses concise
- Do not assume - ask clarifying questions when requirements are unclear
- Don't over-engineer unless explicitly requested

### Markdown Files

- Follow VSCode `.md` linter rules (blank lines around headings/fences, language specifiers, unique headings)
- Each doc should include a summary and an index with status/completion of tasks
- Do not include redundant information - reference other sections/docs as needed

### Changelog Entries

- Follow [Keep a Changelog](https://keepachangelog.com/) format
- Group changes: Added, Changed, Deprecated, Removed, Fixed, Security
- Link to issues/PRs where applicable
