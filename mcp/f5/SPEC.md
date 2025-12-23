# F5 BIG-IP MCP Server Design Document

**Status:** Draft  
**Version:** 0.3.0  
**Last Updated:** 2024-12-23

---

## Overview

MCP (Model Context Protocol) server for managing F5 BIG-IP devices via Claude Desktop, Claude Code, or any MCP-compatible AI client. The server exposes device management, configuration parsing, and declarative deployment capabilities through a unified tool interface.

### Core Libraries

| Library | Purpose | Status |
|---------|---------|--------|
| **f5-conx-core** | Device connectivity, UCS/qkview, ATC services (AS3/DO/TS/CF), RPM management | Ready |
| **f5-corkscrew** | Parse .conf/.ucs/.qkview → JSON, extract applications, object counting | Ready |
| **tmos-converter** | TMOS → AS3/DO conversion, schema validation | Ready |

### Key Features

- **Playbook System** - Markdown-based workflow definitions for complex operations (upgrades, migrations)
- **Multi-Device Support** - Manage HA pairs and device groups via inventory files
- **Config Conversion** - Extract legacy config, convert to AS3/DO, validate, deploy
- **Safety First** - Human approval gates, rollback capabilities, validation checks

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Tool Categories](#2-tool-categories)
3. [Config Parsing (f5-corkscrew)](#3-config-parsing-f5-corkscrew)
4. [Config Conversion (tmos-converter)](#4-config-conversion-tmos-converter)
5. [Playbook System](#5-playbook-system)
6. [Multi-Device Support](#6-multi-device-support)
7. [Implementation Notes](#7-implementation-notes)
8. [Implementation Phases](#8-implementation-phases)

---

## 1. Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        AI Assistant                              │
│                   (Claude Desktop, Claude Code)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (stdio or HTTP/SSE)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @flipper/f5-mcp                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Tool Categories:                                            ││
│  │  • Connection      • UCS/Qkview     • Config Parsing        ││
│  │  • ATC Services    • HA Management  • Config Conversion     ││
│  │  • System Ops      • Monitoring     • Playbooks             ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│   f5-conx-core        f5-corkscrew        tmos-converter        │
│   (device API)        (parsing)           (conversion)          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS/REST
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BIG-IP Devices                               │
│         ┌─────────────┐         ┌─────────────┐                 │
│         │   Active    │◄───────►│   Standby   │                 │
│         └─────────────┘   HA    └─────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

### Package Structure

```text
mcp/f5/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── tools/
│   │   ├── connection.ts        # connect, disconnect, device_info
│   │   ├── backup.ts            # ucs_*, qkview_*
│   │   ├── parsing.ts           # parse_config, list_applications, extract_app
│   │   ├── conversion.ts        # tmos_to_as3, validate_as3, etc.
│   │   ├── deployment.ts        # as3_*, do_*
│   │   ├── system.ts            # license, reboot, bash, tmsh
│   │   ├── ha.ts                # ha_status, failover, sync
│   │   ├── monitoring.ts        # logs, stats, health_check
│   │   └── playbook.ts          # playbook_execute, playbook_validate
│   ├── lib/
│   │   ├── f5-client.ts         # f5-conx-core wrapper
│   │   ├── parser.ts            # f5-corkscrew wrapper
│   │   ├── converter.ts         # tmos-converter wrapper
│   │   ├── device-manager.ts    # Multi-device session handling
│   │   ├── playbook-engine.ts   # Playbook parser and executor
│   │   └── logger.ts            # Execution logging
│   └── transports/
│       └── http.ts              # HTTP/SSE transport (optional)
├── playbooks/                   # Built-in playbooks
│   ├── upgrade-ha-pair.md
│   ├── convert-to-as3.md
│   └── health-check.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. Tool Categories

### 2.1 Connection & Discovery

| Tool | Description | Implementation |
|------|-------------|----------------|
| `connect` | Connect to BIG-IP, discover capabilities | `F5Client.discover()` |
| `disconnect` | Close connection, release session | `F5Client` cleanup |
| `device_info` | Version, platform, HA status, modules | `F5Client.https()` |
| `list_connections` | List active device sessions | Session manager |

### 2.2 Backup & Recovery

| Tool | Description | Implementation |
|------|-------------|----------------|
| `ucs_create` | Create UCS backup (full or mini) | `UcsClient.create()` |
| `ucs_list` | List UCS files on device | `UcsClient.list()` |
| `ucs_download` | Download UCS archive | `UcsClient.download()` |
| `ucs_upload` | Upload UCS to device | `UcsClient.upload()` |
| `ucs_restore` | Restore config from UCS | bash: `tmsh load sys ucs` |
| `ucs_delete` | Delete UCS file | `UcsClient.delete()` |
| `qkview_create` | Generate qkview diagnostic | `QkviewClient.create()` |
| `qkview_list` | List qkview files | `QkviewClient.list()` |
| `qkview_download` | Download qkview | `QkviewClient.download()` |

### 2.3 System Management

| Tool | Description | Implementation |
|------|-------------|----------------|
| `bash_execute` | Execute bash command | `F5Client.https('/mgmt/tm/util/bash')` |
| `tmsh_execute` | Execute tmsh command | bash: `tmsh <command>` |
| `config_save` | Save running config | bash: `tmsh save sys config` |
| `config_merge` | Merge config snippet | bash: `tmsh load sys config merge` |
| `reboot` | Reboot device | bash: `tmsh reboot` or API |
| `license_get` | View current license | API: `/mgmt/tm/sys/license` |
| `license_install` | Install license | API |

### 2.4 Image Management

| Tool | Description | Implementation |
|------|-------------|----------------|
| `image_list` | List ISO images | API: `/mgmt/tm/sys/software/image` |
| `image_upload` | Upload ISO image | File upload API |
| `image_install` | Install to volume | API: `/mgmt/tm/sys/software/volume` |
| `image_delete` | Delete ISO image | API |

### 2.5 HA Management

| Tool | Description | Implementation |
|------|-------------|----------------|
| `ha_status` | HA state, sync status | API: `/mgmt/tm/cm/device` |
| `ha_failover` | Trigger failover | bash: `tmsh run sys failover standby` |
| `ha_sync` | Sync config to peer | API: `/mgmt/tm/cm/config-sync` |

### 2.6 Monitoring & Diagnostics

| Tool | Description | Implementation |
|------|-------------|----------------|
| `logs_get` | Retrieve log files | bash: `cat /var/log/<log>` |
| `stats_get` | Virtual/pool/node stats | API: `/mgmt/tm/ltm/*/stats` |
| `health_check` | Comprehensive health check | Combines multiple checks |
| `upgrade_readiness` | Pre-upgrade validation | Combines checks |

### 2.7 ATC Services (f5-conx-core)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `as3_get` | Get current AS3 declaration | `As3Client.get()` |
| `as3_deploy` | Deploy AS3 declaration | `As3Client.deploy()` |
| `as3_delete` | Remove AS3 tenant | `As3Client.delete()` |
| `do_get` | Get current DO declaration | `DoClient.get()` |
| `do_deploy` | Deploy DO declaration | `DoClient.deploy()` |
| `ts_get` | Get current TS declaration | `TsClient.get()` |
| `ts_deploy` | Deploy TS declaration | `TsClient.deploy()` |
| `ts_delete` | Remove TS configuration | `TsClient.delete()` |
| `atc_list` | List installed ATC packages | `AtcMgmtClient.getInstalledVersions()` |
| `atc_install` | Install ATC package | `AtcMgmtClient.install()` |
| `atc_uninstall` | Remove ATC package | `AtcMgmtClient.uninstall()` |

### 2.8 Playbook Operations

| Tool | Description |
|------|-------------|
| `playbook_list` | List available playbooks |
| `playbook_get` | Get playbook content |
| `playbook_validate` | Validate playbook syntax |
| `playbook_execute` | Execute playbook with approval gates |
| `playbook_status` | Get execution status |
| `playbook_respond` | Respond to approval gate |
| `playbook_abort` | Abort running playbook |

---

## 3. Config Parsing (f5-corkscrew)

### Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `parse_config` | Parse TMOS config → JSON | `BigipConfig.loadParseAsync()` |
| `list_applications` | List all virtual servers with dependencies | `BigipConfig.apps()` |
| `extract_application` | Extract single app with all dependencies | `BigipConfig.explode()` + filter |
| `get_config_stats` | Object counts, parse time | `BigipConfig.stats` |

### Wrapper Implementation

```typescript
// src/lib/parser.ts
import BigipConfig from 'f5-corkscrew';

export async function parseConfig(source: string | Buffer): Promise<ParseResult> {
  const bigip = new BigipConfig();
  await bigip.loadParseAsync(source);
  return {
    configObject: bigip.configObject,
    stats: bigip.stats,
    hostname: bigip.hostname,
    version: bigip.tmosVersion,
  };
}

export async function listApplications(source: string | Buffer): Promise<AppSummary[]> {
  const bigip = new BigipConfig();
  await bigip.loadParseAsync(source);
  const explosion = await bigip.explode();
  return explosion.config.apps.map(app => ({
    name: app.name,
    destination: app.map?.destination,
    pool: app.map?.pool,
    profiles: app.map?.profiles,
    rules: app.map?.rules,
  }));
}

export async function extractApplication(
  source: string | Buffer, 
  appName: string
): Promise<AppConfig> {
  const bigip = new BigipConfig();
  await bigip.loadParseAsync(source);
  const explosion = await bigip.explode();
  const app = explosion.config.apps.find(a => a.name === appName);
  if (!app) throw new Error(`Application not found: ${appName}`);
  return app;
}
```

### Use Cases

1. **Config Audit** - Parse UCS, count objects, identify complexity
2. **Application Extraction** - Pull single app for conversion
3. **Migration Planning** - List all apps, assess conversion readiness
4. **Documentation** - Generate config inventory

---

## 4. Config Conversion (tmos-converter)

### Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `tmos_to_as3` | Convert TMOS config → AS3 | `tmos.convertToAS3()` |
| `tmos_to_do` | Convert TMOS config → DO | `tmos.convertToDO()` |
| `validate_as3` | Validate AS3 against schema | `tmos.validateAS3()` |
| `validate_do` | Validate DO against schema | `tmos.validateDO()` |
| `get_as3_schema_info` | Get AS3 class documentation | Schema introspection |

### Wrapper Implementation

```typescript
// src/lib/converter.ts
import * as tmos from 'tmos-converter';

export async function convertToAS3(config: string, options?: {
  stripRouteDomains?: boolean;
}): Promise<ConversionResult> {
  const result = await tmos.convertToAS3(config, options);
  return {
    declaration: result.declaration,
    unsupported: result.as3NotConverted,
    unrecognized: result.as3NotRecognized,
    warnings: result.keyClassicNotSupported,
    stats: result.unsupportedStats,
  };
}

export async function validateAS3(declaration: object, options?: {
  mode?: 'strict' | 'lazy';
}): Promise<ValidationResult> {
  const result = await tmos.validateAS3(declaration, { 
    mode: options?.mode || 'strict' 
  });
  return {
    valid: result.isValid,
    errors: result.errors?.map(e => ({
      path: e.dataPath || e.instancePath,
      message: e.message,
      keyword: e.keyword,
    })),
    cleanedDeclaration: result.data,
    removedProperties: result.ignoredAttributes,
  };
}
```

### AI Workflows Enabled

#### Workflow 1: Legacy Config Migration

```text
1. AI extracts bigip.conf from device (bash or UCS)
2. AI calls parse_config to understand structure
3. AI calls list_applications to show available apps
4. User selects app(s) to convert
5. AI calls extract_application for each
6. AI calls tmos_to_as3 to convert
7. AI calls validate_as3 (strict mode)
8. If errors, AI fixes based on error messages
9. AI presents validated declaration
10. User approves, AI calls as3_deploy
```

#### Workflow 2: Iterative Declaration Development

```text
1. AI generates AS3 declaration from requirements
2. AI calls validate_as3 (strict mode)
3. If errors:
   a. AI reads error messages
   b. AI uses get_as3_schema_info to understand correct structure
   c. AI fixes declaration
   d. AI re-validates
   e. Repeat until valid
4. AI presents validated declaration
5. Deploy via as3_deploy
```

---

## 5. Playbook System

### Format Specification

Playbooks use Markdown with YAML front matter and structured step definitions.

```markdown
---
name: BIG-IP HA Pair Upgrade
version: 1.0.0
description: Standard upgrade procedure for BIG-IP HA pairs
author: F5 Operations Team

parameters:
  - name: target_version
    type: string
    required: true
    description: "Target BIG-IP version (e.g., 17.1.1)"
  - name: backup_passphrase
    type: secret
    required: true

targets:
  type: ha_pair
  primary_alias: active
  secondary_alias: standby

settings:
  rollback_on_failure: true
  log_level: detailed
---

# BIG-IP HA Pair Upgrade

This playbook performs a rolling upgrade of an HA pair.

## Pre-Flight Checks

- [ ] get_device_info: Verify device connectivity
- [ ] ha_status: Confirm HA pair is in sync
  - expect: sync_status == "In Sync"
- [ ] capture_baseline: Record current stats
  - params: { "include": ["virtuals", "pools"] }
  - pause: true

## Phase 1: Backup

- [ ] ucs_create: Create pre-upgrade backup
  - params: { "name": "pre-upgrade-{{timestamp}}" }
- [ ] ucs_download: Download backup locally

## Phase 2: Upgrade Standby

- [ ] image_upload: Upload ISO to standby
  - target: "{{standby}}"
- [ ] image_install: Install on standby
  - target: "{{standby}}"
  - params: { "reboot": true }
- [ ] wait: 300
- [ ] check_connection: Verify standby is back
  - target: "{{standby}}"
  - retries: 10
  - retry_delay: 30

## Phase 3: Failover

- [ ] ha_failover: Failover to upgraded standby
  - confirm: true
  - pause: "Ready to failover. Traffic will shift to upgraded unit."

## Rollback

- [ ] ucs_restore: Restore from backup
  - params: { "name": "pre-upgrade-{{timestamp}}" }
```

### Step Syntax

```markdown
- [ ] <tool_name>: <description>
  - params: { <json parameters> }
  - target: "<device override>"
  - expect: <condition>
  - on_fail: continue|stop|rollback
  - pause: true|false|"message"
  - confirm: true
  - retries: <number>
  - retry_delay: <seconds>
```

### Built-in Directives

| Directive | Description |
|-----------|-------------|
| `wait: <seconds>` | Pause execution for specified time |
| `pause: "message"` | Stop and prompt user to continue |
| `confirm: true` | Require user confirmation before step |

### Execution Modes

1. **Interactive (default)** - Pause at each step, show plan, confirm
2. **Auto** - Execute all steps, stop on failure (respects explicit `pause`)
3. **Dry-run** - Show what would happen without executing

---

## 6. Multi-Device Support

### Device Inventory File

```yaml
# devices.yaml
devices:
  prod-active:
    host: 10.1.1.100
    user: admin
    password: "{{vault:prod-bigip}}"
    port: 443
    role: active
    cluster: prod-dc1

  prod-standby:
    host: 10.1.1.101
    user: admin
    password: "{{vault:prod-bigip}}"
    role: standby
    cluster: prod-dc1

  dev-standalone:
    host: 10.2.1.50
    user: admin
    password: secret123

clusters:
  prod-dc1:
    devices: [prod-active, prod-standby]
    type: ha-pair
```

### Credential Sources (Priority Order)

1. **Inventory File** - `F5_DEVICES_FILE=/path/to/devices.yaml`
2. **Chat-Provided** - User provides in conversation (session-scoped)
3. **Environment Variables** - `F5_HOST`, `F5_USER`, `F5_PASS` (single device)

### Tool Device Targeting

```typescript
// Target specific device
await get_device_info({ device: "prod-active" })

// Target cluster (returns results from all devices)
await ha_status({ cluster: "prod-dc1" })

// Default: uses F5_HOST or first device in inventory
await get_device_info({})
```

---

## 7. Implementation Notes

### Most Operations Use Existing Capabilities

The f5-conx-core library provides most functionality. Operations that appear as "extensions" are actually thin wrappers:

| Operation | Implementation |
|-----------|----------------|
| Reboot | `bash: tmsh reboot` or `F5Client.https('/mgmt/tm/sys')` |
| Shutdown | `bash: tmsh shutdown` |
| Restore UCS | `bash: tmsh load sys ucs <file>` |
| Get Logs | `bash: tail -n 100 /var/log/<log>` |
| Merge Config | `bash: tmsh load sys config merge file <path>` |
| HA Status | `F5Client.https('/mgmt/tm/cm/device')` |
| Failover | `bash: tmsh run sys failover standby` |
| Sync Config | `F5Client.https('/mgmt/tm/cm/config-sync')` |
| Stats | `F5Client.https('/mgmt/tm/ltm/virtual/stats')` |
| Image List | `F5Client.https('/mgmt/tm/sys/software/image')` |
| Image Install | `F5Client.https('/mgmt/tm/sys/software/volume')` |

### Library Status

| Library | MCP Integration Status |
|---------|------------------------|
| f5-conx-core | Ready - provides F5Client, ATC clients, UCS/Qkview |
| f5-corkscrew | Ready - provides BigipConfig for parsing |
| tmos-converter | Ready - provides conversion and validation |

No library extensions are required. All "new" tools are wrappers around existing capabilities.

---

## 8. Implementation Phases

### Phase 1: Core Device Operations
- [ ] Project setup (package.json, tsconfig, index.ts)
- [ ] f5-conx-core integration (F5Client wrapper)
- [ ] Connection tools: connect, disconnect, device_info
- [ ] UCS tools: create, list, download, delete
- [ ] Qkview tools: create, list, download

### Phase 2: Config Parsing & Conversion
- [ ] f5-corkscrew integration (parser wrapper)
- [ ] tmos-converter integration (converter wrapper)
- [ ] parse_config, list_applications, extract_application
- [ ] tmos_to_as3, tmos_to_do
- [ ] validate_as3, validate_do

### Phase 3: ATC Services
- [ ] AS3 get/deploy/delete
- [ ] DO get/deploy
- [ ] ATC version management

### Phase 4: System Operations
- [ ] bash_execute, tmsh_execute
- [ ] UCS restore, config merge
- [ ] Reboot, logs

### Phase 5: HA & Image Management
- [ ] HA status, failover, sync
- [ ] Image list, upload, install
- [ ] Multi-device session management

### Phase 6: Playbooks
- [ ] Playbook parser
- [ ] Execution engine with approval gates
- [ ] Built-in playbooks

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `F5_HOST` | No | Default BIG-IP hostname/IP |
| `F5_USER` | No | Default username (default: admin) |
| `F5_PASS` | No | Default password |
| `F5_PORT` | No | Default port (default: 443) |
| `F5_PROVIDER` | No | Auth provider (default: tmos) |
| `F5_DEVICES_FILE` | No | Path to devices inventory file |
| `HTTP_PORT` | No | Enable HTTP/SSE transport |

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "f5-conx-core": "file:../../../../f5-conx-core",
    "f5-corkscrew": "file:../../../../f5-corkscrew",
    "tmos-converter": "file:../../../../tmos-converter"
  }
}
```

---

## Telemetry

### Overview

The MCP server and underlying libraries will implement telemetry to track usage patterns, error rates, and feature adoption. This data informs product improvements and helps prioritize development.

> **Note:** Telemetry Streaming (TS) is a separate F5 ATC service for BIG-IP statistics (pushing metrics to Splunk, Azure, etc.). The telemetry described here is for tracking MCP server and library usage, not BIG-IP metrics.

### Implementation

Telemetry will use a TEEM-like approach (based on vscode-f5 implementation):

```typescript
// Endpoint
const endPoint = "https://product.apis.f5.com/ee/v1/telemetry";

// Payload structure
{
  documentType: "F5 MCP Telemetry Data",
  digitalAssetId: instanceGUID,
  digitalAssetName: "@flipper/f5-mcp",
  digitalAssetVersion: "1.0.0",
  telemetryRecords: [
    { command: "as3_deploy", duration_ms: 1234, success: true },
    { command: "parse_config", objects_parsed: 500, duration_ms: 2100 }
  ]
}
```

### Metrics Collected

| Category | Metrics |
|----------|--------|
| MCP Server | Tool invocations, playbook executions, error rates |
| f5-conx-core | Device connections, API calls by type, ATC deployments |
| f5-corkscrew | Config sizes, parse times, object counts by type |
| tmos-converter | Conversion success rates, unsupported object frequency |

### Opt-Out

Telemetry is **enabled by default**. To disable:

```bash
# Environment variable
export F5_TEEM_ENABLED=false
```

**What is NOT collected:**
- Configuration content
- IP addresses or hostnames
- Credentials or secrets
- Any PII

**Documentation:** Clear documentation will describe exactly what metrics are collected.

---

## Changelog

### 0.3.0 (2024-12-23)
- Consolidated spec from mcp-server-design.md and bigip_mcp.spec.md
- Added f5-corkscrew integration (parsing tools)
- Added tmos-converter integration (conversion tools)
- Added multi-device support via inventory file
- Clarified that most operations use existing library capabilities
- Added playbook pause directive
- Added TS tools (ts_get, ts_deploy, ts_delete) to ATC Services
- Added Telemetry section - TEEM-like implementation, opt-out by default

### 0.2.0 (2024-01-15)
- Initial mcp-server-design.md with comprehensive tool definitions

### 0.1.0 (2024-12-22)
- Initial spec draft
